/**
 * A person asks for the one text about a gap: the only code that writes a phone number.
 *
 * It runs after the report is recorded, and it never fails the report. Each way out is one of
 * three states that the widget says in words, and the number stays stored only in the first:
 *
 * - `subscribed`: the sealed number is in `gap_subscriber` and one text is owed or on its way.
 * - `not_needed`: a change for the gap was drafted already (each state past the draft, `rejected`
 *   too, comes after a draft pull request), so no text will come.
 * - `unavailable`: no runner can send the text now, a limit is reached, the answer was already
 *   used for a different number, the gap is gone, or a query failed.
 *
 * The run that opens the draft pull request sets the gap to `pr_open` before it reads who is
 * owed a text. So this code writes the row first and reads the gap's state second. If the row was
 * written too late for that run to see it, the state read here is `pr_open` or later, and the row
 * is taken back. A request takes back only the row of its own answer.
 *
 * Anyone with the public embed key can call the route with any number, and nothing proves that
 * the number is the caller's. Three limits bound what such a caller can make the company send:
 * one answer stores one number (`message_id` is unique), one gap holds at most `GAP_LIMIT`
 * people, and one project takes at most `DAY_LIMIT` new numbers in 24 hours. The limits are read
 * before the write and they do not depend on the number, so the answer never says if a number
 * was known before.
 *
 * Known limits. This code cannot take back a row when the database fails two times in one
 * request (the write lands and the delete does not); the answer is then `unavailable` and the
 * sealed number stays until a pass erases it. And a person who is owed a text does not get it
 * when the pass at the draft stops before their turn; `notice.ts` says why.
 *
 * A phone number is never in a result, a reason, or a log line.
 */
import type { RequestGroupStatus, TextNoticeState } from "@lantern/shared";
import { serviceClient } from "../supabase";
import { awaitsDraft, textOffer } from "./offer";
import { phoneDigest, sealPhone } from "./phone";
import { STALE_CLAIM_MS } from "./subscribers";

/** How one request for a text ended. `reason` is a few words for the trace. */
export type TextSubscription = { state: TextNoticeState; reason?: string };

/**
 * The most people one gap holds while they are owed a text. One pass at the draft has 60 seconds
 * and sends one text after the other, so this is the number of people that a pass reaches in
 * that time with a second to spare for each.
 */
export const GAP_LIMIT = 50;

/** The most new numbers one project takes in 24 hours. */
export const DAY_LIMIT = 100;

const DAY_MS = 24 * 60 * 60_000;

/** How long one read may take. The person waits for the report's answer. */
const READ_TIMEOUT_MS = 5_000;

/**
 * How long one write may take. It is long on purpose: a write that this code gives up on can
 * still land, and then the answer to the person is about a row that this code no longer sees.
 */
const WRITE_TIMEOUT_MS = 15_000;

/** Postgres: a unique index refused the row. */
const UNIQUE_VIOLATION = "23505";

const readLimit = (): AbortSignal => AbortSignal.timeout(READ_TIMEOUT_MS);
const writeLimit = (): AbortSignal => AbortSignal.timeout(WRITE_TIMEOUT_MS);

export type SubscribeInput = {
  projectId: string;
  groupId: string;
  /** The answer that carried the offer. */
  messageId: string;
  /** The number in E.164 form. The caller checked it, and the person agreed to the text. */
  phone: string;
  /** The gap's state when the report was recorded. */
  status: RequestGroupStatus;
};

/** One person's row: the project, the gap, and the digest of the number. */
type Row = { project_id: string; group_id: string; phone_digest: string };

/** The limit that is reached, or null. Neither count looks at the number. */
async function limitReached(row: Row): Promise<string | null> {
  const db = serviceClient();
  const [inGap, today] = await Promise.all([
    db
      .from("gap_subscriber")
      .select("id", { count: "exact", head: true })
      .eq("project_id", row.project_id)
      .eq("group_id", row.group_id)
      .is("notified_at", null)
      .not("phone_sealed", "is", null)
      .abortSignal(readLimit()),
    db
      .from("gap_subscriber")
      .select("id", { count: "exact", head: true })
      .eq("project_id", row.project_id)
      .gte("created_at", new Date(Date.now() - DAY_MS).toISOString())
      .abortSignal(readLimit()),
  ]);
  if (inGap.error) throw new Error(inGap.error.message);
  if (today.error) throw new Error(today.error.message);
  if ((inGap.count ?? 0) >= GAP_LIMIT) return "the gap holds as many people as one pass texts";
  if ((today.count ?? 0) >= DAY_LIMIT) return "the project took as many numbers as one day allows";
  return null;
}

/**
 * Stores the number. A number that is there for this gap already is left as it is while its text
 * is owed or on its way. A row whose text ended (sent, never confirmed, or claimed by a run that
 * stopped) is armed again, because the person asked again and the old number was erased.
 */
