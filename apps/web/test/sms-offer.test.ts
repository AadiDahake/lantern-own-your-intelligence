/**
 * Who decides that a person can be offered the one text: the runner that sends it.
 *
 * The worker sends under `local` and the forge runner sends under `forge`. Each one says in its
 * heartbeat if it can send. The web app's own variables decide nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbClock, failWhen, fakeClient, resetDb, rpcRows, seen, tables } from "./support/fake-db";

vi.mock("@/lib/supabase", () => ({ serviceClient: () => fakeClient() }));

const { awaitsDraft, offerTrace, textOffer, WORKER_ONLINE_TITLE, WORKER_SEEN_SECONDS } = await import(
  "@/lib/sms/offer"
);
const WORKER_SEEN_MS = WORKER_SEEN_SECONDS * 1000;
const { beatOnce } = await import("@/lib/forge/heartbeat");

const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const now = (): number => NOW;
const original = { ...process.env };

/** One heartbeat row, written `agoMs` before the database's "now". */
function heartbeat(agoMs: number, detail: Record<string, unknown> | null, projectId = "p1"): void {
  const rows = (tables.trace_event ??= []);
  rows.push({
    id: rows.length + 1,
    project_id: projectId,
    title: WORKER_ONLINE_TITLE,
    detail,
    created_at: new Date(NOW - agoMs).toISOString(),
  });
}

const worker = (agoMs: number, sms: unknown): void => heartbeat(agoMs, { engine: "local", sms });
const forge = (agoMs: number, sms: unknown): void => heartbeat(agoMs, { engine: "forge", sms });

beforeEach(() => {
  resetDb();
  dbClock.now = now;
  delete process.env.ESCALATION_ENGINE;
  delete process.env.DIAL_API_KEY;
  delete process.env.DIAL_FROM_NUMBER;
});

afterEach(() => {
  process.env = { ...original };
});

