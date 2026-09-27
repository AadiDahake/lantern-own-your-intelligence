/**
 * The opportunity pipeline end to end, offline: a fake PostHog answering from the compiler's
 * fixture sessions, the compiler's fake model, and a memory store instead of the database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Trajectory } from "@lantern/capability";
import { FakeModelClient } from "@lantern/capability/fake-model";
import { compileContextFor } from "@/lib/opportunity/context";
import { medianInteractions, scoresFromEvents } from "@/lib/opportunity/compile";
import { attachReplays, headlineOf, mineTrajectories } from "@/lib/opportunity/mine";
import { runDiscovery, type DiscoveryDeps } from "@/lib/opportunity/run";
import { MemoryOpportunityStore } from "@/lib/opportunity/store";
import { FakePosthogClient, loadRows, rowsFromTrajectories } from "./fake-posthog";

const SESSIONS = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "..", "packages", "capability", "test", "fixtures", "sessions.json"), "utf8"),
) as Trajectory[];

const HEADLINE = { columns: ["matching_sessions", "median_manual_actions", "median_interactions"], results: [[65, 30, 14]] };

function setup(trajectories: Trajectory[] = SESSIONS) {
  const posthog = new FakePosthogClient({ trajectories: rowsFromTrajectories(trajectories), headline: HEADLINE });
  const store = new MemoryOpportunityStore();
  const deps: DiscoveryDeps = {
    posthog,
    model: new FakeModelClient(),
    store,
    context: compileContextFor({ groupId: "group-1" }),
    window: { windowDays: 90, limit: 200 },
    replayConcurrency: 3,
    now: () => new Date("2026-08-30T01:00:00Z"),
  };
  return { posthog, store, deps };
}

const JOB = { id: "disc-1", groupId: "group-1", conversationId: "conv-1", trigger: "auto" as const };

describe("mineTrajectories", () => {
  it("runs the two named queries and returns one trajectory per session", async () => {
    const { posthog, deps } = setup();
    const mined = await mineTrajectories(posthog, deps.window);
    expect(posthog.queries).toEqual(["lantern_trajectories", "lantern_headline"]);
    expect(mined.trajectories.length).toBe(SESSIONS.filter((s) => s.confirmed_at).length);
    expect(mined.headline).toEqual({ matchingSessions: 65, medianManualActions: 30, medianInteractions: 14 });
    expect(mined.queries.map((q) => q.rows)).toEqual([mined.trajectories.length, 1]);
  });

  it("reads the real headline row shape", () => {
    const rows = loadRows("headline-rows.json");
    const headline = headlineOf({ columns: rows.columns, results: rows.results, types: [], durationMs: 1, cached: false });
    expect(headline?.matchingSessions).toBeGreaterThan(0);
    expect(headline?.medianInteractions).not.toBeNull();
  });

  it("links a replay only when PostHog confirms the recording exists", async () => {
    const { posthog } = setup();
    const trajectories = SESSIONS.slice(0, 5).map((t) => ({ ...t }));
    posthog.missingRecordings.add(trajectories[1]!.session_id);
    const result = await attachReplays(trajectories, posthog, { concurrency: 2 });
    expect(result).toEqual({ linked: 4, checked: 5, failed: 0 });
    expect(trajectories[0]?.replay_url).toBe(`https://us.posthog.com/project/1/replay/${trajectories[0]!.session_id}`);
    expect(trajectories[1]?.replay_url).toBeUndefined();
    expect(posthog.recordingLookups.length).toBe(5);
  });
});

describe("runDiscovery", () => {
  it("mines, links, compiles seat_party_together, stores the specification and tells the chat", async () => {
    const { store, deps } = setup();
    const result = await runDiscovery(JOB, deps);

    expect(result.status).toBe("done");
    expect(result.decision).toBe("capability");
    expect(result.specId).toBe("spec-1");

    const spec = store.specs[0]!;
    expect(spec.ir.intent).toBe("seat_party_together");
    expect(spec.ir.success.scenarios.length).toBe(21);
    expect(spec.ir.evidence.session_count).toBe(result.sessionCount);
    expect(spec.medianInteractions).not.toBeNull();
    expect(spec.model).toBe("fake");

    // The rows are cached with their replay links, described once for the console, then scored
    // with the two reward axes apart.
    expect(store.trajectories.size).toBe(SESSIONS.filter((s) => s.confirmed_at).length);
    const described = [...store.trajectories.values()];
    expect(described.every((t) => t.trajectory.replay_url)).toBe(true);
    expect(described.every((t) => t.rendered.length === t.trajectory.steps.length && t.manualActions > 0)).toBe(true);
    expect(described[0]?.rendered[0]?.line).toMatch(/^opened the seat map/);
    expect(described[0]?.rendered[1]?.seconds).toBeGreaterThanOrEqual(0);
    const scored = [...store.scores.values()];
    expect(scored.length).toBeGreaterThan(0);
    expect(scored.some((s) => s.rewardCompletion !== null && s.rewardCoherence !== null)).toBe(true);
    expect(scored.some((s) => s.goalName === "seat_party_together" && s.inferredGoal)).toBe(true);

    // The row the console polls.
    expect(store.discovery).toMatchObject({
      status: "done",
      stage: null,
      decision: "capability",
      capabilitySpecId: "spec-1",
      sessionCount: spec.ir.evidence.session_count,
      medianManualActions: spec.ir.evidence.median_manual_actions,
      finishedAt: "2026-08-30T01:00:00.000Z",
    });
  });

  it("writes the trace in story order, with the evidence line on the conversation", async () => {
    const { store, deps } = setup();
    await runDiscovery(JOB, deps);
    const titles = store.titles();

    expect(titles[0]).toMatch(/^PostHog: \d+ successful sessions in the last 90 days, median 14 interactions$/);
    expect(titles[1]).toMatch(/^\d+ replays linked$/);
    const stages = store.events.filter((e) => e.kind === "capability").map((e) => (e.detail as { stage: string }).stage);
    const order = ["workflows", "intent", "capability", "verification"];
    expect(stages.map((s) => order.indexOf(s))).toEqual([...stages.map((s) => order.indexOf(s))].sort((a, b) => a - b));
    expect(stages[0]).toBe("workflows");
    expect(stages[stages.length - 1]).toBe("verification");

    const spec = store.events.find((e) => e.kind === "artifact" && (e.detail as { artifact: string }).artifact === "capability_spec");
    expect(spec?.title).toBe("Capability specification v1: seat_party_together");
    expect(titles).toContain("missing_capability.discovered: seat_party_together");

    const evidence = store.events.filter((e) => e.onConversation);
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.source).toBe("agent");
    expect(evidence[0]?.title).toMatch(/^\d+ similar sessions worked around this by hand$/);
    expect(titles.indexOf(evidence[0]!.title)).toBe(titles.length - 1);
    // PostHog is named once, as the evidence source.
    expect(titles.filter((t) => t.includes("PostHog")).length).toBe(1);
  });

  it("declines with reasons when the sessions do not warrant a capability", async () => {
    const unrelated = SESSIONS.filter(
      (s) =>
        s.steps.every((step) => step.event === "help_article_viewed") ||
        s.steps.some((step) => step.event === "seat_map_opened" && step.props.party_size === 1),
    );
    const { store, deps } = setup(unrelated);
    const result = await runDiscovery(JOB, deps);
    expect(result.status).toBe("done");
    expect(result.decision).toBe("none");
    expect(store.specs.length).toBe(0);
    expect(store.discovery.decision).toBe("none");
    expect(store.discovery.reasons?.length).toBeGreaterThan(0);
    expect(store.events.find((e) => e.onConversation)?.title).toMatch(/did not share one workaround$/);
  });

  it("reports an empty window as done with no capability", async () => {
    const { store, deps } = setup([]);
    const result = await runDiscovery(JOB, deps);
    expect(result).toMatchObject({ status: "done", decision: "none", sessionCount: 0 });
    expect(store.titles("tool")[0]).toBe("PostHog: no successful sessions in the last 90 days");
    expect(store.events.find((e) => e.onConversation)?.title).toBe("No other customers worked around this in the window");
  });

  it("fails cleanly when PostHog cannot be reached", async () => {
    const { posthog, store, deps } = setup();
    posthog.failQueries = true;
    const result = await runDiscovery(JOB, deps);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("429");
    expect(store.discovery).toMatchObject({ status: "failed", stage: null });
    expect(store.discovery.error).toContain("429");
    expect(store.titles("error")).toEqual(["Discovery failed"]);
    expect(store.events.find((e) => e.onConversation)?.title).toBe("Could not check whether other customers hit this");
    expect(store.specs.length).toBe(0);
  });
});

describe("compile helpers", () => {
  it("takes the product's interaction count off the committing event", () => {
    const ir = {
      evidence: {
        trajectories: [
          { steps: [{ event: "seat_assignment_confirmed", props: { interactions: 10 } }] },
          { steps: [{ event: "seat_assignment_confirmed", props: { interactions: 14 } }] },
          { steps: [{ event: "seat_assignment_confirmed", props: { interactions: 20 } }] },
          { steps: [{ event: "seat_hovered", props: {} }] },
        ],
      },
    };
    expect(medianInteractions(ir as never)).toBe(14);
    expect(medianInteractions({ evidence: { trajectories: [] } } as never)).toBeNull();
  });

  it("reads goals and rewards back off the decision trail", () => {
    const scores = scoresFromEvents([
      { stage: "intent", title: "Goals 1/1: 2 inferred", at: "", detail: { goals: [{ session_id: "a", goal_name: "seat_party_together", confidence: 0.9 }, { session_id: "b", goal_name: "change_one_seat", confidence: 0.8 }] } },
      { stage: "intent", title: "Rewards 1/1: 2 graded", at: "", detail: { grades: [{ session_id: "a", completion: 5, coherence: 3, total: 5 }] } },
      { stage: "intent", title: "Inferred intent: Seat the traveling party together (1 sessions)", at: "", detail: { goals: { seat_party_together: 1, change_one_seat: 1 } } },
    ]);
    expect(scores).toEqual([
      { sessionId: "a", goalName: "seat_party_together", goalConfidence: 0.9, inferredGoal: "Seat the traveling party together", rewardCompletion: 5, rewardCoherence: 3 },
      { sessionId: "b", goalName: "change_one_seat", goalConfidence: 0.8, inferredGoal: null, rewardCompletion: null, rewardCoherence: null },
    ]);
  });
});
