/**
 * The agent's own note is quiet: it records the gap and files nothing.
 *
 * A visitor asking for directions, and then saying plainly that the thing was not needed, ended a
 * night's run with two issues open in the customer's repository that nobody had asked for. Opening
 * an issue in someone else's repository is an outward action, and the only thing that authorises
 * it is a person accepting the offer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureRequest } from "@lantern/shared";

/** Every insert and update the note made, by table. */
const writes: { table: string; op: string; values: unknown }[] = [];
/** The group `match_request_groups` finds, or none when this gap is new. */
let nearest: Record<string, unknown> | null = null;

class FakeQuery {
  constructor(private readonly table: string) {}
  insert(values: unknown): this {
    writes.push({ table: this.table, op: "insert", values });
    return this;
  }
  update(values: unknown): this {
    writes.push({ table: this.table, op: "update", values });
    return this;
  }
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  async single(): Promise<{ data: Record<string, unknown>; error: null }> {
    return { data: { id: "group-1", title: "Find seats together", report_count: 1 }, error: null };
  }
  // The project has a repository bound, which is what used to make the note file an issue.
  async maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    const project = {
      id: "project-1",
      repo_full_name: "AadiDahake/novaair-own-your-intelligence",
      repo_default_branch: "main",
      site_url: "https://novaair.example.com",
    };
    return { data: this.table === "project" ? project : null, error: null };
  }
}

vi.mock("@/lib/supabase", () => ({
  serviceClient: () => ({
    from: (table: string) => new FakeQuery(table),
    rpc: async (name: string) => ({
      data: name === "match_request_groups" && nearest ? [nearest] : [],
      error: null,
    }),
  }),
}));

vi.mock("@/lib/openai", () => ({
  embed: async (inputs: string[]) => inputs.map(() => new Array(1536).fill(0)),
}));

/** The runner is mocked so that a call to it is visible rather than attempted. */
const runs: unknown[] = [];
vi.mock("@/lib/agent/runner", () => ({
  startRun: async (input: unknown) => {
    runs.push(input);
    return "escalation-1";
  },
  attachRun: async () => undefined,
  assertEngineAvailable: () => undefined,
}));

const { noteRequest } = await import("@/lib/agent/requests");

const REQUEST: FeatureRequest = {
  title: "Find seats together for a party",
  description: "Let a family take three seats side by side in one move.",
  area: "seats",
  quote: "Can you find us three seats together?",
  rationale: "Today they rebook one passenger at a time.",
};

beforeEach(() => {
  writes.length = 0;
  runs.length = 0;
  nearest = null;
});

describe("noteRequest", () => {
  it("records the gap for the dashboard and starts no run", async () => {
    const noted = await noteRequest({ projectId: "project-1", request: REQUEST });

    expect(noted).toEqual({ noted: true, groupId: "group-1" });
    expect(writes.filter((write) => write.table === "feature_request_group")).toHaveLength(1);
    expect(runs).toEqual([]);
    expect(writes.some((write) => write.table === "escalation")).toBe(false);
  });

  it("starts no run for a gap that already has weight behind it either", async () => {
    nearest = {
      id: "group-1",
      title: REQUEST.title,
      description: REQUEST.description,
      area: REQUEST.area,
      report_count: 4,
      user_report_count: 2,
      priority: "high",
      status: "filed",
      issue_number: 18,
      similarity: 0.99,
    };

    await noteRequest({ projectId: "project-1", request: REQUEST });

    expect(runs).toEqual([]);
    expect(writes.some((write) => write.table === "escalation")).toBe(false);
  });
});
