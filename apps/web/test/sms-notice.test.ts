/**
 * The text a person asked for, as a rule: who is claimed, who is texted, and what the trace says.
 * The list of people is a memory store and the send is a function, so nothing leaves the process.
 */
import { describe, expect, it } from "vitest";
import type { SmsResult } from "@/lib/dial";
import {
  noticeTrace,
  PASS_BUDGET_MS,
  PASS_LIMIT,
  sendDraftNotice,
  thrownMessage,
  type NoticeStore,
  type OwedText,
} from "@/lib/sms/notice";

const GAP = { company: "NovaAir", title: "Seat a party together" };
const TEXT =
  'NovaAir: you asked for a text about "Seat a party together". A change for it is now drafted and the team reviews it next. This is the only text for this request.';

type Row = OwedText & { claimed: boolean; settled: SmsResult["state"] | null };

/** A list of people in memory, with the same claim rule as the table: one winner for each row. */
function memoryStore(people: OwedText[], options: { takenByOtherRun?: string[]; claimFails?: string[] } = {}) {
  const calls: string[] = [];
  const rows = new Map<string, Row>(
    people.map((person) => [
      person.id,
      { ...person, claimed: options.takenByOtherRun?.includes(person.id) ?? false, settled: null },
    ]),
  );
  const store: NoticeStore = {
    forgetStale: async () => {
      calls.push("forgetStale");
    },
    gap: async () => GAP,
    owed: async (limit) => {
      calls.push("owed");
      return people.slice(0, limit);
    },
    claim: async (id) => {
      if (options.claimFails?.includes(id)) throw new Error("PostgREST is unreachable");
      const row = rows.get(id) as Row;
      if (row.claimed) return false;
      row.claimed = true;
      return true;
    },
    settle: async (id, state) => {
      const row = rows.get(id) as Row;
      row.settled = state;
      if (state === "refused") row.claimed = false;
    },
  };
  return { store, rows, calls };
}

/** A send that answers from a table of numbers, and records each text it was asked to send. */
function sender(answers: Record<string, SmsResult> = {}) {
  const sentTo: { to: string; body: string }[] = [];
  const send = async (message: { to: string; body: string }): Promise<SmsResult> => {
    sentTo.push(message);
    return answers[message.to] ?? { state: "sent", id: "msg" };
  };
  return { send, sentTo };
}

const ANA = { id: "s1", phone: "+14155550101" };
const BEN = { id: "s2", phone: "+14155550102" };
const CAT = { id: "s3", phone: "+14155550103" };

