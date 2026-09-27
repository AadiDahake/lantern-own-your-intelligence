import { AnswerActions } from './AnswerActions';
import { useReveal } from './reveal';
import type { AnswerSource, FeedbackRating, PlanSummary, Step } from '../types';

/** An answer that resolved to real controls, with the button that starts guidance. */
export function AnswerCard({
  text,
  steps,
  plan,
  sources,
  guiding,
  rating,
  canRate,
  onShowMe,
  onRate,
}: {
  text: string;
  steps: Step[] | null;
  plan?: PlanSummary;
  sources?: AnswerSource[];
  guiding: boolean;
  rating?: FeedbackRating;
  canRate: boolean;
  onShowMe: () => void;
  onRate: (rating: FeedbackRating) => void;
}) {
  const shown = useReveal(text);
  const settled = shown === text;
  // The count is the plan's, fixed for the whole walk; the steps list is the same length on a
  // route read off the site graph, and stands in when the server sent no summary.
  const total = plan?.total ?? steps?.length ?? 0;

  return (
    <div class="pl-card">
      <p>{shown}</p>
      {settled && steps && steps.length > 0 && (
        <div class="pl-card__actions">
          <button type="button" class="pl-btn pl-btn--accent" onClick={onShowMe} disabled={guiding}>
            {guiding ? 'Showing you' : 'Show me'}
          </button>
          <span class="pl-card__label">
            {total} step{total === 1 ? '' : 's'}
          </span>
        </div>
      )}
      {settled && sources && sources.length > 0 && (
        <p class="pl-card__note">
          From:{' '}
          {sources.map((source, index) => (
            <span key={`${source.title}-${index}`}>
              {index > 0 ? ', ' : ''}
              {source.url ? (
                <a class="pl-link" href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              ) : (
                source.title
              )}
            </span>
          ))}
        </p>
      )}
      {settled && <AnswerActions text={text} rating={rating} canRate={canRate} onRate={onRate} />}
    </div>
  );
}
