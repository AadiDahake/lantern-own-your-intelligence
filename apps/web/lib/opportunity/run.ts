/**
 * One discovery run, end to end: mine the sessions, attach the replays, compile the capability,
 * record the decision. Steps 2 to 7 of the evidence loop, with every step a trace row.
 *
 * The run takes explicit dependencies so the tests drive it with a fake PostHog, the compiler's
 * fake model and a memory store; `executeDiscovery` wires the real ones from the environment for
 * the runner and for the request that enqueued the run.
 */
import type { CompileContext, ModelClient } from "@lantern/capability";
import type { Discovery } from "@lantern/shared";
import { posthogWindowDays } from "../env";
import { posthogClient, type PosthogClient } from "../posthog/client";
import { compileOpportunity } from "./compile";
import { compileContextFor } from "./context";
import { describeTrajectory } from "./describe";
import { attachReplays, mineTrajectories, type MineOptions } from "./mine";
import { openaiModelClient } from "./model";
import { claimDiscovery, loadDiscovery } from "./queue";
import { SupabaseOpportunityStore, type OpportunityStore } from "./store";

export type DiscoveryDeps = {
  posthog: PosthogClient;
  model: ModelClient;
  store: OpportunityStore;
  context: CompileContext;
  window: MineOptions;
  replayConcurrency?: number;
  log?: (line: string) => void;
  now?: () => Date;
};

export type DiscoveryResult = {
  status: "done" | "failed";
  decision: "capability" | "none" | null;
  specId: string | null;
  sessionCount: number;
  error: string | null;
};

export type DiscoveryJob = Pick<Discovery, "id" | "groupId" | "conversationId" | "trigger">;

const SESSION_LIMIT = 200;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Runs the pipeline for one queued discovery. Never throws; the result says what happened. */
export async function runDiscovery(job: DiscoveryJob, deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const { store } = deps;
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date());

  try {
    await store.updateDiscovery({ status: "running", stage: "mining", error: null });

    // Step 2: mine. One query for the sessions, one for the headline numbers.
    const mined = await mineTrajectories(deps.posthog, deps.window);
    const headline = mined.headline;
    const sessions = mined.trajectories.length;
    const queryLine = mined.queries.map((q) => `${q.name}: ${q.rows} rows in ${q.durationMs} ms${q.cached ? " (cached)" : ""}`).join("; ");
    log(queryLine);
    await store.trace({
      kind: "tool",
      status: sessions > 0 ? "ok" : "failed",
      title:
        sessions > 0
          ? `PostHog: ${plural(sessions, "successful session")} in the last ${deps.window.windowDays} days, median ${headline?.medianInteractions ?? "?"} interactions`
          : `PostHog: no successful sessions in the last ${deps.window.windowDays} days`,
      detail: {
        tool: "hogql",
        transport: "rest",
        args_summary: mined.queries.map((q) => q.name).join(", "),
        result_summary: queryLine,
        sessions,
        matching_sessions: headline?.matchingSessions ?? sessions,
        median_manual_actions: headline?.medianManualActions ?? null,
        median_interactions: headline?.medianInteractions ?? null,
        window_days: deps.window.windowDays,
        queries: mined.queries,
      },
    });

    if (sessions === 0) {
      await store.trace({
        kind: "decision",
        source: "agent",
        onConversation: true,
        status: "ok",
        title: "No other customers worked around this in the window",
        detail: { sessions: 0, window_days: deps.window.windowDays },
      });
      await store.updateDiscovery({
        status: "done",
        stage: null,
        decision: "none",
        reasons: ["no successful sessions in the window"],
        sessionCount: 0,
        finishedAt: now().toISOString(),
      });
      return { status: "done", decision: "none", specId: null, sessionCount: 0, error: null };
    }

    // Step 3: replays. The link is built locally; PostHog only confirms the recording exists.
    const replays = await attachReplays(mined.trajectories, deps.posthog, { concurrency: deps.replayConcurrency });
    await store.upsertTrajectories(mined.trajectories.map(describeTrajectory));
    await store.trace({
      kind: "artifact",
      status: "ok",
      title: `${plural(replays.linked, "replay")} linked`,
      detail: { artifact: "replays", linked: replays.linked, checked: replays.checked, failed: replays.failed },
    });
    await store.updateDiscovery({
      stage: "compiling",
      sessionCount: sessions,
      medianManualActions: headline?.medianManualActions ?? null,
      medianInteractions: headline?.medianInteractions ?? null,
    });

    // Steps 4 to 7: the compiler.
    const outcome = await compileOpportunity({
      trajectories: mined.trajectories,
      context: deps.context,
      model: deps.model,
      store,
      now: deps.now,
    });

    if (outcome.decision === "none") {
      await store.trace({
        kind: "decision",
        source: "agent",
        onConversation: true,
        status: "ok",
        title: `${plural(sessions, "other session")} did not share one workaround`,
        detail: { sessions, reasons: outcome.reasons },
      });
      await store.updateDiscovery({
        status: "done",
        stage: null,
        decision: "none",
        reasons: outcome.reasons,
        finishedAt: now().toISOString(),
      });
      return { status: "done", decision: "none", specId: null, sessionCount: sessions, error: null };
    }

    const supporting = outcome.ir.evidence.session_count;
    await store.trace({
      kind: "decision",
      source: "agent",
      onConversation: true,
      status: "ok",
      title: `${plural(supporting, "similar session")} worked around this by hand`,
      detail: {
        sessions: supporting,
        median_interactions: outcome.medianInteractions,
        median_manual_actions: outcome.ir.evidence.median_manual_actions ?? null,
        intent: outcome.ir.intent,
        summary: outcome.ir.summary ?? null,
        capability_spec_id: outcome.specId,
      },
    });
    await store.updateDiscovery({
      status: "done",
      stage: null,
      decision: "capability",
      reasons: null,
      sessionCount: supporting,
      medianManualActions: outcome.ir.evidence.median_manual_actions ?? null,
      medianInteractions: outcome.medianInteractions,
      capabilitySpecId: outcome.specId,
      finishedAt: now().toISOString(),
    });
    return { status: "done", decision: "capability", specId: outcome.specId, sessionCount: supporting, error: null };
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    log(`discovery failed: ${message}`);
    await store.trace({
      kind: "error",
      status: "failed",
      title: "Discovery failed",
      detail: { message: message.slice(0, 4000) },
    });
    await store.trace({
      kind: "status",
      source: "agent",
      onConversation: true,
      status: "failed",
      title: "Could not check whether other customers hit this",
      detail: { message: message.slice(0, 500) },
    });
    await store.updateDiscovery({
      status: "failed",
      stage: null,
      error: message.slice(0, 2000),
      finishedAt: now().toISOString(),
    });
    return { status: "failed", decision: null, specId: null, sessionCount: 0, error: message };
  }
}

