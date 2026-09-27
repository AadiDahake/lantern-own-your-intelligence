/**
 * The forge queue's claims, against a fake PostgREST client.
 *
 * What matters here is the filters, because they are what keeps two runners off one row and what
 * keeps the runner away from the queued forge rows the widget opens without a specification.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Op = [string, unknown[]];
type Query = { table: string; ops: Op[] };

/** The queries the code under test made, in order. */
const queries: Query[] = [];
/** What each `maybeSingle()` answers, in order. */
let answers: (Record<string, unknown> | null)[] = [];

class FakeQuery {
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
  in(...args: unknown[]): this {
    return this.step("in", args);
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

  async maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    queries.push({ table: this.table, ops: this.ops });
    return { data: answers.shift() ?? null, error: null };
  }
}

vi.mock("@/lib/supabase", () => ({
  serviceClient: () => ({ from: (table: string) => new FakeQuery(table) }),
}));

const { claimDecidedApproval, claimQueuedRun, toQueueRow } = await import("@/lib/forge/queue");

/** The query the code under test made nth, or a failure that says which one is missing. */
function queryAt(index: number): Query {
  const query = queries[index];
  if (!query) throw new Error(`only ${queries.length} queries were made, wanted #${index}`);
  return query;
}

/** Every argument pair passed to `op` in one query, as `column=value` strings. */
const filters = (query: Query, op: string): string[] =>
  query.ops.filter(([name]) => name === op).map(([, args]) => `${String(args[0])}=${JSON.stringify(args[1])}`);

/** The patch of a query that starts with `update`. */
function patchOf(query: Query): Record<string, unknown> {
  const first = query.ops[0];
  if (!first || first[0] !== "update") throw new Error("this query is not an update");
  return first[1][0] as Record<string, unknown>;
}

const ROW = {
  id: "esc-1",
  project_id: "proj-1",
  group_id: "grp-1",
  status: "queued",
  request: { title: "Add automatic family seat selection" },
  capability_ir: { intent: "seat_party_together" },
  capability_spec_id: "spec-1",
  pr_url: "https://github.com/o/r/pull/7",
  pr_number: 7,
  winning_candidate_id: "cand-b",
  approval: { approved: true, note: "ship it" },
};

beforeEach(() => {
  queries.length = 0;
  answers = [];
});

describe("toQueueRow", () => {
  it("maps a row onto the shape the runner reads", () => {
    expect(toQueueRow(ROW)).toEqual({
      id: "esc-1",
      projectId: "proj-1",
      groupId: "grp-1",
      status: "queued",
      title: "Add automatic family seat selection",
      capabilityIr: { intent: "seat_party_together" },
      capabilitySpecId: "spec-1",
      prUrl: "https://github.com/o/r/pull/7",
      prNumber: 7,
      winningCandidateId: "cand-b",
      approval: { approved: true, note: "ship it" },
    });
  });

  it("keeps every optional column null rather than the string 'null'", () => {
    const row = toQueueRow({ id: "esc-2", project_id: "proj-1", status: "queued", request: null });
    expect(row).toMatchObject({
      groupId: null,
      capabilitySpecId: null,
      prUrl: null,
      prNumber: null,
      winningCandidateId: null,
      approval: null,
      title: "Lantern change",
    });
  });
});

describe("claimQueuedRun", () => {
  it("only looks at forge rows that are queued and carry a specification", async () => {
    answers = [null];
    expect(await claimQueuedRun()).toBeNull();
    expect(queries).toHaveLength(1);
    expect(filters(queryAt(0), "eq")).toEqual(['engine="forge"', 'status="queued"']);
    // The widget opens queued forge rows with no IR; those are not runnable.
    expect(filters(queryAt(0), "not")).toEqual(['capability_ir="is"']);
  });

  it("claims the row by moving it to drafting, conditional on it still being queued", async () => {
    answers = [{ id: "esc-1" }, ROW];
    const claimed = await claimQueuedRun();

    expect(claimed?.id).toBe("esc-1");
    const update = queryAt(1);
    expect(patchOf(update).status).toBe("drafting");
    expect(filters(update, "eq")).toEqual(['id="esc-1"', 'status="queued"']);
  });

  it("answers null when another runner took the row between the read and the claim", async () => {
    answers = [{ id: "esc-1" }, null];
    expect(await claimQueuedRun()).toBeNull();
  });
});

describe("claimDecidedApproval", () => {
  it("only looks at decided forge rows nobody has claimed", async () => {
    answers = [null];
    expect(await claimDecidedApproval()).toBeNull();
    expect(filters(queryAt(0), "eq")).toEqual(['engine="forge"']);
    expect(filters(queryAt(0), "in")).toEqual(['status=["approved","rejected"]']);
    expect(filters(queryAt(0), "is")).toEqual(['approval_claimed_at=null']);
  });

  it("claims by stamping approval_claimed_at, conditional on it still being unset", async () => {
    answers = [{ id: "esc-1" }, { ...ROW, status: "approved" }];
    const claimed = await claimDecidedApproval();

    expect(claimed?.approval).toEqual({ approved: true, note: "ship it" });
    const update = queryAt(1);
    expect(Object.keys(patchOf(update))).toEqual(["approval_claimed_at"]);
    expect(filters(update, "eq")).toEqual(['id="esc-1"']);
    expect(filters(update, "is")).toEqual(['approval_claimed_at=null']);
  });
});
