/**
 * The call state machine.
 *
 * A call is the only mode in which the agent speaks. Outside one the widget is a text chat and
 * the microphone is plain dictation, so the machine below is the single place that decides
 * whether audio is allowed to play.
 */

export type CallPhase = 'listening' | 'thinking' | 'speaking';

export type CallState = {
  active: boolean;
  /** The microphone is off but the call continues; the agent still answers out loud. */
  muted: boolean;
  phase: CallPhase;
};

export type CallAction =
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'toggleMute' }
  /** A transcript was captured, so the question is on its way. */
  | { type: 'heard' }
  /** The answer arrived and playback is starting. */
  | { type: 'answered' }
  /** Playback finished, or could not start at all. */
  | { type: 'spoke' }
  /** Nothing was said, or the turn failed, so the agent goes back to waiting. */
  | { type: 'unheard' };

export const CALL_OFF: CallState = { active: false, muted: false, phase: 'listening' };

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case 'start':
      // Starting a call already under way must not reset the phase mid-answer.
      return state.active ? state : { active: true, muted: false, phase: 'listening' };
    case 'end':
      return CALL_OFF;
    default:
      break;
  }
  if (!state.active) return state;

  switch (action.type) {
    case 'toggleMute':
      return { ...state, muted: !state.muted };
    case 'heard':
      return state.phase === 'listening' ? { ...state, phase: 'thinking' } : state;
    case 'answered':
      // A question can also arrive through the host page's own `ask`, with no listening turn
      // behind it, and the agent still has to be shown as speaking.
      return state.phase === 'speaking' ? state : { ...state, phase: 'speaking' };
    case 'spoke':
      return state.phase === 'speaking' ? { ...state, phase: 'listening' } : state;
    case 'unheard':
      return state.phase === 'listening' ? state : { ...state, phase: 'listening' };
    default:
      return state;
  }
}

/** The word on the call bar. Muting only shows while the agent would otherwise be listening. */
export function callLabel(state: CallState): string {
  if (!state.active) return '';
  if (state.phase === 'listening') return state.muted ? 'Muted' : 'Listening';
  return state.phase === 'thinking' ? 'Thinking' : 'Speaking';
}

/** Whether the microphone should be capturing right now. */
export function shouldListen(state: CallState): boolean {
  return state.active && !state.muted && state.phase === 'listening';
}

/** Whether an answer may be read out loud. Text mode never speaks. */
export function shouldSpeak(state: CallState): boolean {
  return state.active;
}