async function store(row: Row, messageId: string, phone: string): Promise<"stored" | "answer_used"> {
  const db = serviceClient();
  const sealed = sealPhone(phone);
  const consentAt = new Date().toISOString();
  const inserted = await db
    .from("gap_subscriber")
    .upsert(
      { ...row, message_id: messageId, phone_sealed: sealed, consent_at: consentAt },
      { onConflict: "group_id,phone_digest", ignoreDuplicates: true },
    )
    .select("id")
    .abortSignal(writeLimit());
  if (inserted.error) {
    if (inserted.error.code === UNIQUE_VIOLATION) return "answer_used";
    throw new Error(inserted.error.message);
  }
  if ((inserted.data ?? []).length > 0) return "stored";

  // A claim this old is not a send in progress: the same rule as `forgetStale`.
  const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const rearmed = await db
    .from("gap_subscriber")
    .update({ phone_sealed: sealed, consent_at: consentAt, notified_at: null })
    .match(row)
    .or(`phone_sealed.is.null,notified_at.lt.${stale}`)
    .abortSignal(writeLimit());
  if (rearmed.error) throw new Error(rearmed.error.message);
  return "stored";
}

/** The gap's state now, or null when the gap is gone. */
async function statusNow(row: Row): Promise<RequestGroupStatus | null> {
  const { data, error } = await serviceClient()
    .from("feature_request_group")
    .select("status")
    .eq("id", row.group_id)
    .eq("project_id", row.project_id)
    .abortSignal(readLimit())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (String(data.status) as RequestGroupStatus) : null;
}

/**
 * Takes back the row that this answer wrote, while no run holds it, and says `state`.
 *
 * A request takes back only its own row. A row that an earlier answer wrote for the same number
 * is a promise that was made before, and a second request must not break it.
 *
 * When nothing was deleted, the row is read. A row that still holds a number is owed a text or is
 * on its way to one, so the answer is `subscribed`. No number means that nothing is stored, and
 * the answer is `state`. When the delete or the read fails, nothing is known about the row. The
 * answer is then `unavailable`: a text that is not promised and does come is a smaller wrong
 * than a text that is promised and does not.
 */
async function withdraw(row: Row, messageId: string, state: TextNoticeState, reason: string): Promise<TextSubscription> {
  try {
    const db = serviceClient();
    const deleted = await db
      .from("gap_subscriber")
      .delete()
      .match({ ...row, message_id: messageId })
      .is("notified_at", null)
      .select("id")
      .abortSignal(writeLimit());
    if (deleted.error) throw new Error(deleted.error.message);
    if ((deleted.data ?? []).length > 0) return { state, reason };
    const left = await db
      .from("gap_subscriber")
      .select("phone_sealed")
      .match(row)
      .not("phone_sealed", "is", null)
      .limit(1)
      .abortSignal(readLimit());
    if (left.error) throw new Error(left.error.message);
    return (left.data ?? []).length > 0
      ? { state: "subscribed", reason: "the number was stored before this request, and its text is owed or on its way" }
      : { state, reason };
  } catch {
    return { state: "unavailable", reason: `${reason}, and the row could not be taken back` };
  }
}

/** Never throws. The report that carried the request is already recorded. */
export async function subscribeToGap(input: SubscribeInput): Promise<TextSubscription> {
  const offer = await textOffer(input.projectId);
  if (!offer.on) return { state: "unavailable", reason: offer.reason };
  if (!awaitsDraft(input.status)) return { state: "not_needed", reason: `the gap is ${input.status}` };

  const row: Row = { project_id: input.projectId, group_id: input.groupId, phone_digest: "" };
  try {
    row.phone_digest = phoneDigest(input.phone);
    const full = await limitReached(row);
    if (full) return { state: "unavailable", reason: full };
  } catch {
    return { state: "unavailable", reason: "the limits could not be read" };
  }

  const takeBack = (state: TextNoticeState, reason: string) => withdraw(row, input.messageId, state, reason);
  try {
    if ((await store(row, input.messageId, input.phone)) === "answer_used") {
      return { state: "unavailable", reason: "this answer already stored a different number" };
    }
  } catch {
    // A write that failed can still have landed, so the row is taken back if it is there.
    return takeBack("unavailable", "the number could not be stored");
  }

  let status: RequestGroupStatus | null;
  try {
    status = await statusNow(row);
  } catch {
    // The gap's state is not known, so the promise cannot be made.
    return takeBack("unavailable", "the gap could not be read");
  }
  if (status === null) return takeBack("unavailable", "the gap is gone");
  if (awaitsDraft(status)) return { state: "subscribed" };
  // The draft opened while this request was on its way.
  return takeBack("not_needed", "a change was drafted at the same moment");
}