describe("the text offer under the local engine", () => {
  it("is on when the worker's last heartbeat is fresh and says that it can text", async () => {
    worker(30_000, true);
    expect(await textOffer("p1")).toEqual({ on: true });
  });

  it("needs no provider variable in the web app", async () => {
    worker(30_000, true);
    expect(process.env.DIAL_API_KEY).toBeUndefined();
    expect((await textOffer("p1")).on).toBe(true);
  });

  it("is off when the web app has the variables and the worker does not", async () => {
    process.env.DIAL_API_KEY = "test-key";
    process.env.DIAL_FROM_NUMBER = "+14155550100";
    worker(30_000, false);
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the worker has no text message provider" });
  });

  it.each([
    ["a worker that does not say", { engine: "local" }],
    ["a value that is not true", { engine: "local", sms: "true" }],
    ["a value that is not true", { engine: "local", sms: 1 }],
  ])("is off for a heartbeat of %s", async (_name, detail) => {
    heartbeat(30_000, detail);
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the worker has no text message provider" });
  });

  it("is off when no worker ever ran", async () => {
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the worker is not running" });
  });

  it("is off when the last heartbeat is older than three beats", async () => {
    worker(WORKER_SEEN_MS + 1, true);
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the worker is not running" });
    resetDb();
    dbClock.now = now;
    worker(WORKER_SEEN_MS, true);
    expect((await textOffer("p1")).on).toBe(true);
  });

  it("measures the age on the database's clock, so the clock of the web app decides nothing", async () => {
    // The heartbeat is 10 minutes old for the database. A web app whose clock is 10 minutes
    // behind would read it as written this moment.
    worker(600_000, true);
    vi.useFakeTimers({ now: NOW - 600_000 });
    try {
      expect(await textOffer("p1")).toEqual({ on: false, reason: "the worker is not running" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is off on a database that has no heartbeat function", async () => {
    worker(1_000, true);
    failWhen((query) => (query.table === "rpc:runner_heartbeats" ? { message: "Could not find the function", code: "PGRST202" } : null));
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the heartbeat of the runner could not be read" });
  });

  it("reads the newest heartbeat, so a worker that lost its provider turns the offer off", async () => {
    worker(120_000, true);
    worker(60_000, false);
    expect((await textOffer("p1")).on).toBe(false);
    worker(1_000, true);
    expect((await textOffer("p1")).on).toBe(true);
  });

  it("reads only this project's heartbeat, and only a heartbeat row", async () => {
    heartbeat(1_000, { engine: "local", sms: true }, "p2");
    (tables.trace_event ??= []).push({
      id: 99,
      project_id: "p1",
      title: "Text notice: 1 of 1 sent",
      detail: { engine: "local", sms: true },
      created_at: new Date(NOW - 1_000).toISOString(),
    });
    expect((await textOffer("p1")).on).toBe(false);
  });

  it("is off, and does not throw, when the read fails", async () => {
    worker(1_000, true);
    failWhen(() => ({ message: "connection reset" }));
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the heartbeat of the runner could not be read" });
  });

  it.each([
    ["a word", "true"],
    ["a number", 1],
    ["nothing", null],
    ["no field", undefined],
  ])("takes only the boolean true as 'can send', not %s, whatever the function answers", async (_name, sms) => {
    rpcRows.answer = [{ engine: "local", sms, age_seconds: 5 }];
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the worker has no text message provider" });
  });

  it.each([
    ["a word", "5"],
    ["nothing", null],
    ["not a number", Number.NaN],
  ])("does not count a heartbeat whose age is %s", async (_name, age) => {
    rpcRows.answer = [{ engine: "local", sms: true, age_seconds: age }];
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the worker is not running" });
  });

  it("reads one function and no table", async () => {
    worker(1_000, true);
    await textOffer("p1");
    expect(seen).toEqual([{ table: "rpc:runner_heartbeats", verb: "select" }]);
  });

  it("is off when the heartbeat's time cannot be read", async () => {
    (tables.trace_event ??= []).push({
      id: 1,
      project_id: "p1",
      title: WORKER_ONLINE_TITLE,
      detail: { engine: "local", sms: true },
      created_at: "not a time",
    });
    expect((await textOffer("p1")).on).toBe(false);
  });

  it("does not follow the forge runner's heartbeat", async () => {
    forge(1_000, true);
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the worker is not running" });
  });

  it("is off when a forge runner is live and cannot text, because a forge run can be started from the console", async () => {
    worker(1_000, true);
    forge(2_000, false);
    expect(await textOffer("p1")).toEqual({
      on: false,
      reason: "a runner of the forge engine is live and has no text message provider",
    });
  });

  it("is on when each live runner can text", async () => {
    worker(1_000, true);
    forge(2_000, true);
    expect((await textOffer("p1")).on).toBe(true);
  });

  it("does not count a forge runner that stopped", async () => {
    worker(1_000, true);
    forge(WORKER_SEEN_MS + 5_000, false);
    expect((await textOffer("p1")).on).toBe(true);
  });
});

describe("the text offer under the forge engine", () => {
  beforeEach(() => {
    process.env.ESCALATION_ENGINE = "forge";
  });

  it("is on when the forge runner's last heartbeat is fresh and says that it can text", async () => {
    forge(30_000, true);
    expect(await textOffer("p1")).toEqual({ on: true });
  });

  it("does not follow the web app's own variables: the runner is a different process", async () => {
    process.env.DIAL_API_KEY = "test-key";
    process.env.DIAL_FROM_NUMBER = "+14155550100";
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the forge runner is not running" });
    forge(30_000, false);
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the forge runner has no text message provider" });
  });

  it("does not follow a worker's heartbeat", async () => {
    worker(1_000, true);
    expect((await textOffer("p1")).on).toBe(false);
  });

  it("is on from the heartbeat that the forge runner itself writes", async () => {
    tables.project = [{ id: "p1" }, { id: "p2" }];
    expect(await beatOnce({ sms: true })).toBe(2);
    const rows = tables.trace_event ?? [];
    expect(rows.map((row) => [row.project_id, row.kind, row.title, row.source])).toEqual([
      ["p1", "status", WORKER_ONLINE_TITLE, "forge"],
      ["p2", "status", WORKER_ONLINE_TITLE, "forge"],
    ]);
    expect(rows[0]?.detail).toMatchObject({ engine: "forge", sms: true });
    dbClock.now = () => Date.now();
    expect((await textOffer("p1")).on).toBe(true);

    await beatOnce({ sms: false });
    expect(await textOffer("p1")).toEqual({ on: false, reason: "the forge runner has no text message provider" });
  });

  it("writes no heartbeat when there is no project, and says so when the write fails", async () => {
    expect(await beatOnce({ sms: true })).toBe(0);
    expect(seen.filter((query) => query.verb === "insert")).toEqual([]);
    tables.project = [{ id: "p1" }];
    failWhen((query) => (query.verb === "insert" ? { message: "permission denied" } : null));
    await expect(beatOnce({ sms: true })).rejects.toThrow("permission denied");
  });
});

describe("the gap states that can still get a text", () => {
  it.each(["observed", "filed", "drafting"] as const)("%s still waits for a draft", (status) => {
    expect(awaitsDraft(status)).toBe(true);
  });

  it.each(["pr_open", "awaiting_approval", "shipped", "rejected"] as const)("%s is past the draft", (status) => {
    expect(awaitsDraft(status)).toBe(false);
  });
});

describe("the trace row of the offer", () => {
  it("is never a status row, because the console reads the newest status row as a runner's heartbeat", () => {
    expect(offerTrace({ on: true }).kind).toBe("decision");
    expect(offerTrace({ on: false, reason: "the worker is not running" }).kind).toBe("decision");
  });

  it("says that the text was offered", () => {
    expect(offerTrace({ on: true })).toEqual({
      kind: "decision",
      status: "ok",
      title: "Text notice: offered with the report",
      detail: { notice: "draft_sms", offer: "on" },
    });
  });

  it("says that the part is off, with the reason", () => {
    expect(offerTrace({ on: false, reason: "the worker is not running" })).toEqual({
      kind: "decision",
      status: "ok",
      title: "Text notice: not offered",
      detail: { notice: "draft_sms", offer: "off", reason: "the worker is not running" },
    });
  });
});
