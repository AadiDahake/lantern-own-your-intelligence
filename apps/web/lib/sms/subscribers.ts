/**
 * The people who asked for a text about one gap, in the database, and the notice and the sweep
 * wired from the environment.
 *
 * Every query of a pass is scoped to the project. Every query about one person is scoped to the
 * gap too, and `forgetStale` is for the whole project. `owedGaps` is not scoped: it reads the
 * gaps of each project for the sweep, as a runner serves the whole deployment. The claim is one
 * conditional update on `gap_subscriber.notified_at`, the same shape as the
 * forge queue's claims, so two runs cannot take the same person. Every query has a time limit,
 * because a run waits for the notice.
 */
import { listNumbers, sendSms } from "../dial";
import { smsSender } from "../env";
import { serviceClient } from "../supabase";
import { sendDraftNotice, type DraftNotice, type NoticeOutcome, type NoticeStore } from "./notice";
import { DRAFT_OPEN } from "./offer";
import { openPhone } from "./phone";
import { startSweeps, Sweeper, sweepTicker, type OwedGap, type SweepResult } from "./sweep";

/** How long one query may take. */
const QUERY_TIMEOUT_MS = 10_000;

/**
 * A claim is held for one send and one write, which is seconds. A claim older than this with a
 * number still stored is what a stopped run left behind.
 */
export const STALE_CLAIM_MS = 15 * 60_000;

const limit = (): AbortSignal => AbortSignal.timeout(QUERY_TIMEOUT_MS);

