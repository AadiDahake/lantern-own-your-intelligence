import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { AnswerActions } from './AnswerActions';
import { useReveal } from './reveal';
import {
  NOTICE_COPY,
  NOTICE_ERROR,
  NOTICE_FIELD_LABEL,
  NOTICE_HINT,
  NOTICE_LABEL,
  NOTICE_PLACEHOLDER,
  noticeStands,
  readNotice,
} from './textNotice';
import type {
  EscalationStatus,
  EscalationView,
  FeatureRequest,
  FeedbackRating,
  ReportBlock,
  TextNoticeState,
} from '../types';

/** Why the offer could not be taken up. This is what the user reads, so it says who is missing what. */
const BLOCKED_COPY: Record<ReportBlock, string> = {
  no_repository: 'The team has not connected a repository yet, so I cannot report this.',
  failed: 'The report could not be sent. Nothing was lost, so try again in a moment.',
};

/**
 * Shown when the three checks found nothing. Offers to report the gap, then
 * follows the report through to a shipped change.
 */
export function AbsenceCard({
  text,
  request,
  escalation,
  reporting,
  blocked,
  noted,
  textNotice,
  notice,
  elapsedSeconds,
  rating,
  canRate,
  onReport,
  onRate,
}: {
  text: string;
  /** Absent when the agent never offered, so there is no drafted title to name. */
  request?: FeatureRequest;
  escalation?: EscalationView;
  reporting?: boolean;
  blocked?: ReportBlock;
  /** The agent already recorded the gap, whether or not the user takes up the offer. */
  noted?: boolean;
  /** The server can send the one text about this gap, so the card can ask for a number. */
  textNotice?: boolean;
  /** What became of the request for that text, once the report was sent. */
  notice?: TextNoticeState;
  elapsedSeconds: number;
  rating?: FeedbackRating;
  canRate: boolean;
  /** `phone` is in E.164 form, and it is there only when the person asked for the text. */
  onReport: (phone?: string) => void;
  onRate: (rating: FeedbackRating) => void;
}) {
  const shown = useReveal(text);
  const settled = shown === text;

  return (
    <div class="pl-card">
      <p>{shown}</p>
      {settled && !escalation && !blocked && request && (
        <ReportForm request={request} reporting={reporting} textNotice={textNotice} onReport={onReport} />
      )}
      {settled && !escalation && blocked && <p class="pl-card__note">{BLOCKED_COPY[blocked]}</p>}
      {settled && !escalation && !blocked && noted && (
        <p class="pl-card__note">I have noted this for the team.</p>
      )}
      {escalation && <Timeline escalation={escalation} elapsedSeconds={elapsedSeconds} />}
      {escalation && notice && noticeStands(notice, escalation.status) && (
        <p class="pl-card__note">{NOTICE_COPY[notice]}</p>
      )}
      {settled && <AnswerActions text={text} rating={rating} canRate={canRate} onRate={onRate} />}
    </div>
  );
}

/**
 * The report button, and above it the one optional question: a text when a change is drafted.
 *
 * The number lives in this component and nowhere else in the widget. It leaves in the report
 * request, only with the box ticked, and it is gone when the card moves on to the timeline.
 */