describe("sendDraftNotice", () => {
  it("texts each person once, with the company and the gap by name, and erases the claim's number", async () => {
    const { store, rows } = memoryStore([ANA, BEN]);
    const { send, sentTo } = sender();

    expect(await sendDraftNotice(store, send)).toEqual({ state: "done", asked: 2, sent: 2, unconfirmed: 0, taken: 0, reasons: [] });
    expect(sentTo).toEqual([
      { to: ANA.phone, body: TEXT },
      { to: BEN.phone, body: TEXT },
    ]);
    expect([...rows.values()].map((row) => [row.claimed, row.settled])).toEqual([
      [true, "sent"],
      [true, "sent"],
    ]);
  });

  it("sends nothing when no one asked", async () => {
    const { store } = memoryStore([]);
    const { send, sentTo } = sender();
    expect(await sendDraftNotice(store, send)).toEqual({ state: "done", asked: 0, sent: 0, unconfirmed: 0, taken: 0, reasons: [] });
    expect(sentTo).toEqual([]);
  });

  it("does not text a person that a different run already claimed", async () => {
    const { store } = memoryStore([ANA, BEN], { takenByOtherRun: ["s1"] });
    const { send, sentTo } = sender();
    // The other run reports its own person, so this run asked one.
    expect(await sendDraftNotice(store, send)).toEqual({ state: "done", asked: 1, sent: 1, unconfirmed: 0, taken: 1, reasons: [] });
    expect(sentTo.map((message) => message.to)).toEqual([BEN.phone]);
  });

  it("gives one text for each person when two runs send for the same gap at the same time", async () => {
    const { store, rows } = memoryStore([ANA, BEN, CAT]);
    const { send, sentTo } = sender();
    const [first, second] = await Promise.all([sendDraftNotice(store, send), sendDraftNotice(store, send)]);

    expect(sentTo.map((message) => message.to).sort()).toEqual([ANA.phone, BEN.phone, CAT.phone]);
    expect((first.state === "done" ? first.sent : 0) + (second.state === "done" ? second.sent : 0)).toBe(3);
    expect([...rows.values()].every((row) => row.settled === "sent")).toBe(true);
  });

  it("does not send when it cannot know who holds the claim", async () => {
    const { store } = memoryStore([ANA, BEN], { claimFails: ["s1"] });
    const { send, sentTo } = sender();
    expect(await sendDraftNotice(store, send)).toEqual({
      state: "done",
      asked: 2,
      sent: 1,
      unconfirmed: 0,
      taken: 0,
      reasons: ["claim_failed"],
    });
    expect(sentTo.map((message) => message.to)).toEqual([BEN.phone]);
  });

  it("releases the claim of a refused text, so it is still owed, and goes on to the next person", async () => {
    const { store, rows } = memoryStore([ANA, BEN]);
    const { send } = sender({ [ANA.phone]: { state: "refused", reason: "rate_limited", forAll: false } });

    expect(await sendDraftNotice(store, send)).toEqual({
      state: "done",
      asked: 2,
      sent: 1,
      unconfirmed: 0,
      taken: 0,
      reasons: ["rate_limited"],
    });
    expect(rows.get("s1")).toMatchObject({ claimed: false, settled: "refused" });
    expect(rows.get("s2")).toMatchObject({ claimed: true, settled: "sent" });
  });

  it("keeps the claim of a text with no answer, so nobody sends it a second time", async () => {
    const { store, rows } = memoryStore([ANA]);
    const { send, sentTo } = sender({ [ANA.phone]: { state: "unconfirmed", reason: "timeout" } });

    expect(await sendDraftNotice(store, send)).toEqual({
      state: "done",
      asked: 1,
      sent: 0,
      unconfirmed: 1,
      taken: 0,
      reasons: ["timeout"],
    });
    expect(rows.get("s1")).toMatchObject({ claimed: true, settled: "unconfirmed" });

    // A later pass reads the table again. The claim is still there, so the person is not texted.
    await sendDraftNotice(store, send);
    expect(sentTo).toHaveLength(1);
  });

  it("stops at a text with no answer, so an outage costs one person their text and not everyone", async () => {
    const { store, rows } = memoryStore([ANA, BEN, CAT]);
    const { send, sentTo } = sender({ [ANA.phone]: { state: "unconfirmed", reason: "http_503" } });

    expect(await sendDraftNotice(store, send)).toEqual({
      state: "done",
      asked: 3,
      sent: 0,
      unconfirmed: 1,
      taken: 0,
      reasons: ["http_503"],
    });
    expect(sentTo).toHaveLength(1);
    expect([...rows.values()].map((row) => row.claimed)).toEqual([true, false, false]);
  });

  it("texts at most one pass of people, and says that more are owed", async () => {
    const crowd = Array.from({ length: PASS_LIMIT + 5 }, (_, index) => ({
      id: `s${index}`,
      phone: `+1415556${String(index).padStart(4, "0")}`,
    }));
    const { store, rows } = memoryStore(crowd);
    const { send, sentTo } = sender();
    const outcome = await sendDraftNotice(store, send);

    expect(outcome).toEqual({ state: "done", asked: PASS_LIMIT + 1, sent: PASS_LIMIT, unconfirmed: 0, taken: 0, reasons: ["pass_limit"] });
    expect(sentTo).toHaveLength(PASS_LIMIT);
    expect([...rows.values()].filter((row) => row.claimed)).toHaveLength(PASS_LIMIT);
    // The row says that the pass did not reach everyone.
    expect(noticeTrace(outcome)).toMatchObject({ status: "failed", title: `Text notice: ${PASS_LIMIT} of ${PASS_LIMIT + 1} sent` });
  });

  it("stops at a refusal that is about the account, and leaves the others unclaimed", async () => {
    const { store, rows } = memoryStore([ANA, BEN, CAT]);
    const { send, sentTo } = sender({ [ANA.phone]: { state: "refused", reason: "insufficient_credit", forAll: true } });

    expect(await sendDraftNotice(store, send)).toEqual({
      state: "done",
      asked: 3,
      sent: 0,
      unconfirmed: 0,
      taken: 0,
      reasons: ["insufficient_credit"],
    });
    expect(sentTo).toHaveLength(1);
    expect([...rows.values()].map((row) => row.claimed)).toEqual([false, false, false]);
  });

  it("says so when a different run claimed everyone, and does not say that no one asked", async () => {
    const { store } = memoryStore([ANA, BEN], { takenByOtherRun: ["s1", "s2"] });
    const { send, sentTo } = sender();
    const outcome = await sendDraftNotice(store, send);

    expect(outcome).toEqual({ state: "done", asked: 0, sent: 0, unconfirmed: 0, taken: 2, reasons: [] });
    expect(sentTo).toEqual([]);
    expect(noticeTrace(outcome)).toMatchObject({ status: "ok", title: "Text notice: a different run sent the texts" });
  });

  it("stops when the pass has taken its time, and leaves the others unclaimed", async () => {
    const { store, rows } = memoryStore([ANA, BEN, CAT]);
    // A clock that the send moves: each text takes 40 seconds.
    let clock = 1_000_000;
    const sentTo: string[] = [];
    const slowSend = async (message: { to: string; body: string }): Promise<SmsResult> => {
      sentTo.push(message.to);
      clock += 40_000;
      return { state: "sent", id: "msg" };
    };
    expect(PASS_BUDGET_MS).toBe(60_000);
    const outcome = await sendDraftNotice(store, slowSend, { now: () => clock });

    // Two sends start inside the budget (at 0 s and at 40 s). The third would start at 80 s.
    expect(outcome).toEqual({ state: "done", asked: 3, sent: 2, unconfirmed: 0, taken: 0, reasons: ["time_budget"] });
    expect(sentTo).toEqual([ANA.phone, BEN.phone]);
    expect(rows.get("s3")).toMatchObject({ claimed: false, settled: null });
    expect(noticeTrace(outcome)).toMatchObject({ status: "failed", title: "Text notice: 2 of 3 sent" });
  });

  it("erases the numbers of old claims before it reads the list, and goes on when that fails", async () => {
    const first = memoryStore([ANA]);
    await sendDraftNotice(first.store, sender().send);
    expect(first.calls).toEqual(["forgetStale", "owed"]);

    const second = memoryStore([ANA]);
    second.store.forgetStale = async () => {
      throw new Error("PostgREST is unreachable");
    };
    expect(await sendDraftNotice(second.store, sender().send)).toEqual({
      state: "done",
      asked: 1,
      sent: 1,
      unconfirmed: 0,
      taken: 0,
      reasons: ["cleanup_failed"],
    });
  });

  it("skips a number that does not open or is not E.164, without a claim and without a send", async () => {
    const { store, rows } = memoryStore([{ id: "s1", phone: null }, { id: "s2", phone: "415-555-0102" }, CAT]);
    const { send, sentTo } = sender();

    expect(await sendDraftNotice(store, send)).toEqual({
      state: "done",
      asked: 3,
      sent: 1,
      unconfirmed: 0,
      taken: 0,
      reasons: ["unreadable_number"],
    });
    expect(sentTo.map((message) => message.to)).toEqual([CAT.phone]);
    // Not claimed and not settled: a wrong key on the runner must not destroy what people gave.
    expect(rows.get("s1")).toMatchObject({ claimed: false, settled: null });
    expect(rows.get("s2")).toMatchObject({ claimed: false, settled: null });
  });

  it("counts a text as sent even when the record of it could not be written", async () => {
    const { store } = memoryStore([ANA]);
    store.settle = async () => {
      throw new Error("PostgREST is unreachable");
    };
    const { send } = sender();
    expect(await sendDraftNotice(store, send)).toEqual({
      state: "done",
      asked: 1,
      sent: 1,
      unconfirmed: 0,
      taken: 0,
      reasons: ["settle_failed"],
    });
  });

  it("reads a send that throws as unconfirmed, and keeps the claim", async () => {
    const { store, rows } = memoryStore([ANA]);
    const outcome = await sendDraftNotice(store, async () => {
      throw new Error("boom");
    });
    expect(outcome).toEqual({ state: "done", asked: 1, sent: 0, unconfirmed: 1, taken: 0, reasons: ["send_failed"] });
    expect(rows.get("s1")).toMatchObject({ claimed: true, settled: "unconfirmed" });
  });

  it("answers failed, and sends nothing, when the list of people cannot be read", async () => {
    const { store } = memoryStore([ANA]);
    store.owed = async () => {
      throw new Error('relation "gap_subscriber" does not exist');
    };
    const { send, sentTo } = sender();
    expect(await sendDraftNotice(store, send)).toEqual({
      state: "failed",
      reason: 'relation "gap_subscriber" does not exist',
    });
    expect(sentTo).toEqual([]);
  });

  it("never returns a phone number", async () => {
    // Every kind of result in one pass. The text with no answer is last, because it stops the pass.
    const { store } = memoryStore([{ id: "s4", phone: "415-555-0104" }, ANA, CAT, BEN]);
    const { send, sentTo } = sender({
      [ANA.phone]: { state: "refused", reason: "http_400", forAll: false },
      [BEN.phone]: { state: "unconfirmed", reason: "network" },
    });
    const outcome = await sendDraftNotice(store, send);
    expect(sentTo).toHaveLength(3);
    expect(outcome).toMatchObject({ asked: 4, sent: 1, unconfirmed: 1, taken: 0, reasons: ["http_400", "network", "unreadable_number"] });
    const text = JSON.stringify([outcome, noticeTrace(outcome)]);
    for (const digits of ["4155550101", "4155550102", "4155550103", "555-0104"]) expect(text).not.toContain(digits);
  });
});