export function gapSubscribers(ids: { projectId: string; groupId: string }): NoticeStore {
  /** One person's row, and only if it belongs to this project and this gap. */
  const row = (id: string) => ({ id, project_id: ids.projectId, group_id: ids.groupId });

  return {
    async gap() {
      const db = serviceClient();
      const [project, group] = await Promise.all([
        db.from("project").select("name").eq("id", ids.projectId).abortSignal(limit()).maybeSingle(),
        db
          .from("feature_request_group")
          .select("title")
          .eq("id", ids.groupId)
          .eq("project_id", ids.projectId)
          .abortSignal(limit())
          .maybeSingle(),
      ]);
      if (project.error) throw new Error(project.error.message);
      if (group.error) throw new Error(group.error.message);
      return { company: String(project.data?.name ?? ""), title: String(group.data?.title ?? "") };
    },

    async owed(max) {
      const { data, error } = await serviceClient()
        .from("gap_subscriber")
        .select("id, phone_sealed")
        .eq("project_id", ids.projectId)
        .eq("group_id", ids.groupId)
        .is("notified_at", null)
        .not("phone_sealed", "is", null)
        .order("created_at", { ascending: true })
        .limit(max)
        .abortSignal(limit());
      if (error) throw new Error(error.message);
      return (data ?? []).map((person) => ({ id: String(person.id), phone: openPhone(String(person.phone_sealed)) }));
    },

    async claim(id) {
      const { data, error } = await serviceClient()
        .from("gap_subscriber")
        .update({ notified_at: new Date().toISOString() })
        .match(row(id))
        .is("notified_at", null)
        .select("id")
        .abortSignal(limit())
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data !== null;
    },

    async settle(id, state) {
      // A refused text is still owed, so the claim goes back. In every other case the number has
      // done its work, or must not be used again, and is erased.
      const patch = state === "refused" ? { notified_at: null } : { phone_sealed: null };
      const { error } = await serviceClient().from("gap_subscriber").update(patch).match(row(id)).abortSignal(limit());
      if (error) throw new Error(error.message);
    },

    async forgetStale() {
      const { error } = await serviceClient()
        .from("gap_subscriber")
        .update({ phone_sealed: null })
        .eq("project_id", ids.projectId)
        .lt("notified_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString())
        .not("phone_sealed", "is", null)
        .abortSignal(limit());
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * The notice for one run. Off, with the name of the missing variable, when text messages are not
 * configured; the database is not read in that case, so a deployment with no provider and no
 * `gap_subscriber` table behaves as it did.
 */
export function draftNoticeFor(ids: { projectId: string; groupId: string | null }): DraftNotice {
  return async () => {
    const config = smsSender();
    if (!config.configured) return { state: "off", reason: config.reason };
    const { groupId } = ids;
    if (!groupId) return { state: "done", asked: 0, sent: 0, unconfirmed: 0, taken: 0, reasons: [] };
    return sendDraftNotice(gapSubscribers({ projectId: ids.projectId, groupId }), (message) =>
      sendSms(config.sender, message),
    );
  };
}

/**
 * A draft that is open and that no person has decided: the gap says `pr_open` or
 * `awaiting_approval`, and the gap's own run says the same, is a full run, and has no approval.
 *
 * The gap's own state is not enough. It stays `awaiting_approval` from the moment a person
 * decides until the merge and the deployment end, and for good when one of those fails. The
 * text says "the team reviews it next", so it must not go out after the decision. The run's
 * state alone is not enough either: the worker sets it to `pr_open` before the pull request
 * exists.
 *
 * The run is the gap's own run (`feature_request_group.escalation_id`), the full run that was
 * attached to the gap last. It is not any run of the gap: a run that only carried a new count
 * can stay at `awaiting_approval` with no approval after it failed, and an older draft can stay
 * not decided after a newer one was approved. The gap has three relations to `escalation`, so
 * the select names the column.
 */
const OWN_RUN = "escalation!escalation_id!inner(id)";

type Embedded = { id?: unknown } | { id?: unknown }[] | null | undefined;

/** The id of an embedded run. A relation to one row comes back as an object. */
function runId(run: Embedded): string | null {
  const row = Array.isArray(run) ? run[0] : run;
  return typeof row?.id === "string" ? row.id : null;
}

/**
 * The gaps with an open draft that still have a person who is owed a text, the gap that was seen
 * longest ago first. It is one query for the whole deployment, as a runner serves each project.
 * Each inner join keeps a gap only when such a run and such a person exist, and one row of the
 * people is enough to know it. Each pass that follows is scoped to the gap's own project.
 */
export async function owedGaps(max: number): Promise<OwedGap[]> {
  const { data, error } = await serviceClient()
    .from("feature_request_group")
    .select(`id, project_id, ${OWN_RUN}, gap_subscriber!inner(id)`)
    .in("status", [...DRAFT_OPEN])
    .in("escalation.status", [...DRAFT_OPEN])
    .eq("escalation.mode", "full")
    .is("escalation.approval", null)
    .is("gap_subscriber.notified_at", null)
    .not("gap_subscriber.phone_sealed", "is", null)
    .limit(1, { referencedTable: "gap_subscriber" })
    .order("last_seen", { ascending: true })
    .order("id", { ascending: true })
    .limit(max)
    .abortSignal(limit());
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: unknown; project_id: unknown; escalation?: Embedded }[]).map((gap) => ({
    projectId: String(gap.project_id),
    groupId: String(gap.id),
    escalationId: runId(gap.escalation),
  }));
}

/**
 * True while the draft of one gap is still open and not decided. The sweep asks it again just
 * before the pass: the list is read one time, and the pass of a gap can come minutes later.
 */
export async function draftStillOpen(gap: { projectId: string; groupId: string }): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from("feature_request_group")
    .select(`id, ${OWN_RUN}`)
    .eq("id", gap.groupId)
    .eq("project_id", gap.projectId)
    .in("status", [...DRAFT_OPEN])
    .in("escalation.status", [...DRAFT_OPEN])
    .eq("escalation.mode", "full")
    .is("escalation.approval", null)
    .limit(1)
    .abortSignal(limit());
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** A pass that had no one to text. */
const NO_ONE: NoticeOutcome = { state: "done", asked: 0, sent: 0, unconfirmed: 0, taken: 0, reasons: [] };

/**
 * The sweep for one runner: a later pass for each person who is still owed a text while the
 * draft is open (`sweep.ts`). The function that comes back keeps the waits, so a runner makes it
 * one time and calls it on a timer. Off, with the name of the missing variable, when text
 * messages are not configured; the database is not read in that case. It never rejects.
 */
export function draftSweep(): () => Promise<SweepResult> {
  const sweeper = new Sweeper();
  return async () => {
    const config = smsSender();
    if (!config.configured) return { state: "off", reason: config.reason };
    return sweeper.run({
      owedGaps,
      providerAnswers: async () => {
        // The account's numbers: the call that `npm run dial:live` makes. It sends nothing.
        const answer = await listNumbers(config.sender);
        return answer.ok ? { ok: true } : { ok: false, reason: answer.reason };
      },
      pass: async (gap) => {
        // A person can have decided the draft after the list was read.
        if (!(await draftStillOpen(gap))) return { outcome: NO_ONE, refusedForAll: false };
        // The sweep gives the pass its sender, so it sees what the pass sees: a refusal that is
        // not about the person ends the pass, and the sweep must stop there too.
        let refusedForAll = false;
        const outcome = await sendDraftNotice(gapSubscribers(gap), async (message) => {
          const result = await sendSms(config.sender, message);
          if (result.state === "refused" && result.forAll) refusedForAll = true;
          return result;
        });
        return { outcome, refusedForAll };
      },
      say: async (gap, row) => {
        // In the trace of the gap's own run, so a person who reads why a text did not come finds
        // the later pass in the same trace as the first one.
        const { error } = await serviceClient()
          .from("trace_event")
          .insert({ project_id: gap.projectId, escalation_id: gap.escalationId, source: "forge", ...row })
          .abortSignal(limit());
        if (error) throw new Error(error.message);
      },
    });
  };
}

/**
 * Starts the sweeps of a runner: one each 5 minutes, the first one 5 minutes after this call.
 * `say` prints a line. The sweep is made one time here, because it keeps the waits.
 */
export function runDraftSweeps(say: (line: string) => void): void {
  startSweeps(sweepTicker(draftSweep(), say));
}
