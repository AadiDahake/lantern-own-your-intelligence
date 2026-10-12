/**
 * The agent search of one turn, offline: when it starts, what it sends, and what the turn gets
 * when it is ready for the result.
 *
 * The rule that matters most is that the turn never waits. A search that has not answered when
 * the answer is ready is stopped, and that is an outcome and not an error.
 */
import { describe, expect, it, vi } from "vitest";
import { lookElsewhere, outsideTrace, type OutsideOutcome } from "@/lib/alternatives/search";
import type { AgentListing, AgentSearchResult } from "@/lib/darwin";
import type { AgentSearchConfig } from "@/lib/env";

const CONFIG: AgentSearchConfig = { apiKey: null, apiUrl: "https://search.test" };
const ON = { configured: true as const, config: CONFIG };
const OFF = { configured: false as const, reason: "DARWIN_API_KEY is not set and LANTERN_DARWIN is not 'public'" };

const LISTING: AgentListing = {
  rank: 1,
  agentId: "agent1",
  capabilityId: "cap1",
  name: "Find seats together",
  provider: "SeatFinder",
  description: "Seats a party side by side on one flight.",
  verified: true,
  startable: true,
  paid: false,
  readiness: "ready",
  url: "https://index.darwin.so/agent/agent1?capability=cap1",
};

type SearchCall = { config: AgentSearchConfig; query: string; signal: AbortSignal | undefined };

/** A search that answers when the test says so. */
function controlledSearch() {
  const calls: SearchCall[] = [];
  let answer: (result: AgentSearchResult) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const search = vi.fn((config: AgentSearchConfig, query: string, options?: { signal?: AbortSignal }) => {
    calls.push({ config, query, signal: options?.signal });
    return new Promise<AgentSearchResult>((resolve, reject) => {
      answer = resolve;
      fail = reject;
    });
  });
  return { search, calls, answer: (result: AgentSearchResult) => answer(result), fail: (error: unknown) => fail(error) };
}

