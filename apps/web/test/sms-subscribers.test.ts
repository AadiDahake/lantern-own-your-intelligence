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
const { draftNoticeFor, gapSubscribers } = await import("@/lib/sms/subscribers");
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