function ReportForm({
  request,
  reporting,
  textNotice,
  onReport,
}: {
  request: FeatureRequest;
  reporting?: boolean;
  textNotice?: boolean;
  onReport: (phone?: string) => void;
}) {
  const [wanted, setWanted] = useState(false);
  const [typed, setTyped] = useState('');
  const [invalid, setInvalid] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();

  // The form grows when the box is ticked and when the error shows, and the list does not follow
  // a card that grows. Without this the report button can end up below the edge of the panel.
  useEffect(() => {
    if (wanted) form.current?.scrollIntoView?.({ block: 'nearest' });
  }, [wanted, invalid]);

  const submit = (event: Event) => {
    event.preventDefault();
    if (reporting) return;
    const read = readNotice(Boolean(textNotice) && wanted, typed);
    if (!read.ok) {
      setInvalid(true);
      field.current?.focus();
      return;
    }
    onReport(read.phone);
  };

  return (
    <form class="pl-report" ref={form} noValidate onSubmit={submit}>
      {textNotice && (
        <div class="pl-notify">
          <label class="pl-check">
            <input
              type="checkbox"
              checked={wanted}
              disabled={reporting}
              onChange={(event) => {
                setWanted((event.currentTarget as HTMLInputElement).checked);
                setInvalid(false);
              }}
            />
            <span>{NOTICE_LABEL}</span>
          </label>
          {wanted && (
            <>
              <input
                ref={field}
                class="pl-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={typed}
                placeholder={NOTICE_PLACEHOLDER}
                aria-label={NOTICE_FIELD_LABEL}
                aria-describedby={invalid ? `${id}-error ${id}-hint` : `${id}-hint`}
                aria-invalid={invalid}
                disabled={reporting}
                onInput={(event) => {
                  setTyped((event.currentTarget as HTMLInputElement).value);
                  setInvalid(false);
                }}
              />
              {invalid && (
                <p class="pl-notify__error" id={`${id}-error`} role="alert">
                  {NOTICE_ERROR}
                </p>
              )}
              <p class="pl-notify__hint" id={`${id}-hint`}>
                {NOTICE_HINT}
              </p>
            </>
          )}
        </div>
      )}
      <div class="pl-card__actions">
        <button type="submit" class="pl-btn pl-btn--accent" disabled={reporting}>
          {reporting ? 'Reporting' : 'Report to developers'}
        </button>
        <span class="pl-card__label">{request.title}</span>
      </div>
    </form>
  );
}

type Stage = { key: string; label: string; statuses: EscalationStatus[] };

const STAGES: Stage[] = [
  { key: 'filed', label: 'Your request was sent to the team', statuses: ['filing', 'filed', 'updated', 'inspecting', 'drafting', 'pr_open', 'awaiting_approval', 'approved', 'merging', 'deploying', 'shipped'] },
  { key: 'drafted', label: 'Someone is working on it', statuses: ['drafting', 'pr_open', 'awaiting_approval', 'approved', 'merging', 'deploying', 'shipped'] },
  { key: 'pr', label: 'A change is ready for review', statuses: ['pr_open', 'awaiting_approval', 'approved', 'merging', 'deploying', 'shipped'] },
  { key: 'approval', label: 'Waiting on a final check', statuses: ['awaiting_approval', 'approved', 'merging', 'deploying', 'shipped'] },
  { key: 'shipped', label: 'Done, it is live', statuses: ['shipped'] },
];

const ORDER: EscalationStatus[] = [
  'queued', 'filing', 'filed', 'updated', 'inspecting', 'drafting', 'pr_open', 'awaiting_approval',
  'approved', 'merging', 'deploying', 'shipped',
];

function Timeline({ escalation, elapsedSeconds }: { escalation: EscalationView; elapsedSeconds: number }) {
  const status = escalation.status;
  const position = ORDER.indexOf(status);

  if (status === 'failed' || status === 'rejected') {
    return (
      <p class="pl-timeline__note">
        {status === 'rejected'
          ? 'A developer decided not to build this for now.'
          : 'The report could not be completed. The team has the details.'}
      </p>
    );
  }

  return (
    <>
      <span class="pl-card__label">Progress</span>
      <ul class="pl-timeline">
        {STAGES.map((stage) => {
          const reached = stage.statuses.includes(status);
          const furthest = ORDER.indexOf(stage.statuses[0]);
          const state = reached ? (position > furthest ? 'done' : 'current') : 'pending';
          return (
            <li key={stage.key} data-state={state}>
              <span class="pl-timeline__mark" />
              <span class="pl-timeline__body">
                <span>{label(stage, escalation)}</span>
                {state === 'current' && elapsedSeconds > 10 && (
                  <span class="pl-timeline__note">{elapsedSeconds}s so far</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function label(stage: Stage, escalation: EscalationView) {
  if (stage.key === 'filed' && escalation.issueUrl) {
    return (
      <a class="pl-link" href={escalation.issueUrl} target="_blank" rel="noreferrer noopener">
        See your request on GitHub
      </a>
    );
  }
  if (stage.key === 'pr' && escalation.prUrl) {
    return (
      <a class="pl-link" href={escalation.prUrl} target="_blank" rel="noreferrer noopener">
        See the change on GitHub
      </a>
    );
  }
  if (stage.key === 'shipped' && escalation.deploymentUrl) {
    return (
      <a class="pl-link" href={escalation.deploymentUrl} target="_blank" rel="noreferrer noopener">
        It is live now, reload the page to use it
      </a>
    );
  }
  return stage.label;
}
