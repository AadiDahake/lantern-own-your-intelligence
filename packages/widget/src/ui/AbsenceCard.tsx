import { AnswerActions } from './AnswerActions';
import { useReveal } from './reveal';
import type {
  EscalationStatus,
  EscalationView,
  FeatureRequest,
  FeedbackRating,
  ReportBlock,
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
  elapsedSeconds: number;
  rating?: FeedbackRating;
  canRate: boolean;
  onReport: () => void;
  onRate: (rating: FeedbackRating) => void;
}) {
  const shown = useReveal(text);
  const settled = shown === text;

  return (
    <div class="pl-card">
      <p>{shown}</p>
      {settled && !escalation && !blocked && request && (
        <div class="pl-card__actions">
          <button type="button" class="pl-btn pl-btn--accent" onClick={onReport} disabled={reporting}>
            {reporting ? 'Reporting' : 'Report to developers'}
          </button>
          <span class="pl-card__label">{request.title}</span>
        </div>
      )}
      {settled && !escalation && blocked && <p class="pl-card__note">{BLOCKED_COPY[blocked]}</p>}
      {settled && !escalation && !blocked && noted && (
        <p class="pl-card__note">I have noted this for the team.</p>
      )}
      {escalation && <Timeline escalation={escalation} elapsedSeconds={elapsedSeconds} />}
      {settled && <AnswerActions text={text} rating={rating} canRate={canRate} onRate={onRate} />}
    </div>
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
