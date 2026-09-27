import { workLine, type WorkStage } from './status';

/**
 * The bubble that stands in for the answer while the turn is running, so the panel is never
 * blank. Three calm dots and one line saying what the agent is doing right now.
 */
export function Thinking({ stage, elapsedMs }: { stage: WorkStage; elapsedMs: number }) {
  return (
    <div class="pl-thinking" role="status" aria-live="polite">
      <span class="pl-typing" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span class="pl-thinking__line">{workLine(stage, elapsedMs)}</span>
    </div>
  );
}
