/**
 * A person asks for the one text about a gap, against an in-memory database.
 *
 * What matters here: a number is stored only when a text can still come, a request takes back the
 * row of its own answer when the promise cannot be kept, the limits hold and do not look at the
 * number, and no result holds a number.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failWhen, fakeClient, loseAnswerWhen, onQuery, resetDb, seen, tables, type Row } from "./support/fake-db";

vi.mock("@/lib/supabase", () => ({ serviceClient: () => fakeClient() }));

const { DAY_LIMIT, GAP_LIMIT, subscribeToGap } = await import("@/lib/sms/subscribe");
const { openPhone, phoneDigest, sealPhone } = await import("@/lib/sms/phone");
const { PASS_LIMIT } = await import("@/lib/sms/notice");
const { STALE_CLAIM_MS } = await import("@/lib/sms/subscribers");
const { WORKER_ONLINE_TITLE } = await import("@/lib/sms/offer");

const PHONE = "+14155550123";
const OTHER = "+14155550199";
const original = { ...process.env };

const ask = (over: Partial<Parameters<typeof subscribeToGap>[0]> = {}) =>
  subscribeToGap({ projectId: "p1", groupId: "g1", messageId: "m1", phone: PHONE, status: "filed", ...over });

const subscribers = (): Row[] => tables.gap_subscriber ?? [];
const group = (): Row => (tables.feature_request_group ?? [])[0] as Row;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const writes = (): string[] => seen.filter((query) => query.verb !== "select").map((query) => query.verb);

/** A row as an earlier request left it. */
function existing(over: Row = {}): Row {
  const row: Row = {
    id: `old-${subscribers().length}`,
    project_id: "p1",
    group_id: "g1",
    message_id: "m0",
    phone_sealed: sealPhone(PHONE),
    phone_digest: phoneDigest(PHONE),
    consent_at: ago(3 * 86_400_000),
    notified_at: null,
    created_at: ago(3 * 86_400_000),
    ...over,
  };
  (tables.gap_subscriber ??= []).push(row);
  return row;
}

/** `count` more people who are owed a text, each with a number of their own. */
function fill(count: number, over: Row = {}): void {
  for (let index = 0; index < count; index += 1) {
    const number = `+1415556${String(1000 + subscribers().length)}`;
    existing({ message_id: `filled-${subscribers().length}`, phone_sealed: sealPhone(number), phone_digest: phoneDigest(number), ...over });
  }
}

beforeEach(() => {
  resetDb();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  delete process.env.ESCALATION_ENGINE;
  delete process.env.DIAL_API_KEY;
  delete process.env.DIAL_FROM_NUMBER;
  tables.feature_request_group = [{ id: "g1", project_id: "p1", status: "filed" }];
  // The worker says that it can send a text, so the offer is on.
  tables.trace_event = [{ id: 1, project_id: "p1", title: WORKER_ONLINE_TITLE, detail: { engine: "local", sms: true }, created_at: ago(5_000) }];
});

afterEach(() => {
  process.env = { ...original };
});

describe("a request for the text", () => {
  it("stores the sealed number, the digest, the answer, and the time of the consent", async () => {
    const started = Date.now();
    expect(await ask()).toEqual({ state: "subscribed" });

    expect(subscribers()).toHaveLength(1);
    const row = subscribers()[0] as Row;
    expect(row).toMatchObject({ project_id: "p1", group_id: "g1", message_id: "m1", notified_at: null });
    expect(openPhone(String(row.phone_sealed))).toBe(PHONE);
    expect(row.phone_digest).toBe(phoneDigest(PHONE));
    expect(Date.parse(String(row.consent_at))).toBeGreaterThanOrEqual(started);
  });

  it("never stores the number in the clear", async () => {
    await ask();
    expect(JSON.stringify(subscribers())).not.toContain("4155550123");
  });

  it("gives the same digest for the same number and a different one for a different number", () => {
    expect(phoneDigest(PHONE)).toBe(phoneDigest(PHONE));
    expect(phoneDigest(PHONE)).not.toBe(phoneDigest(OTHER));
    expect(phoneDigest(PHONE)).not.toContain("4155550123");
    // The digest key is not the key that opens a number.
    expect(openPhone(phoneDigest(PHONE))).toBeNull();
  });

  it.each(["observed", "filed", "drafting"] as const)("is taken while the gap is %s", async (status) => {
    group().status = status;
    expect((await ask({ status })).state).toBe("subscribed");
    expect(subscribers()).toHaveLength(1);
  });

  it.each(["pr_open", "awaiting_approval", "shipped", "rejected"] as const)(
    "stores nothing when the gap is already %s",
    async (status) => {
      group().status = status;
      expect(await ask({ status })).toEqual({ state: "not_needed", reason: `the gap is ${status}` });
      expect(subscribers()).toEqual([]);
      expect(seen.some((query) => query.table === "gap_subscriber")).toBe(false);
    },
  );
});