describe("thrownMessage", () => {
  it("reads anything that was thrown, and cuts it short", () => {
    expect(thrownMessage(new Error("boom"))).toBe("boom");
    expect(thrownMessage(undefined)).toBe("undefined");
    expect(thrownMessage("plain words")).toBe("plain words");
    expect(thrownMessage({ code: 7 })).toBe("[object Object]");
    expect(thrownMessage(new Error("x".repeat(900)))).toHaveLength(300);
  });
});

describe("noticeTrace", () => {
  it("says off, with the variable that is missing", () => {
    expect(noticeTrace({ state: "off", reason: "DIAL_API_KEY is not set" })).toEqual({
      kind: "status",
      status: "ok",
      title: "Text notice: off",
      detail: { notice: "draft_sms", state: "off", reason: "DIAL_API_KEY is not set" },
    });
  });

  it("says that no one asked", () => {
    expect(noticeTrace({ state: "done", asked: 0, sent: 0, unconfirmed: 0, taken: 0, reasons: [] })).toMatchObject({
      status: "ok",
      title: "Text notice: no one asked for a text about this request",
    });
  });

  it("counts the texts, and is failed when one was not sent", () => {
    expect(noticeTrace({ state: "done", asked: 3, sent: 3, unconfirmed: 0, taken: 0, reasons: [] })).toMatchObject({
      status: "ok",
      title: "Text notice: 3 of 3 sent",
    });
    expect(noticeTrace({ state: "done", asked: 3, sent: 1, unconfirmed: 1, taken: 0, reasons: ["rate_limited", "timeout"] })).toEqual({
      kind: "status",
      status: "failed",
      title: "Text notice: 1 of 3 sent",
      detail: { notice: "draft_sms", state: "done", asked: 3, sent: 1, unconfirmed: 1, taken: 0, reasons: ["rate_limited", "timeout"] },
    });
  });

  it("says that the list could not be read", () => {
    expect(noticeTrace({ state: "failed", reason: "boom" })).toMatchObject({
      status: "failed",
      title: "Text notice: could not read who asked for a text",
      detail: { reason: "boom" },
    });
  });
});
