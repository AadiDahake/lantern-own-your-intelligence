import { useState } from 'preact/hooks';
import { CheckIcon, CopyIcon, ThumbDownIcon, ThumbUpIcon } from './icons';
import type { FeedbackRating } from '../types';

/**
 * The quiet row under every answer: take the text away, or say whether it helped.
 *
 * A rating is sent once and then reads back as a thank-you, because a control that keeps
 * inviting a second opinion makes people wonder whether the first one arrived.
 */
export function AnswerActions({
  text,
  rating,
  canRate,
  onRate,
}: {
  text: string;
  rating?: FeedbackRating;
  /** False until the answer's message id is known, which is a moment after the text lands. */
  canRate: boolean;
  onRate: (rating: FeedbackRating) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused. Saying nothing is better than an error the user
      // cannot act on; the text is on screen and selectable either way.
    }
  };

  return (
    <div class="pl-answer-actions">
      <button type="button" class="pl-mini" onClick={() => void copy()} aria-label={copied ? 'Copied' : 'Copy the answer'}>
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <span class="pl-answer-actions__spacer" />
      {rating ? (
        <span class="pl-answer-actions__thanks">Thank you</span>
      ) : (
        <>
          <button
            type="button"
            class="pl-mini pl-mini--icon"
            disabled={!canRate}
            aria-label="This answer helped"
            title="This answer helped"
            onClick={() => onRate('up')}
          >
            <ThumbUpIcon />
          </button>
          <button
            type="button"
            class="pl-mini pl-mini--icon"
            disabled={!canRate}
            aria-label="This answer did not help"
            title="This answer did not help"
            onClick={() => onRate('down')}
          >
            <ThumbDownIcon />
          </button>
        </>
      )}
    </div>
  );
}
