/**
 * The one text a person can ask for with a report: what the card says, and what the report sends.
 *
 * The words here are a promise, so they say only what the server does. One text goes out when a
 * change for the gap is drafted, not when the feature is live, and only if the team drafts one.
 * The number is stored encrypted until that text and erased after it. The person agrees by
 * ticking the box; nothing is sent to the server until they also press the report button.
 */
import { toE164 } from '@lantern/shared';
import type { EscalationStatus, TextNoticeState } from '../types';

export const NOTICE_LABEL = 'Text me when a change for this is drafted';

export const NOTICE_HINT =
  'You get one text, and only if the team drafts a change. Your number is stored encrypted and deleted after that text. Message rates can apply.';

export const NOTICE_FIELD_LABEL = 'Mobile number with country code';

export const NOTICE_PLACEHOLDER = '+1 415 555 0123';

export const NOTICE_ERROR = 'Enter your number with the country code, for example +1 415 555 0123.';

/**
 * What the card says after the report, for each way a request for the text can end.
 *
 * "This report did not save your number" is the exact claim. A person who asked before, from a
 * different answer, can still have a number stored for the same gap, and this report did not
 * change that.
 */
export const NOTICE_COPY: Record<TextNoticeState, string> = {
  subscribed: 'You will get one text when a change for this is drafted.',
  not_needed: 'A change for this was already drafted, so there is no text to send. This report did not save your number.',
  unavailable: 'The text could not be set up, and this report did not save your number. The report itself was sent.',
};

/**
 * What goes with the report. No tick means no text and no number, whatever is in the field. A
 * tick with a number that cannot be dialled is an error to show, never a report that quietly has
 * no text.
 */
export function readNotice(wanted: boolean, typed: string): { ok: true; phone?: string } | { ok: false } {
  if (!wanted) return { ok: true };
  const phone = toE164(typed);
  return phone ? { ok: true, phone } : { ok: false };
}

/** The states of a report in which a text about a draft is still to come. */
const BEFORE_THE_DRAFT: ReadonlySet<EscalationStatus> = new Set(['queued', 'filing', 'filed', 'updated', 'inspecting', 'drafting']);

/**
 * Whether the line about the text is still true under the progress list.
 *
 * "You will get one text when a change is drafted" is a promise about what comes next. Once the
 * list says that a change is ready, or that the report ended, the line is about the past and the
 * list says it better. The two other lines are about what did not happen, and they stay true.
 */
export function noticeStands(notice: TextNoticeState, status: EscalationStatus): boolean {
  return notice !== 'subscribed' || BEFORE_THE_DRAFT.has(status);
}
