/**
 * The people who asked for a text about one gap, in the database, and the notice wired from the
 * environment.
 *
 * Every query is scoped to the project, and every query about a person is scoped to the gap too.
 * The claim is one conditional update on `gap_subscriber.notified_at`, the same shape as the
 * forge queue's claims, so two runs cannot take the same person. Every query has a time limit,
 * because a run waits for the notice.
 */
import { sendSms } from "../dial";
import { smsSender } from "../env";
import { serviceClient } from "../supabase";
import { sendDraftNotice, type DraftNotice, type NoticeStore } from "./notice";
import { openPhone } from "./phone";

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