describe("when no runner can send the text", () => {
  it("stores nothing when no runner ever said that it can text, and reads no other table", async () => {
    tables.trace_event = [];
    expect(await ask()).toEqual({ state: "unavailable", reason: "the worker is not running" });
    expect(seen).toEqual([{ table: "rpc:runner_heartbeats", verb: "select" }]);
  });

  it("stores nothing when the worker says that it cannot text, whatever the web app's variables are", async () => {
    process.env.DIAL_API_KEY = "test-key";
    process.env.DIAL_FROM_NUMBER = "+14155550100";
    tables.trace_event = [{ id: 1, project_id: "p1", title: WORKER_ONLINE_TITLE, detail: { engine: "local", sms: false }, created_at: ago(5_000) }];
    expect(await ask()).toEqual({ state: "unavailable", reason: "the worker has no text message provider" });
    expect(subscribers()).toEqual([]);
  });

  it("stores the number under forge when the forge runner says that it can text", async () => {
    process.env.ESCALATION_ENGINE = "forge";
    tables.trace_event = [{ id: 1, project_id: "p1", title: WORKER_ONLINE_TITLE, detail: { engine: "forge", sms: true }, created_at: ago(5_000) }];
    expect(await ask()).toEqual({ state: "subscribed" });
  });
});

describe("one number for one gap", () => {
  it("keeps one row when the same request comes twice", async () => {
    expect((await ask()).state).toBe("subscribed");
    const first = { ...(subscribers()[0] as Row) };
    expect((await ask()).state).toBe("subscribed");
    expect(subscribers()).toEqual([first]);
  });

  it("keeps one row when the same person reports the gap from a second answer", async () => {
    await ask();
    expect((await ask({ messageId: "m2" })).state).toBe("subscribed");
    expect(subscribers()).toHaveLength(1);
    expect(subscribers()[0]).toMatchObject({ message_id: "m1" });
  });

  it("leaves a text that is on its way alone", async () => {
    const held = existing({ notified_at: ago(2_000) });
    const before = { ...held };
    expect((await ask({ messageId: "m2" })).state).toBe("subscribed");
    expect(subscribers()).toEqual([before]);
  });

  it("arms a row again one minute after its text ended, because the person asked again", async () => {
    // One minute: the claim is not old, so only "the number was erased" can be the reason.
    const done = existing({ phone_sealed: null, notified_at: ago(60_000) });
    const oldConsent = done.consent_at;
    expect(await ask({ messageId: "m2" })).toEqual({ state: "subscribed" });
    expect(subscribers()).toHaveLength(1);
    const row = subscribers()[0] as Row;
    expect(row.notified_at).toBeNull();
    expect(openPhone(String(row.phone_sealed))).toBe(PHONE);
    expect(row.consent_at).not.toBe(oldConsent);
  });

  it("arms a row again when a run that stopped left its claim behind", async () => {
    existing({ notified_at: ago(STALE_CLAIM_MS + 60_000) });
    expect((await ask({ messageId: "m2" })).state).toBe("subscribed");
    expect((subscribers()[0] as Row).notified_at).toBeNull();
  });

  it("does not touch the same number's row for a different gap or a different project", async () => {
    const elsewhere = existing({ group_id: "g2", phone_sealed: null, notified_at: ago(3_600_000) });
    const tenant = existing({ project_id: "p2", group_id: "g9", phone_sealed: null, notified_at: ago(3_600_000) });
    const before = [{ ...elsewhere }, { ...tenant }];
    expect((await ask()).state).toBe("subscribed");
    expect(subscribers().slice(0, 2)).toEqual(before);
    expect(subscribers()).toHaveLength(3);
  });
});

