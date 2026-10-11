/**
 * The one text a person asked for: sent when the draft change for the gap they reported opens.
 *
 * This module is the rule and nothing else. The list of people comes from a `NoticeStore` and the
 * send is a function, so a test runs the whole rule with no database and no provider. The worker
 * has the same rule for the `local` engine (`services/worker/steps/sms_notice.py`); change them
 * together.
 *
 * One gap is one text for one person, however the runs overlap:
 *
 * - A person is claimed before the send, with a conditional update that only one run wins. The
 *   send call has no idempotency key, so the claim is the only thing that stops a second text.
 * - A text that was refused was not sent, so the claim is released and the text is still owed.
 * - A text with no answer may have gone. The claim stays, and nobody sends it again.
 * - A refusal that is not about the person (the key, the credit, the provider's address) stops
 *   the pass, and so does a text with no answer: the next send is expected to end the same way,
 *   and each such send would cost one more person their text. The people who are left are not
 *   claimed, so they are still owed.
 * - One pass texts at most `PASS_LIMIT` people and takes at most `PASS_BUDGET_MS`, so the run
 *   that waits for it is never held for long.
 *
 * Nothing starts a second pass. A gap gets one draft pull request (`actionFor` in
 * `lib/agent/requests.ts` starts no second one), so a person who is still owed after the pass (a
 * refusal, a pass that stopped, the time budget) gets no text, and the sealed number stays
 * stored. This is a known limit; a sweep that texts owed people while the draft is open is the
 * fix, and it is not built.
 *
 * A phone number is never in an outcome, a reason, or a trace row.
 */
import { draftNoticeText, isE164 } from "@lantern/shared";
import type { SmsResult } from "../dial";

export type NoticeOutcome =
  /** Text messages are not configured. `reason` names the variable. */
  | { state: "off"; reason: string }
  /** The list of people could not be read, so nothing was sent. */
  | { state: "failed"; reason: string }
  /**
   * This run had `asked` people to text. `sent` texts were confirmed, and `unconfirmed` may or
   * may not have gone. The rest were not sent; `reasons` says why, as short codes. `taken` people
   * were claimed by a different run at the same moment, which reports them itself.
   */
  | { state: "done"; asked: number; sent: number; unconfirmed: number; taken: number; reasons: string[] };

/** A person who is owed the text. `phone` is null when the stored number does not open. */
export type OwedText = { id: string; phone: string | null };

export interface NoticeStore {
  /** What the text names: the company the person knows, and the gap's title. */
  gap(): Promise<{ company: string; title: string }>;
  /** The people who agreed to a text about this gap and have not had it, oldest first, at most `limit`. */
  owed(limit: number): Promise<OwedText[]>;
  /** Takes one person for this run. False when a different run already took them. */
  claim(id: string): Promise<boolean>;
  /** Records how the send ended: erase the number, or release the claim after a refusal. */
  settle(id: string, state: SmsResult["state"]): Promise<void>;
  /**
   * Erases the numbers of claims that are older than any send can be. A run that stopped between
   * the claim and the record of the send leaves such a row, and its number has no use.
   */
  forgetStale(): Promise<void>;
}

export type SendText = (message: { to: string; body: string }) => Promise<SmsResult>;

/** The notice as an engine sees it: no arguments, and it never rejects. */
export type DraftNotice = () => Promise<NoticeOutcome>;

/** The most people one pass texts. The sends are one after the other, and a run waits for them. */
export const PASS_LIMIT = 200;

/** The longest a pass goes on to the next person. One more send can end after it. */
export const PASS_BUDGET_MS = 60_000;

/** The words of anything that was thrown, cut short. A rejection is not always an `Error`. */
export function thrownMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/** Sends the text to each person who is owed it. Never throws. */
export async function sendDraftNotice(
  store: NoticeStore,
  send: SendText,
  options: { now?: () => number } = {},
): Promise<NoticeOutcome> {
  const now = options.now ?? Date.now;
  const deadline = now() + PASS_BUDGET_MS;
  const reasons = new Set<string>();
  let body: string;
  let owed: OwedText[];
  try {
    await store.forgetStale().catch(() => reasons.add("cleanup_failed"));
    // One more than a pass takes, so the outcome can say that people are left.
    const [gap, people] = await Promise.all([store.gap(), store.owed(PASS_LIMIT + 1)]);
    body = draftNoticeText(gap);
    owed = people;
  } catch (error) {
    return { state: "failed", reason: thrownMessage(error) };
  }

  let asked = owed.length;
  let taken = 0;
  let sent = 0;
  let unconfirmed = 0;
  if (owed.length > PASS_LIMIT) reasons.add("pass_limit");
  for (const person of owed.slice(0, PASS_LIMIT)) {
    if (now() > deadline) {
      reasons.add("time_budget");
      break;
    }
    if (!person.phone || !isE164(person.phone)) {
      // Not claimed and not erased: a runner with the wrong service role key reads every number
      // this way, and that mistake must not destroy what people gave.
      reasons.add("unreadable_number");
      continue;
    }
    const claimed = await store.claim(person.id).catch(() => null);
    if (claimed === null) {
      // Not knowing who holds the claim is a reason not to send.
      reasons.add("claim_failed");
      continue;
    }
    if (!claimed) {
      asked -= 1;
      taken += 1;
      continue;
    }
    const result = await send({ to: person.phone, body }).catch(
      (): SmsResult => ({ state: "unconfirmed", reason: "send_failed" }),
    );
    if (result.state === "sent") sent += 1;
    else {
      reasons.add(result.reason);
      if (result.state === "unconfirmed") unconfirmed += 1;
    }
    await store.settle(person.id, result.state).catch(() => reasons.add("settle_failed"));
    if (result.state === "unconfirmed" || (result.state === "refused" && result.forAll)) break;
  }
  return { state: "done", asked, sent, unconfirmed, taken, reasons: [...reasons].sort() };
}

export type NoticeTrace = {
  kind: "status";
  status: "ok" | "failed";
  title: string;
  detail: Record<string, unknown>;
};

/** The one trace row a notice writes. The console and `npm run tail` show it as it is. */
export function noticeTrace(outcome: NoticeOutcome): NoticeTrace {
  const detail = { notice: "draft_sms", ...outcome };
  if (outcome.state === "off") return { kind: "status", status: "ok", title: "Text notice: off", detail };
  if (outcome.state === "failed") {
    return { kind: "status", status: "failed", title: "Text notice: could not read who asked for a text", detail };
  }
  if (outcome.asked === 0) {
    const title =
      outcome.taken > 0
        ? "Text notice: a different run sent the texts"
        : "Text notice: no one asked for a text about this request";
    return { kind: "status", status: "ok", title, detail };
  }
  return {
    kind: "status",
    status: outcome.sent === outcome.asked ? "ok" : "failed",
    title: `Text notice: ${outcome.sent} of ${outcome.asked} sent`,
    detail,
  };
}
