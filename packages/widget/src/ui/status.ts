/**
 * What the panel says while a question is in flight.
 *
 * Every line is driven by an event that really happened on the server, so the wording is a
 * report and not a decoration. The stages only ever move forward: the three checks run in
 * parallel and their results can land in any order, and a status that jumps backwards reads
 * as a fault even when nothing is wrong.
 */
import type { ChatEvent } from '../types';

export type WorkStage = 'reading' | 'docs' | 'page' | 'code' | 'deciding' | 'writing';

/** Increasing order of progress. The index is the stage's rank. */
export const WORK_STAGES: readonly WorkStage[] = [
  'reading',
  'docs',
  'page',
  'code',
  'deciding',
  'writing',
];

/**
 * The three checks, in the words the user reads: help documentation, the current interface, and
 * the product capabilities that are known to exist. The third one is the `repository` probe. It
 * says "capabilities" rather than "code" because a customer is asking what the product can do,
 * not what is in a source tree.
 */
export const WORK_LABELS: Record<WorkStage, string> = {
  reading: 'Reading your question',
  docs: 'Checking the documentation',
  page: 'Looking at this page',
  code: 'Checking known product capabilities',
  deciding: 'Deciding',
  writing: 'Writing the answer',
};

export const FIRST_STAGE: WorkStage = 'reading';

/**
 * The shortest time one stage stays on screen.
 *
 * The three checks run in parallel, so their results reach the widget in a single burst and the
 * line would otherwise skip from "Checking the documentation" straight to "Writing the answer".
 * Every stage still comes from an event that happened; this only slows the reading of them down
 * to human speed.
 */
export const STAGE_DWELL_MS = 700;

/** After this long without an answer, the line admits that it is taking a while. */
export const STILL_WORKING_MS = 8000;

export const STILL_WORKING = 'Still working';

/** The stage an event reports, or null when the event says nothing about progress. */
function stageOf(event: ChatEvent): WorkStage | null {
  switch (event.type) {
    case 'conversation':
      return 'reading';
    case 'understanding':
      // A greeting and a question the page answers run no check, so the line must not claim one.
      // Nothing follows this event for them but the answer itself.
      return event.intent === 'chat' || event.intent === 'page' ? 'writing' : 'docs';
    case 'probe':
      if (event.status === 'running') return 'docs';
      if (event.probe === 'docs') return 'page';
      if (event.probe === 'interface') return 'code';
      return 'deciding';
    case 'verdict':
      return 'writing';
    default:
      return null;
  }
}

/** Folds one event into the stage the panel is showing. Never moves backwards. */
export function nextStage(current: WorkStage, event: ChatEvent): WorkStage {
  const reported = stageOf(event);
  if (!reported) return current;
  return WORK_STAGES.indexOf(reported) > WORK_STAGES.indexOf(current) ? reported : current;
}

/** One step of the line towards the stage the events have already reached. */
export function advanceTowards(shown: WorkStage, target: WorkStage): WorkStage {
  const at = WORK_STAGES.indexOf(shown);
  return WORK_STAGES.indexOf(target) > at ? (WORK_STAGES[at + 1] as WorkStage) : shown;
}

/** The line under the typing dots, with the patience note once the turn is slow. */
export function workLine(stage: WorkStage, elapsedMs: number): string {
  const label = WORK_LABELS[stage];
  return elapsedMs >= STILL_WORKING_MS ? `${label}. ${STILL_WORKING}` : label;
}
