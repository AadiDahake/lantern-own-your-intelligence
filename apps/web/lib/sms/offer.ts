/**
 * Whether a person can be offered the one text about a gap.
 *
 * The offer is a promise, so it follows the process that sends the text, not the process that
 * answers the question. The sender is a runner with its own environment: the worker under
 * `local`, and the forge runner under `forge`. Each one writes a heartbeat row every 60 seconds
 * that says if it can send a text (`detail.sms`). The web app's own variables decide nothing, so
 * a web app with the two variables and a runner without them does not make a promise that the
 * runner cannot keep.
 *
 * The offer is on when both of these are true:
 *
 * - The runner of the engine that `ESCALATION_ENGINE` names has a fresh heartbeat that says it
 *   can send.
 * - No other runner with a fresh heartbeat says that it cannot. A forge run can be started from
 *   the console while the engine is `local`, and that run's draft pull request is opened by the
 *   forge runner.
 *
 * A read that fails, or that takes too long, means no offer. The question is answered in each
 * case, and the report works with no text.
 *
 * The heartbeats are read through the database function `runner_heartbeats` (migration 0020).
 * It measures the age of each heartbeat on the database's clock, so the clock of this process
 * decides nothing. On a database without that migration the call fails, and there is no offer.
 *
 * One limit is known. A runner that is started again without its variables is still read as "can
 * send" until its next heartbeat, at most 60 seconds later.
 */
import type { EscalationEngine, RequestGroupStatus } from "@lantern/shared";
import { escalationEngine } from "../env";
import { serviceClient } from "../supabase";

export type TextOffer = { on: true } | { on: false; reason: string };

/** The title of a runner's heartbeat row (`services/worker/steps/db.py` and `lib/forge/heartbeat.ts`). */
export const WORKER_ONLINE_TITLE = "worker online";

/** A runner writes a heartbeat each 60 seconds. Three missed beats read as "not running". */
export const WORKER_SEEN_SECONDS = 180;

/** The answer waits for this read at most this long. */
const QUERY_TIMEOUT_MS = 2_000;

/**
 * Group states that come after a draft pull request, `rejected` too. A later report of such a gap
 * starts no new draft, so a text would never come.
 */
const PAST_THE_DRAFT = new Set<RequestGroupStatus>(["pr_open", "awaiting_approval", "shipped", "rejected"]);

/** True while a draft change for the gap can still open, so a text about it can still come. */
export function awaitsDraft(status: RequestGroupStatus): boolean {
  return !PAST_THE_DRAFT.has(status);
}

const RUNNER: Record<EscalationEngine, string> = { local: "the worker", forge: "the forge runner" };

/** What each live runner says: true when it can send a text. */
async function liveSenders(projectId: string): Promise<Map<string, boolean>> {
  const { data, error } = await serviceClient()
    .rpc("runner_heartbeats", { p_project: projectId })
    .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
  if (error) throw new Error(error.message);
  const senders = new Map<string, boolean>();
  for (const row of (data ?? []) as { engine?: unknown; sms?: unknown; age_seconds?: unknown }[]) {
    const age = typeof row.age_seconds === "number" ? row.age_seconds : Number.NaN;
    if (!Number.isFinite(age) || age > WORKER_SEEN_SECONDS) continue;
    const engine = typeof row.engine === "string" ? row.engine : "";
    // The rows are newest first, so the first row of an engine is what that runner says now.
    if (!senders.has(engine)) senders.set(engine, row.sms === true);
  }
  return senders;
}

/** Never throws: no offer is the answer to each failure. */
export async function textOffer(projectId: string): Promise<TextOffer> {
  try {
    const engine = escalationEngine();
    const senders = await liveSenders(projectId);
    const own = senders.get(engine);
    if (own === undefined) return { on: false, reason: `${RUNNER[engine]} is not running` };
    if (!own) return { on: false, reason: `${RUNNER[engine]} has no text message provider` };
    for (const [other, canSend] of senders) {
      if (!canSend) return { on: false, reason: `a runner of the ${other || "unnamed"} engine is live and has no text message provider` };
    }
    return { on: true };
  } catch {
    return { on: false, reason: "the heartbeat of the runner could not be read" };
  }
}

/**
 * The trace row that says if the text was offered with a report. Never a phone number.
 *
 * Its kind is `decision`, not `status`: the web app writes it, and the console reads the newest
 * `status` row as a sign that a runner is live.
 */
export function offerTrace(offer: TextOffer): {
  kind: "decision";
  status: "ok";
  title: string;
  detail: Record<string, unknown>;
} {
  return offer.on
    ? { kind: "decision", status: "ok", title: "Text notice: offered with the report", detail: { notice: "draft_sms", offer: "on" } }
    : {
        kind: "decision",
        status: "ok",
        title: "Text notice: not offered",
        detail: { notice: "draft_sms", offer: "off", reason: offer.reason },
      };
}
