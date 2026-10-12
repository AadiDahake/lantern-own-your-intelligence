/**
 * The people who asked for a text, against a fake PostgREST client, and the notice wired from the
 * environment with the provider mocked at the fetch boundary.
 *
 * What matters here is the filters: the claim only lands where `notified_at` is still null, every
 * read is scoped to the project and the group, and nothing is read at all when texts are off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Op = [string, unknown[]];
type Query = { table: string; ops: Op[] };
type Answer = { data: unknown; error: { message: string } | null };

/** The queries the code under test made, in order. */
let queries: Query[] = [];
/** What a query answers. Each test sets it. */
let respond: (query: Query) => Answer = () => ({ data: null, error: null });

class FakeQuery implements PromiseLike<Answer> {
  private readonly ops: Op[] = [];

  constructor(private readonly table: string) {}

  private step(name: string, args: unknown[]): this {
    this.ops.push([name, args]);
    return this;
  }

  select(...args: unknown[]): this {
    return this.step("select", args);
  }
  update(...args: unknown[]): this {
    return this.step("update", args);
  }
  insert(...args: unknown[]): this {
    return this.step("insert", args);
  }
  in(...args: unknown[]): this {
    return this.step("in", args);
  }
  eq(...args: unknown[]): this {
    return this.step("eq", args);
  }
  match(...args: unknown[]): this {
    return this.step("match", args);
  }
  lt(...args: unknown[]): this {
    return this.step("lt", args);
  }
  abortSignal(signal: unknown): this {
    // The signal itself is not comparable; what matters is that the query has one.
    return this.step("abortSignal", [signal instanceof AbortSignal]);
  }
  is(...args: unknown[]): this {
    return this.step("is", args);
  }
  not(...args: unknown[]): this {
    return this.step("not", args);
  }
  order(...args: unknown[]): this {
    return this.step("order", args);
  }
  limit(...args: unknown[]): this {
    return this.step("limit", args);
  }
  maybeSingle(): this {
    return this.step("maybeSingle", []);
  }