/** Lets the promise callbacks of an answered search run. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("lookElsewhere", () => {
  it("sends nothing when the search is off, and says why only when an offer was wanted", () => {
    const { search } = controlledSearch();
    const looked = lookElsewhere("finding seats together", { configured: OFF, search });
    expect(looked.take(true)).toEqual({ state: "off", reason: OFF.reason });
    expect(lookElsewhere("finding seats together", { configured: OFF, search }).take(false)).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    ["one word", "seats"],
    ["a booking code", "finding seats together on booking NVA7K2"],
    ["the name of a person", "sending a gift card to John Smith"],
  ])("sends nothing for a capability name with %s, and never a part of it", (_label, feature) => {
    const { search } = controlledSearch();
    const looked = lookElsewhere(feature, { configured: ON, search });
    expect(looked.take(true)).toMatchObject({ state: "skipped" });
    expect(lookElsewhere(feature, { configured: ON, search }).take(false)).toBeNull();
    expect(lookElsewhere(feature, { configured: ON, search }).abandon()).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("starts one search at once, with the whole capability name and nothing else", () => {
    const { search, calls } = controlledSearch();
    lookElsewhere("  finding seats   together ", { configured: ON, search });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ config: CONFIG, query: "finding seats together" });
    expect(calls[0]?.signal?.aborted).toBe(false);
  });

  it("gives the gated result when the search answered before the turn was ready", async () => {
    const { search, calls, answer } = controlledSearch();
    const looked = lookElsewhere("finding seats together", { configured: ON, search });
    answer({ ok: true, listings: [LISTING], latencyMs: 2300 });
    await settle();

    expect(looked.take(true)).toEqual({
      state: "done",
      query: "finding seats together",
      latencyMs: 2300,
      offered: [{ name: "Find seats together", provider: "SeatFinder", url: LISTING.url }],
      counts: { found: 1, named: 1, startable: 1 },
      near: [],
    });
    // A search that answered is not stopped.
    expect(calls[0]?.signal?.aborted).toBe(false);
  });

  it("does not wait: a search that has not answered is stopped, and the outcome says late", () => {
    const { search, calls } = controlledSearch();
    let clock = 1_000;
    const looked = lookElsewhere("finding seats together", { configured: ON, search, now: () => clock });
    clock = 5_250;
    expect(looked.take(true)).toEqual({ state: "late", query: "finding seats together", waitedMs: 4250 });
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it("drops the result when the verdict did not confirm the absence, and stops a search that still runs", async () => {
    const pending = controlledSearch();
    let clock = 0;
    const running = lookElsewhere("finding seats together", { configured: ON, search: pending.search, now: () => clock });
    clock = 900;
    expect(running.take(false)).toEqual({ state: "dropped", query: "finding seats together", waitedMs: 900 });
    expect(pending.calls[0]?.signal?.aborted).toBe(true);

    const answered = controlledSearch();
    const finished = lookElsewhere("finding seats together", { configured: ON, search: answered.search });
    answered.answer({ ok: true, listings: [LISTING], latencyMs: 10 });
    await settle();
    expect(finished.take(false)).toMatchObject({ state: "dropped" });
    expect(answered.calls[0]?.signal?.aborted).toBe(false);
  });

  it("reads a search that failed as an outcome with the short reason", async () => {
    const { search, answer } = controlledSearch();
    const looked = lookElsewhere("finding seats together", { configured: ON, search });
    answer({ ok: false, reason: "http_503", latencyMs: 7020 });
    await settle();
    expect(looked.take(true)).toEqual({ state: "failed", query: "finding seats together", reason: "http_503", latencyMs: 7020 });
  });

  it("reads a search that rejects as a failure, and lets no rejection out", async () => {
    const { search, fail } = controlledSearch();
    const looked = lookElsewhere("finding seats together", { configured: ON, search });
    fail(new Error("a stand-in broke"));
    await settle();
    expect(looked.take(true)).toMatchObject({ state: "failed", reason: "network" });
  });

  it("ends a search whose turn ended first, one time, and says so", () => {
    const { search, calls } = controlledSearch();
    let clock = 0;
    const looked = lookElsewhere("finding seats together", { configured: ON, search, now: () => clock });
    clock = 700;
    expect(looked.abandon()).toEqual({ state: "abandoned", query: "finding seats together", waitedMs: 700 });
    expect(calls[0]?.signal?.aborted).toBe(true);
    // A second end has nothing to end and nothing to say.
    expect(looked.abandon()).toBeNull();
  });

  it("has nothing to end after the turn read the search", async () => {
    const pending = controlledSearch();
    const late = lookElsewhere("finding seats together", { configured: ON, search: pending.search });
    expect(late.take(true)).toMatchObject({ state: "late" });
    expect(late.abandon()).toBeNull();

    const answered = controlledSearch();
    const done = lookElsewhere("finding seats together", { configured: ON, search: answered.search });
    answered.answer({ ok: true, listings: [LISTING], latencyMs: 10 });
    await settle();
    expect(done.take(true)).toMatchObject({ state: "done" });
    expect(done.abandon()).toBeNull();
  });

  it("has nothing to end when the search is off", () => {
    const { search } = controlledSearch();
    expect(lookElsewhere("finding seats together", { configured: OFF, search }).abandon()).toBeNull();
  });

  it("reads the environment when no configuration is given, and is off with nothing set", () => {
    const before = { key: process.env.DARWIN_API_KEY, mode: process.env.LANTERN_DARWIN };
    delete process.env.DARWIN_API_KEY;
    delete process.env.LANTERN_DARWIN;
    try {
      const { search } = controlledSearch();
      expect(lookElsewhere("finding seats together", { search }).take(true)).toMatchObject({ state: "off" });
      expect(search).not.toHaveBeenCalled();
    } finally {
      if (before.key !== undefined) process.env.DARWIN_API_KEY = before.key;
      if (before.mode !== undefined) process.env.LANTERN_DARWIN = before.mode;
    }
  });
});

describe("outsideTrace", () => {
  const done = (overrides: Partial<Extract<OutsideOutcome, { state: "done" }>> = {}): OutsideOutcome => ({
    state: "done",
    query: "finding seats together",
    latencyMs: 2300,
    offered: [],
    counts: { found: 0, named: 0, startable: 0 },
    near: [],
    ...overrides,
  });

  it("says that the part is off, with the variables, in a row that is not a tool row", () => {
    expect(outsideTrace({ state: "off", reason: OFF.reason })).toEqual({
      kind: "decision",
      status: "ok",
      title: "Outside services: off",
      detail: { search: "agents", state: "off", reason: OFF.reason },
    });
  });

  it("says that nothing was searched for a name that is not fit to search by", () => {
    expect(outsideTrace({ state: "skipped", reason: "too short" })).toMatchObject({
      kind: "decision",
      title: "Outside services: not searched",
      detail: { search: "agents", state: "skipped", reason: "too short" },
    });
  });

  it("names what was offered, and how the count came down to it", () => {
    const row = outsideTrace(
      done({
        offered: [{ name: "Find seats together", provider: "SeatFinder", url: LISTING.url }],
        counts: { found: 7, named: 2, startable: 1 },
        near: [{ name: "find_seats_together", provider: "RowMate", why: "unavailable" }],
      }),
    );
    expect(row).toEqual({
      kind: "tool",
      status: "ok",
      title: "Outside services: 1 offered of 7 found",
      detail: {
        tool: "agent_search",
        transport: "rest",
        args_summary: "finding seats together",
        result_summary:
          '7 listings found, 2 named for the capability, 1 can start now, 1 offered. Not offered: "find_seats_together" by RowMate (unavailable).',
        search: "agents",
        state: "done",
        found: 7,
        named: 2,
        startable: 1,
        offered: [{ name: "Find seats together", provider: "SeatFinder", url: LISTING.url }],
        near: [{ name: "find_seats_together", provider: "RowMate", why: "unavailable" }],
        latencyMs: 2300,
      },
    });
  });

  it("says none offered when listings were found and none passed", () => {
    const row = outsideTrace(done({ counts: { found: 7, named: 0, startable: 0 } }));
    expect(row.title).toBe("Outside services: none offered of 7 found");
    expect(row.detail.result_summary).toBe("7 listings found, 0 named for the capability, 0 can start now, 0 offered.");
  });

  it("says none found for an empty answer, and uses the singular for one", () => {
    expect(outsideTrace(done()).title).toBe("Outside services: none found");
    const one = outsideTrace(
      done({
        counts: { found: 2, named: 2, startable: 2 },
        near: [
          { name: "Find seats together", provider: "", why: "no service name that can be shown" },
          { name: "", provider: "SeatFinder", why: "a name that cannot be shown" },
        ],
      }),
    );
    expect(one.detail.result_summary).toBe(
      '2 listings found, 2 named for the capability, 2 can start now, 0 offered. Not offered: "Find seats together" by an unnamed service (no service name that can be shown); a listing by SeatFinder (a name that cannot be shown).',
    );
    expect(outsideTrace(done({ counts: { found: 1, named: 0, startable: 0 } })).detail.result_summary).toBe(
      "1 listing found, 0 named for the capability, 0 can start now, 0 offered.",
    );
  });

  it("marks a late search and a failed search, and says that nothing was offered", () => {
    const late = outsideTrace({ state: "late", query: "finding seats together", waitedMs: 4250 });
    expect(late).toMatchObject({ kind: "tool", status: "failed", title: "Outside services: no answer in time" });
    expect(late.detail).toMatchObject({ args_summary: "finding seats together", state: "late", waitedMs: 4250 });
    expect(String(late.detail.result_summary)).toContain("4250 ms");

    const failed = outsideTrace({ state: "failed", query: "finding seats together", reason: "http_503", latencyMs: 7020 });
    expect(failed).toMatchObject({ kind: "tool", status: "failed", title: "Outside services: the search failed" });
    expect(failed.detail).toMatchObject({ state: "failed", reason: "http_503", latencyMs: 7020 });
    // The console shows the summary and not the reason field, so the code must be in both.
    expect(failed.detail.result_summary).toBe("No usable answer (http_503), so nothing was offered.");
  });

  it("says that a turn ended before it read the result", () => {
    const row = outsideTrace({ state: "abandoned", query: "finding seats together", waitedMs: 700 });
    expect(row).toMatchObject({
      kind: "tool",
      status: "failed",
      title: "Outside services: the turn ended before the result was read",
      detail: { args_summary: "finding seats together", state: "abandoned", waitedMs: 700 },
    });
    expect(String(row.detail.result_summary)).toContain("700 ms");
  });

  it("says that a result was not needed when the absence was not confirmed", () => {
    const row = outsideTrace({ state: "dropped", query: "finding seats together", waitedMs: 900 });
    expect(row).toMatchObject({
      kind: "tool",
      status: "ok",
      title: "Outside services: not needed, the absence was not confirmed",
    });
  });

  it("never writes a row of kind status, because the console reads that as a runner's heartbeat", () => {
    const outcomes: OutsideOutcome[] = [
      { state: "off", reason: "x" },
      { state: "skipped", reason: "x" },
      done(),
      { state: "late", query: "q", waitedMs: 1 },
      { state: "failed", query: "q", reason: "timeout", latencyMs: 1 },
      { state: "dropped", query: "q", waitedMs: 1 },
      { state: "abandoned", query: "q", waitedMs: 1 },
    ];
    for (const outcome of outcomes) expect(outsideTrace(outcome).kind).not.toBe("status");
  });
});