describe("one number for one answer", () => {
  it("refuses a second number for the same answer and keeps the first", async () => {
    await ask();
    const first = { ...(subscribers()[0] as Row) };
    expect(await ask({ phone: OTHER })).toEqual({
      state: "unavailable",
      reason: "this answer already stored a different number",
    });
    expect(subscribers()).toEqual([first]);
  });

  it("takes a list of numbers only as fast as there are answers", async () => {
    for (let index = 0; index < 20; index += 1) await ask({ phone: `+1415555${String(1000 + index)}` });
    expect(subscribers()).toHaveLength(1);
  });
});

describe("a draft that opens at the same moment", () => {
  it("takes the row back when the gap is past the draft after the write", async () => {
    // The run set the gap to pr_open and read who is owed before this row was there.
    onQuery((query) => {
      if (query.table === "feature_request_group") group().status = "pr_open";
    });
    expect(await ask()).toEqual({ state: "not_needed", reason: "a change was drafted at the same moment" });
    expect(subscribers()).toEqual([]);
  });

  it("keeps the promise when the run already holds the person", async () => {
    onQuery((query) => {
      if (query.table !== "feature_request_group") return;
      group().status = "pr_open";
      for (const row of subscribers()) row.notified_at = new Date().toISOString();
    });
    expect((await ask()).state).toBe("subscribed");
    expect(subscribers()).toHaveLength(1);
  });

  it("does not take back the row of an earlier answer: that promise was made before", async () => {
    const earlier = existing();
    const before = { ...earlier };
    onQuery((query) => {
      if (query.table === "feature_request_group") group().status = "awaiting_approval";
    });
    // The pass that runs now reads this row, so the earlier promise stands.
    expect((await ask({ messageId: "m2" })).state).toBe("subscribed");
    expect(subscribers()).toEqual([before]);
  });

  it("says not needed when a second request for the same answer already took the row back", async () => {
    onQuery((query) => {
      if (query.table === "feature_request_group") group().status = "pr_open";
      if (query.verb === "delete") tables.gap_subscriber = [];
    });
    expect((await ask()).state).toBe("not_needed");
    expect(subscribers()).toEqual([]);
  });

  it("stores nothing when the gap was deleted, and does not say that a change was drafted", async () => {
    onQuery((query) => {
      if (query.table !== "feature_request_group") return;
      // The database deletes the rows of a gap with the gap.
      tables.feature_request_group = [];
      tables.gap_subscriber = [];
    });
    expect(await ask()).toEqual({ state: "unavailable", reason: "the gap is gone" });
    expect(subscribers()).toEqual([]);
  });
});

describe("a gap that holds as many people as one pass texts in its time", () => {
  it("has a limit that one pass can text", () => {
    expect(GAP_LIMIT).toBeLessThanOrEqual(PASS_LIMIT);
  });

  it("takes the last person under the limit", async () => {
    fill(GAP_LIMIT - 1);
    expect((await ask()).state).toBe("subscribed");
    expect(subscribers()).toHaveLength(GAP_LIMIT);
  });

  it("refuses one more before it writes anything", async () => {
    fill(GAP_LIMIT);
    expect(await ask()).toEqual({ state: "unavailable", reason: "the gap holds as many people as one pass texts" });
    expect(subscribers()).toHaveLength(GAP_LIMIT);
    expect(writes()).toEqual([]);
  });

  it("gives the same answer for a number that is in the gap already, so the answer does not say who is", async () => {
    fill(GAP_LIMIT);
    const before = subscribers().map((row) => ({ ...row }));
    const known = await ask({ phone: "+14155561000", messageId: "m2" });
    const unknown = await ask({ phone: OTHER, messageId: "m3" });
    expect(known).toEqual(unknown);
    expect(known.state).toBe("unavailable");
    expect(subscribers()).toEqual(before);
  });

  it("does not count the people who had their text", async () => {
    fill(GAP_LIMIT);
    for (const row of subscribers().slice(0, 10)) Object.assign(row, { phone_sealed: null, notified_at: ago(3_600_000) });
    expect((await ask()).state).toBe("subscribed");
  });

  it("counts this gap only", async () => {
    fill(GAP_LIMIT, { group_id: "g2" });
    expect((await ask()).state).toBe("subscribed");
  });
});