/**
 * The real dependencies for one run, wired from the environment. `model` overrides the OpenAI
 * client; the runner passes the machine's own Codex login for a keyless development run.
 */
export function buildDiscoveryDeps(
  discovery: Discovery & { projectId: string },
  options: { log?: (line: string) => void; model?: ModelClient } = {},
): DiscoveryDeps {
  return {
    posthog: posthogClient(),
    model: options.model ?? openaiModelClient(),
    store: new SupabaseOpportunityStore({
      projectId: discovery.projectId,
      groupId: discovery.groupId,
      discoveryId: discovery.id,
      conversationId: discovery.conversationId,
    }),
    context: compileContextFor({ groupId: discovery.groupId }),
    window: { windowDays: posthogWindowDays(), limit: SESSION_LIMIT },
    log: options.log,
  };
}

/**
 * Executes one discovery by id: claims it when it is still queued, then runs it. A row another
 * process already claimed is left alone. Used by the runner and by the inline mode.
 */
export async function executeDiscovery(
  id: string,
  options: { log?: (line: string) => void; alreadyClaimed?: boolean; model?: ModelClient } = {},
): Promise<DiscoveryResult | null> {
  const log = options.log ?? ((line: string) => console.log(`[discovery ${id.slice(0, 8)}] ${line}`));
  const discovery = options.alreadyClaimed ? await loadDiscovery(id) : await claimDiscovery(id);
  if (!discovery) return null;
  log(`running for group ${discovery.groupId} (${discovery.trigger})`);
  const result = await runDiscovery(discovery, buildDiscoveryDeps(discovery, { log, model: options.model }));
  log(`${result.status}${result.decision ? `, ${result.decision}` : ""}${result.error ? `: ${result.error}` : ""}`);
  return result;
}