  then<A = Answer, B = never>(
    onfulfilled?: ((value: Answer) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const query = { table: this.table, ops: this.ops };
    queries.push(query);
    return Promise.resolve(respond(query)).then(onfulfilled, onrejected);
  }
}

vi.mock("@/lib/supabase", () => ({
  serviceClient: () => ({ from: (table: string) => new FakeQuery(table) }),
}));

const { openPhone, sealPhone } = await import("@/lib/sms/phone");
const { draftNoticeFor, draftStillOpen, draftSweep, gapSubscribers, owedGaps, runDraftSweeps } = await import(
  "@/lib/sms/subscribers"
);
const { decryptToken, encryptToken } = await import("@/lib/github/secret");

const IDS = { projectId: "p1", groupId: "g1" };
const original = { ...process.env };

const has = (query: Query, name: string, ...args: unknown[]): boolean =>
  query.ops.some(([op, opArgs]) => op === name && JSON.stringify(opArgs) === JSON.stringify(args));
const patchOf = (query: Query): Record<string, unknown> | null => {
  const update = query.ops.find(([op]) => op === "update");
  return update ? (update[1][0] as Record<string, unknown>) : null;
};

beforeEach(() => {
  queries = [];
  respond = () => ({ data: null, error: null });
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

afterEach(() => {
  process.env = { ...original };
  vi.unstubAllGlobals();
});

describe("a stored phone number", () => {
  it("opens to the number that was sealed, and never looks like it", () => {
    const sealed = sealPhone("+14155550123");
    expect(sealed).not.toContain("4155550123");
    expect(sealed.split(".")).toHaveLength(3);
    expect(openPhone(sealed)).toBe("+14155550123");
    expect(sealPhone("+14155550123")).not.toBe(sealed);
  });

  it("does not open under the key of a different purpose", () => {
    // A phone number and the GitHub token are sealed apart: neither call reads the other's value.
    expect(decryptToken(sealPhone("+14155550123"))).toBeNull();
    expect(openPhone(encryptToken("gho_not_a_real_token"))).toBeNull();
  });

  it("reads as null after the service role key changes, or when the value is damaged", () => {
    const sealed = sealPhone("+14155550123");
    expect(openPhone(`${sealed}A`)).toBeNull();
    expect(openPhone("")).toBeNull();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "a-different-key";
    expect(openPhone(sealed)).toBeNull();
    // The key that was kept for the old secret is not used for the new one, in either direction.
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    expect(openPhone(sealed)).toBe("+14155550123");
  });

  it("opens a long list without one slow key derivation for each row", () => {
    const sealed = Array.from({ length: 300 }, (_, index) => sealPhone(`+1415555${String(1000 + index)}`));
    const started = performance.now();
    const opened = sealed.map((value) => openPhone(value));
    const elapsed = performance.now() - started;

    expect(opened[299]).toBe("+14155551299");
    // One derivation takes about 25 ms, so 300 of them take seconds. With the key kept, the
    // whole list takes a few milliseconds; the limit leaves room for a slow machine.
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe("gapSubscribers", () => {
  it("reads the company and the gap's title, scoped to the project", async () => {
    respond = (query) => ({ data: query.table === "project" ? { name: "NovaAir" } : { title: "Seat a party together" }, error: null });
    expect(await gapSubscribers(IDS).gap()).toEqual({ company: "NovaAir", title: "Seat a party together" });

    const group = queries.find((query) => query.table === "feature_request_group") as Query;
    expect(has(group, "eq", "id", "g1")).toBe(true);
    expect(has(group, "eq", "project_id", "p1")).toBe(true);
    expect(has(queries.find((query) => query.table === "project") as Query, "eq", "id", "p1")).toBe(true);
  });

  it("lists only the people of this gap who are still owed a text, oldest first", async () => {
    respond = () => ({
      data: [
        { id: "s1", phone_sealed: sealPhone("+14155550101") },
        { id: "s2", phone_sealed: "not-a-sealed-value" },
      ],
      error: null,
    });
    expect(await gapSubscribers(IDS).owed(50)).toEqual([
      { id: "s1", phone: "+14155550101" },
      { id: "s2", phone: null },
    ]);

    const [query] = queries as [Query];
    expect(query.table).toBe("gap_subscriber");
    expect(has(query, "eq", "project_id", "p1")).toBe(true);
    expect(has(query, "eq", "group_id", "g1")).toBe(true);
    expect(has(query, "is", "notified_at", null)).toBe(true);
    expect(has(query, "not", "phone_sealed", "is", null)).toBe(true);
    expect(has(query, "order", "created_at", { ascending: true })).toBe(true);
    expect(has(query, "limit", 50)).toBe(true);
    expect(has(query, "abortSignal", true)).toBe(true);
  });

  it("claims a person with one update that only lands where nobody has claimed them", async () => {
    respond = () => ({ data: { id: "s1" }, error: null });
    expect(await gapSubscribers(IDS).claim("s1")).toBe(true);

    const [query] = queries as [Query];
    expect(Object.keys(patchOf(query) ?? {})).toEqual(["notified_at"]);
    expect(patchOf(query)?.notified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The row must be this person, in this project and this gap.
    expect(has(query, "match", { id: "s1", project_id: "p1", group_id: "g1" })).toBe(true);
    expect(has(query, "is", "notified_at", null)).toBe(true);
    expect(has(query, "abortSignal", true)).toBe(true);

    // No row came back: a different run holds the claim.
    respond = () => ({ data: null, error: null });
    expect(await gapSubscribers(IDS).claim("s1")).toBe(false);
  });

  it("erases the number after a text is sent or may have gone, and releases the claim after a refusal", async () => {
    const store = gapSubscribers(IDS);
    await store.settle("s1", "sent");
    await store.settle("s2", "unconfirmed");
    await store.settle("s3", "refused");

    expect(queries.map((query) => patchOf(query))).toEqual([
      { phone_sealed: null },
      { phone_sealed: null },
      { notified_at: null },
    ]);
    expect(
      queries.every((query, index) => has(query, "match", { id: `s${index + 1}`, project_id: "p1", group_id: "g1" })),
    ).toBe(true);
    expect(queries.every((query) => has(query, "abortSignal", true))).toBe(true);
  });

  it("erases the number of a claim that is older than any send, for the whole project", async () => {
    const before = Date.now();
    await gapSubscribers(IDS).forgetStale();

    const [query] = queries as [Query];
    expect(query.table).toBe("gap_subscriber");
    expect(patchOf(query)).toEqual({ phone_sealed: null });
    expect(has(query, "eq", "project_id", "p1")).toBe(true);
    expect(has(query, "not", "phone_sealed", "is", null)).toBe(true);
    const cutoff = query.ops.find(([op]) => op === "lt") as Op;
    expect(cutoff[1][0]).toBe("notified_at");
    // Fifteen minutes back: a claim is held for seconds, so an older one is left over.
    const age = before - Date.parse(String(cutoff[1][1]));
    expect(age).toBeGreaterThanOrEqual(15 * 60_000 - 5);
    expect(age).toBeLessThan(15 * 60_000 + 5_000);
    // A row that is still owed (no claim) is never matched by a "less than" on a null.
    expect(query.ops.some(([op, args]) => op === "is" && args[0] === "notified_at")).toBe(false);
  });

  it("raises a database error, so the rule above it can refuse to send", async () => {
    respond = () => ({ data: null, error: { message: "relation does not exist" } });
    const store = gapSubscribers(IDS);
    await expect(store.owed(50)).rejects.toThrow("relation does not exist");
    await expect(store.claim("s1")).rejects.toThrow("relation does not exist");
    await expect(store.settle("s1", "sent")).rejects.toThrow("relation does not exist");
    await expect(store.gap()).rejects.toThrow("relation does not exist");
    await expect(store.forgetStale()).rejects.toThrow("relation does not exist");
  });
});

describe("draftNoticeFor", () => {
  it.each([
    [{}, "DIAL_API_KEY is not set"],
    [{ DIAL_API_KEY: "test-key-not-real" }, "DIAL_FROM_NUMBER is not set"],
    [{ DIAL_FROM_NUMBER: "+14155550100" }, "DIAL_API_KEY is not set"],
    [{ DIAL_API_KEY: "", DIAL_FROM_NUMBER: "" }, "DIAL_API_KEY is not set"],
  ])("is off with %j: no query and no call", async (env, reason) => {
    delete process.env.DIAL_API_KEY;
    delete process.env.DIAL_FROM_NUMBER;
    Object.assign(process.env, env);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await draftNoticeFor(IDS)()).toEqual({ state: "off", reason });
    expect(queries).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("texts the people of the gap through the provider when both variables are set", async () => {
    process.env.DIAL_API_KEY = "test-key-not-real";
    process.env.DIAL_FROM_NUMBER = "+14155550100";
    process.env.DIAL_API_URL = "https://dial.test/";
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return new Response(JSON.stringify({ message: { id: "msg_1" } }), { status: 201 });
      }),
    );
    respond = (query) => {
      if (query.table === "project") return { data: { name: "NovaAir" }, error: null };
      if (query.table === "feature_request_group") return { data: { title: "Seat a party together" }, error: null };
      const patch = patchOf(query);
      if (!patch) return { data: [{ id: "s1", phone_sealed: sealPhone("+14155550101") }], error: null };
      return { data: "notified_at" in patch ? { id: "s1" } : null, error: null };
    };

    expect(await draftNoticeFor(IDS)()).toEqual({ state: "done", asked: 1, sent: 1, unconfirmed: 0, taken: 0, reasons: [] });
    expect(requests).toEqual([
      {
        url: "https://dial.test/api/v1/messages",
        body: {
          to: "+14155550101",
          fromNumber: "+14155550100",
          body: 'NovaAir: you asked for a text about "Seat a party together". A change for it is now drafted and the team reviews it next. This is the only text for this request.',
        },
      },
    ]);
    // The old claims are cleaned first, the claim comes before the send, and the number is
    // erased after it.
    const writes = queries.filter((query) => patchOf(query) !== null);
    expect(writes.map((query) => [Object.keys(patchOf(query) as object)[0], query.ops.some(([op]) => op === "lt")])).toEqual([
      ["phone_sealed", true],
      ["notified_at", false],
      ["phone_sealed", false],
    ]);
  });

  it("has nobody to text for a run with no request group, and reads nothing", async () => {
    process.env.DIAL_API_KEY = "test-key-not-real";
    process.env.DIAL_FROM_NUMBER = "+14155550100";
    expect(await draftNoticeFor({ projectId: "p1", groupId: null })()).toEqual({
      state: "done",
      asked: 0,
      sent: 0,
      unconfirmed: 0,
      taken: 0,
      reasons: [],
    });
    expect(queries).toEqual([]);
  });
});

describe("owedGaps", () => {
  it("reads, in one query, the gaps with an open draft that no person decided and a person who is owed", async () => {
    respond = () => ({
      data: [
        // A relation to one row comes back as an object.
        { id: "g1", project_id: "p1", escalation: { id: "e1" }, gap_subscriber: [{ id: "s1" }] },
        { id: "g2", project_id: "p2", escalation: { id: "e2" }, gap_subscriber: [{ id: "s9" }] },
      ],
      error: null,
    });
    expect(await owedGaps(1000)).toEqual([
      { projectId: "p1", groupId: "g1", escalationId: "e1" },
      { projectId: "p2", groupId: "g2", escalationId: "e2" },
    ]);

    const [query] = queries as [Query];
    expect(queries).toHaveLength(1);
    expect(query.table).toBe("feature_request_group");
    // Each inner join keeps a gap only when a row of it matches the filters below. The run is
    // the gap's own run, joined through `feature_request_group.escalation_id`. It is not any run
    // of the gap: a run that only carried a count can stay at `awaiting_approval` after it
    // failed, and that must not keep the gap in the list after the real draft was decided.
    expect(has(query, "select", "id, project_id, escalation!escalation_id!inner(id), gap_subscriber!inner(id)")).toBe(true);
    // The pull request is open: the gap says so, and it says so only after the pull request exists.
    expect(has(query, "in", "status", ["pr_open", "awaiting_approval"])).toBe(true);
    // No person has decided it: the gap's own run is a full run in the same state with no
    // approval. The gap keeps `awaiting_approval` after the decision, so the gap alone is not enough.
    expect(has(query, "in", "escalation.status", ["pr_open", "awaiting_approval"])).toBe(true);
    expect(has(query, "eq", "escalation.mode", "full")).toBe(true);
    expect(has(query, "is", "escalation.approval", null)).toBe(true);
    expect(has(query, "is", "gap_subscriber.notified_at", null)).toBe(true);
    expect(has(query, "not", "gap_subscriber.phone_sealed", "is", null)).toBe(true);
    // One person is enough to know that the gap is owed, and the gaps have a limit of their own.
    expect(has(query, "limit", 1, { referencedTable: "gap_subscriber" })).toBe(true);
    expect(has(query, "limit", 1000)).toBe(true);
    // The same order on each read, so the same gaps are past the end of a full list.
    expect(query.ops.filter(([op]) => op === "order")).toEqual([
      ["order", ["last_seen", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
    ]);
    expect(has(query, "abortSignal", true)).toBe(true);
    // No phone number is read here: the columns that come back hold no number and no digest.
    const selected = String((query.ops.find(([op]) => op === "select") as Op)[1][0]);
    expect(selected).not.toMatch(/phone/);
  });

  it("reads the run also from a list, and gives a gap with no run in the answer no trace to write to", async () => {
    respond = () => ({
      data: [
        { id: "g1", project_id: "p1", escalation: [{ id: "e1" }] },
        { id: "g2", project_id: "p1", escalation: null },
        { id: "g3", project_id: "p1" },
      ],
      error: null,
    });
    expect((await owedGaps(1000)).map((gap) => gap.escalationId)).toEqual(["e1", null, null]);
  });

  it("raises a database error, so the sweep sends nothing", async () => {
    respond = () => ({ data: null, error: { message: "Could not find a relationship" } });
    await expect(owedGaps(1000)).rejects.toThrow("Could not find a relationship");
  });
});

describe("draftStillOpen", () => {
  it("asks for one gap with the same rule as the list, scoped to the gap's project", async () => {
    respond = () => ({ data: [{ id: "g1", escalation: { id: "e1" } }], error: null });
    expect(await draftStillOpen({ projectId: "p1", groupId: "g1" })).toBe(true);

    const [query] = queries as [Query];
    expect(query.table).toBe("feature_request_group");
    expect(has(query, "select", "id, escalation!escalation_id!inner(id)")).toBe(true);
    expect(has(query, "eq", "escalation.mode", "full")).toBe(true);
    expect(has(query, "eq", "id", "g1")).toBe(true);
    expect(has(query, "eq", "project_id", "p1")).toBe(true);
    expect(has(query, "in", "status", ["pr_open", "awaiting_approval"])).toBe(true);
    expect(has(query, "in", "escalation.status", ["pr_open", "awaiting_approval"])).toBe(true);
    expect(has(query, "is", "escalation.approval", null)).toBe(true);
    expect(has(query, "abortSignal", true)).toBe(true);
  });

  it("is false when no row comes back: the draft was decided, or the gap is gone", async () => {
    respond = () => ({ data: [], error: null });
    expect(await draftStillOpen({ projectId: "p1", groupId: "g1" })).toBe(false);
  });

  it("raises a database error, so the pass is not made on a guess", async () => {
    respond = () => ({ data: null, error: { message: "timeout" } });
    await expect(draftStillOpen({ projectId: "p1", groupId: "g1" })).rejects.toThrow("timeout");
  });
});

describe("draftSweep", () => {
  type Call = { method: string; url: string; body: Record<string, unknown> | null };

  /** The provider at the fetch boundary: the numbers of the account, and one message. */
  function provider(numbers: () => Response) {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        calls.push({ method, url, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
        if (method === "GET") return numbers();
        return new Response(JSON.stringify({ message: { id: "msg_1" } }), { status: 201 });
      }),
    );
    return calls;
  }

  /** False from the moment that a person decided the draft. */
  let draftOpen = true;

  /** One gap with an open draft and one person who is owed a text. */
  function oneOwedPerson(): void {
    draftOpen = true;
    respond = (query) => {
      const selected = String(query.ops.find(([op]) => op === "select")?.[1][0] ?? "");
      if (query.table === "trace_event") return { data: null, error: null };
      if (query.table === "project") return { data: { name: "NovaAir" }, error: null };
      if (query.table === "feature_request_group") {
        // The list of gaps, the question about one gap just before its pass, and the gap's title.
        if (selected.includes("gap_subscriber")) {
          return { data: [{ id: "g1", project_id: "p1", escalation: { id: "e1" } }], error: null };
        }
        if (selected.includes("escalation")) return { data: draftOpen ? [{ id: "g1" }] : [], error: null };
        return { data: { title: "Seat a party together" }, error: null };
      }
      const patch = patchOf(query);
      if (!patch) return { data: [{ id: "s1", phone_sealed: sealPhone("+14155550101") }], error: null };
      return { data: "notified_at" in patch ? { id: "s1" } : null, error: null };
    };
  }

  const traceRows = (): Record<string, unknown>[] =>
    queries
      .filter((query) => query.table === "trace_event")
      .map((query) => (query.ops.find(([op]) => op === "insert") as Op)[1][0] as Record<string, unknown>);

  beforeEach(() => {
    process.env.DIAL_API_KEY = "test-key-not-real";
    process.env.DIAL_FROM_NUMBER = "+14155550100";
    process.env.DIAL_API_URL = "https://dial.test/";
  });

  it.each([
    [{ DIAL_API_KEY: "" }, "DIAL_API_KEY is not set"],
    [{ DIAL_FROM_NUMBER: "" }, "DIAL_FROM_NUMBER is not set"],
    // A value of spaces is blank, as it is for the worker.
    [{ DIAL_API_KEY: "  " }, "DIAL_API_KEY is not set"],
    [{ DIAL_FROM_NUMBER: " " }, "DIAL_FROM_NUMBER is not set"],
  ])("is off with %j: no query and no call", async (env, reason) => {
    Object.assign(process.env, env);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await draftSweep()()).toEqual({ state: "off", reason });
    expect(queries).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the provider, then texts the person who is still owed, and says so in the run's trace", async () => {
    const calls = provider(() => new Response(JSON.stringify({ numbers: [] }), { status: 200 }));
    oneOwedPerson();

    expect(await draftSweep()()).toEqual({ state: "swept", gaps: 1, sent: 1, left: 0, stop: null });
    // The read-only question comes first, and the one text after it.
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://dial.test/api/v1/numbers",
      "POST https://dial.test/api/v1/messages",
    ]);
    expect(calls[1]?.body).toEqual({
      to: "+14155550101",
      fromNumber: "+14155550100",
      body: 'NovaAir: you asked for a text about "Seat a party together". A change for it is now drafted and the team reviews it next. This is the only text for this request.',
    });
    // The same pass as at the draft: the claim before the send, the number erased after it, and
    // each one scoped to the gap's own project.
    const writes = queries.filter((query) => patchOf(query) !== null);
    expect(writes.map((query) => Object.keys(patchOf(query) as object)[0])).toEqual([
      "phone_sealed",
      "notified_at",
      "phone_sealed",
    ]);
    expect(has(writes[1] as Query, "match", { id: "s1", project_id: "p1", group_id: "g1" })).toBe(true);
    expect(traceRows()).toEqual([
      {
        project_id: "p1",
        escalation_id: "e1",
        source: "forge",
        kind: "status",
        status: "ok",
        title: "Text notice, later pass: 1 of 1 sent",
        detail: { notice: "draft_sms", pass: "later", state: "done", asked: 1, sent: 1, unconfirmed: 0, taken: 0, reasons: [] },
      },
    ]);
    expect(JSON.stringify(traceRows())).not.toContain("4155550101");
  });

  it("claims no one and sends nothing when the provider does not answer the question", async () => {
    const calls = provider(() => new Response("upstream is down", { status: 503 }));
    oneOwedPerson();

    expect(await draftSweep()()).toEqual({ state: "provider", reason: "http_503", gaps: 1 });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
    // No row of a person is read or written: the only queries are the list of gaps and the row.
    expect(queries.map((query) => query.table)).toEqual(["feature_request_group", "trace_event"]);
    // The row is written with a time limit, as each query of the store is.
    expect(has(queries[1] as Query, "abortSignal", true)).toBe(true);
    expect(traceRows()).toEqual([
      {
        project_id: "p1",
        escalation_id: "e1",
        source: "forge",
        kind: "status",
        status: "failed",
        title: "Text notice, later pass: not sent yet, the text message provider did not answer",
        detail: { notice: "draft_sms", pass: "later", state: "waiting", reason: "http_503" },
      },
    ]);
  });

  it("makes no pass for a gap whose draft a person decided after the list was read", async () => {
    const calls = provider(() => new Response(JSON.stringify({ numbers: [] }), { status: 200 }));
    oneOwedPerson();
    draftOpen = false;

    expect(await draftSweep()()).toEqual({ state: "swept", gaps: 1, sent: 0, left: 0, stop: null });
    // The text says that the team reviews the change next. After the decision that is false, so
    // no person is read, no one is claimed, and nothing is sent or said.
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
    expect(queries.map((query) => query.table)).toEqual(["feature_request_group", "feature_request_group"]);
    expect(traceRows()).toEqual([]);
  });

  it("asks about the gap again just before its pass, scoped to the gap's project", async () => {
    provider(() => new Response(JSON.stringify({ numbers: [] }), { status: 200 }));
    oneOwedPerson();
    await draftSweep()();
    const asked = queries.filter((query) => query.table === "feature_request_group")[1] as Query;
    expect(has(asked, "eq", "id", "g1")).toBe(true);
    expect(has(asked, "eq", "project_id", "p1")).toBe(true);
    // Before each query about a person.
    expect(queries.indexOf(asked)).toBeLessThan(queries.findIndex((query) => query.table === "gap_subscriber"));
  });

  it("stops the sweep at a refusal that is not about one person, and waits before the next send", async () => {
    oneOwedPerson();
    // The account has no credit: the provider answers the question and refuses each text.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit = {}) =>
        (init.method ?? "GET") === "GET"
          ? new Response(JSON.stringify({ numbers: [] }), { status: 200 })
          : new Response(JSON.stringify({ error: "no credit", code: "insufficient_credit" }), { status: 402 }),
      ),
    );
    const sweep = draftSweep();
    expect(await sweep()).toEqual({ state: "swept", gaps: 1, sent: 0, left: 1, stop: "refused" });
    // The claim went back, so the person is still owed and keeps the number.
    const writes = queries.filter((query) => patchOf(query) !== null).map((query) => patchOf(query));
    expect(writes.at(-1)).toEqual({ notified_at: null });
    expect(traceRows().map((row) => [row.title, (row.detail as { reasons: string[] }).reasons])).toEqual([
      ["Text notice, later pass: 0 of 1 sent", ["insufficient_credit"]],
    ]);
    const after = queries.length;
    expect(await sweep()).toEqual({ state: "waiting" });
    expect(queries).toHaveLength(after);
  });

  it("reads a page from a wrong address as no answer, so a wrong address costs no person a text", async () => {
    const calls = provider(() => new Response("<html>Welcome</html>", { status: 200 }));
    oneOwedPerson();

    expect(await draftSweep()()).toEqual({ state: "provider", reason: "unreadable_answer", gaps: 1 });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("keeps its waits from one call to the next, and a second sweep has waits of its own", async () => {
    provider(() => new Response(JSON.stringify({ numbers: [] }), { status: 200 }));
    oneOwedPerson();
    // The provider takes no text: each send has no confirmed answer.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit = {}) =>
        (init.method ?? "GET") === "GET"
          ? new Response(JSON.stringify({ numbers: [] }), { status: 200 })
          : new Response("bad gateway", { status: 502 }),
      ),
    );

    const sweep = draftSweep();
    expect(await sweep()).toEqual({ state: "swept", gaps: 1, sent: 0, left: 0, stop: "unconfirmed" });
    const after = queries.length;
    // The next send waits, so the second call reads nothing.
    expect(await sweep()).toEqual({ state: "waiting" });
    expect(queries).toHaveLength(after);
    expect((await draftSweep()()).state).toBe("swept");
  });

  it("writes a row that failed again with the next pass of the gap", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    try {
      // The provider refuses the number each time, so the gap stays owed and says the same row.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit = {}) =>
          (init.method ?? "GET") === "GET"
            ? new Response(JSON.stringify({ numbers: [] }), { status: 200 })
            : new Response(JSON.stringify({ error: "no" }), { status: 400 }),
        ),
      );
      oneOwedPerson();
      const answer = respond;
      let traceFails = true;
      respond = (query) =>
        query.table === "trace_event" && traceFails ? { data: null, error: { message: "trace_event is locked" } } : answer(query);

      const sweep = draftSweep();
      expect(await sweep()).toEqual({ state: "swept", gaps: 1, sent: 0, left: 1, stop: null });
      traceFails = false;
      // The gap waits 10 minutes. After that the pass runs again, and the row is written now.
      vi.advanceTimersByTime(10 * 60_000);
      expect(await sweep()).toEqual({ state: "swept", gaps: 1, sent: 0, left: 1, stop: null });
      expect(traceRows().map((row) => row.title)).toEqual([
        "Text notice, later pass: 0 of 1 sent",
        "Text notice, later pass: 0 of 1 sent",
      ]);
      // The third pass says the same thing, and that row is there now, so nothing is written.
      vi.advanceTimersByTime(20 * 60_000);
      await sweep();
      expect(traceRows()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reject when the row cannot be written, and still counts the text", async () => {
    provider(() => new Response(JSON.stringify({ numbers: [] }), { status: 200 }));
    oneOwedPerson();
    const answer = respond;
    respond = (query) =>
      query.table === "trace_event" ? { data: null, error: { message: "trace_event is locked" } } : answer(query);

    expect(await draftSweep()()).toEqual({ state: "swept", gaps: 1, sent: 1, left: 0, stop: null });
  });
});

describe("runDraftSweeps", () => {
  beforeEach(() => {
    process.env.DIAL_API_KEY = "test-key-not-real";
    process.env.DIAL_FROM_NUMBER = "+14155550100";
    process.env.DIAL_API_URL = "https://dial.test/";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sweeps for the first time 5 minutes after the start, and then each 5 minutes", async () => {
    delete process.env.DIAL_API_KEY;
    const lines: string[] = [];
    runDraftSweeps((line) => lines.push(line));

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(lines).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(lines).toEqual(["text sweep: off, DIAL_API_KEY is not set"]);
    // The timer goes on, and a sweep that says the same thing prints nothing.
    process.env.DIAL_API_KEY = "test-key-not-real";
    respond = () => ({ data: null, error: { message: "the database is down" } });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(lines).toEqual(["text sweep: off, DIAL_API_KEY is not set", "text sweep: failed (the database is down)"]);
  });

  it("keeps the waits of the sweep from one tick to the next", async () => {
    // One gap with one person, and a provider that takes no text: the first sweep ends at a
    // text with no confirmed answer, so the second one must wait and read nothing.
    respond = (query) => {
      const selected = String(query.ops.find(([op]) => op === "select")?.[1][0] ?? "");
      if (query.table === "trace_event") return { data: null, error: null };
      if (query.table === "project") return { data: { name: "NovaAir" }, error: null };
      if (query.table === "feature_request_group") {
        if (selected.includes("gap_subscriber")) return { data: [{ id: "g1", project_id: "p1", escalation: { id: "e1" } }], error: null };
        if (selected.includes("escalation")) return { data: [{ id: "g1" }], error: null };
        return { data: { title: "Seat a party together" }, error: null };
      }
      const patch = patchOf(query);
      if (!patch) return { data: [{ id: "s1", phone_sealed: sealPhone("+14155550101") }], error: null };
      return { data: "notified_at" in patch ? { id: "s1" } : null, error: null };
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit = {}) =>
        (init.method ?? "GET") === "GET"
          ? new Response(JSON.stringify({ numbers: [] }), { status: 200 })
          : new Response("bad gateway", { status: 502 }),
      ),
    );
    const lines: string[] = [];
    runDraftSweeps((line) => lines.push(line));

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(lines).toEqual([
      "text sweep: 0 texts sent in 1 pass, 0 gaps still with a person who is owed, stopped at a text with no confirmed answer",
    ]);
    const after = queries.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(queries).toHaveLength(after);
    expect(lines).toHaveLength(1);
  });
});