describe("a project that took as many numbers as one day allows", () => {
  /** Rows of today in many gaps, each one a person who had the text, so no gap is full. */
  const today = (count: number, over: Row = {}): void =>
    fill(count, { group_id: "g7", phone_sealed: null, notified_at: ago(60_000), created_at: ago(3_600_000), ...over });

  it("takes the last number under the limit", async () => {
    today(DAY_LIMIT - 1);
    expect((await ask()).state).toBe("subscribed");
  });

  it("refuses one more before it writes anything", async () => {
    today(DAY_LIMIT);
    expect(await ask()).toEqual({ state: "unavailable", reason: "the project took as many numbers as one day allows" });
    expect(writes()).toEqual([]);
  });

  it("does not count a row that is older than 24 hours", async () => {
    today(DAY_LIMIT, { created_at: ago(25 * 3_600_000) });
    expect((await ask()).state).toBe("subscribed");
  });

  it("does not count a different project", async () => {
    today(DAY_LIMIT, { project_id: "p2" });
    expect((await ask()).state).toBe("subscribed");
  });
});

describe("a database that fails", () => {
  it("says unavailable and writes nothing when the table is not there", async () => {
    failWhen((query) => (query.table === "gap_subscriber" ? { message: "relation gap_subscriber does not exist", code: "42P01" } : null));
    expect(await ask()).toEqual({ state: "unavailable", reason: "the limits could not be read" });
    expect(subscribers()).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("takes the row back when the write landed and its answer was lost", async () => {
    loseAnswerWhen((query) => (query.verb === "upsert" ? { message: "timeout" } : null));
    expect(await ask()).toEqual({ state: "unavailable", reason: "the number could not be stored" });
    expect(subscribers()).toEqual([]);
  });

  it("says unavailable when the number could not be armed again, and leaves the old row as it was", async () => {
    const done = existing({ phone_sealed: null, notified_at: ago(3_600_000) });
    const before = { ...done };
    failWhen((query) => (query.verb === "update" ? { message: "timeout" } : null));
    expect(await ask({ messageId: "m2" })).toEqual({ state: "unavailable", reason: "the number could not be stored" });
    expect(subscribers()).toEqual([before]);
  });

  it("takes the row back when the gap's state cannot be read", async () => {
    failWhen((query) => (query.table === "feature_request_group" ? { message: "timeout" } : null));
    expect(await ask()).toEqual({ state: "unavailable", reason: "the gap could not be read" });
    expect(subscribers()).toEqual([]);
  });

  it("does not promise a text when the row cannot be taken back", async () => {
    failWhen((query) =>
      query.table === "feature_request_group" || query.verb === "delete" ? { message: "timeout" } : null,
    );
    // The known limit: the database failed two times in one request, and the row is still there.
    expect(await ask()).toEqual({
      state: "unavailable",
      reason: "the gap could not be read, and the row could not be taken back",
    });
  });

  it("never throws, whatever the client does", async () => {
    onQuery(() => {
      throw new Error("the client is gone");
    });
    await expect(ask()).resolves.toEqual({ state: "unavailable", reason: "the heartbeat of the runner could not be read" });
  });

  it("never throws when only the subscriber table throws", async () => {
    onQuery((query) => {
      if (query.table === "gap_subscriber") throw new Error("the client is gone");
    });
    await expect(ask()).resolves.toEqual({ state: "unavailable", reason: "the limits could not be read" });
  });
});

describe("what a result says", () => {
  it("never holds the number, in any state", async () => {
    const results = [
      await ask(),
      await ask({ phone: OTHER }),
      await ask({ status: "pr_open", messageId: "m2" }),
    ];
    tables.trace_event = [];
    results.push(await ask({ messageId: "m3" }));
    const said = JSON.stringify(results);
    expect(said).not.toContain("4155550123");
    expect(said).not.toContain("4155550199");
    expect(results.map((result) => result.state)).toEqual(["subscribed", "unavailable", "not_needed", "unavailable"]);
  });
});
