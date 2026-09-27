import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { AbsenceCard } from './AbsenceCard';
import { AnswerCard } from './AnswerCard';
import { Thinking } from './Thinking';
import type { WorkStage } from './status';
import type { Turn } from './model';
import type { FeedbackRating } from '../types';

/** How close to the bottom still counts as following the conversation. */
const PINNED_PX = 40;

export function MessageList({
  turns,
  workingTurnId,
  stage,
  workingMs,
  guidingTurnId,
  elapsedSeconds,
  scroll,
  onShowMe,
  onReport,
  onRate,
}: {
  turns: Turn[];
  /** The turn still waiting for its answer, if any. */
  workingTurnId: string | null;
  stage: WorkStage;
  workingMs: number;
  guidingTurnId: string | null;
  elapsedSeconds: number;
  /**
   * Where the list was left, so reopening the panel does not lose the reader's place.
   * Negative means nothing has been read yet, which is different from being at the top.
   */
  scroll: { current: number };
  onShowMe: (turn: Turn) => void;
  onReport: (turn: Turn) => void;
  onRate: (turn: Turn, rating: FeedbackRating) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restored = useRef(false);

  useLayoutEffect(() => {
    const node = list.current;
    if (!node || restored.current) return;
    restored.current = true;
    if (scroll.current < 0) return;
    node.scrollTop = scroll.current;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < PINNED_PX;
  }, [scroll]);

  // Follow the newest message, but never yank the view away from someone reading further up.
  useEffect(() => {
    const node = list.current;
    if (!node || !pinned.current) return;
    node.scrollTop = node.scrollHeight;
    scroll.current = node.scrollTop;
  }, [turns, workingTurnId, stage, scroll]);

  const remember = () => {
    const node = list.current;
    if (!node) return;
    scroll.current = node.scrollTop;
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < PINNED_PX;
  };

  return (
    <div class="pl-messages" ref={list} onScroll={remember}>
      {turns.length === 0 && (
        <div class="pl-empty">
          <h3>How can we help?</h3>
          <p>Ask a question and we will point at the right control on this page.</p>
        </div>
      )}

      {turns.map((turn) => (
        <TurnView
          key={turn.id}
          turn={turn}
          working={workingTurnId === turn.id}
          stage={stage}
          workingMs={workingMs}
          guiding={guidingTurnId === turn.id}
          elapsedSeconds={elapsedSeconds}
          onShowMe={onShowMe}
          onReport={onReport}
          onRate={onRate}
        />
      ))}
    </div>
  );
}

function TurnView({
  turn,
  working,
  stage,
  workingMs,
  guiding,
  elapsedSeconds,
  onShowMe,
  onReport,
  onRate,
}: {
  turn: Turn;
  working: boolean;
  stage: WorkStage;
  workingMs: number;
  guiding: boolean;
  elapsedSeconds: number;
  onShowMe: (turn: Turn) => void;
  onReport: (turn: Turn) => void;
  onRate: (turn: Turn, rating: FeedbackRating) => void;
}) {
  const offer = turn.answer?.escalation;
  const canRate = Boolean(turn.messageId);
  const rate = (rating: FeedbackRating) => onRate(turn, rating);

  return (
    <>
      <div class="pl-msg pl-msg--user">
        <p>{turn.question}</p>
      </div>

      {/* Say that the agent remembered, never what it remembered: reading a stored fact back at
          the visitor on someone else's site is unsettling, and it can be wrong. */}
      {turn.memory && turn.memory.length > 0 && <p class="pl-recall">Welcome back.</p>}

      {working && <Thinking stage={stage} elapsedMs={workingMs} />}

      {turn.error && (
        <div class="pl-msg pl-msg--agent">
          <p>{turn.error}</p>
        </div>
      )}

      {turn.answer && offer && (offer.offered === true || offer.reason) && (
        <AbsenceCard
          text={turn.answer.text}
          request={offer.offered === true ? offer.request : undefined}
          escalation={turn.escalation}
          reporting={turn.reporting}
          blocked={turn.reportBlocked ?? (offer.offered === true ? undefined : offer.reason)}
          noted={turn.answer.noted}
          elapsedSeconds={elapsedSeconds}
          rating={turn.rating}
          canRate={canRate}
          onReport={() => onReport(turn)}
          onRate={rate}
        />
      )}

      {turn.answer && offer?.offered !== true && !offer?.reason && (
        <AnswerCard
          text={turn.answer.text}
          steps={turn.answer.steps}
          plan={turn.answer.plan}
          sources={turn.answer.sources}
          guiding={guiding}
          rating={turn.rating}
          canRate={canRate}
          onShowMe={() => onShowMe(turn)}
          onRate={rate}
        />
      )}
    </>
  );
}
