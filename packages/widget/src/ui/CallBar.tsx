import { callLabel, type CallState } from './call';
import { MicIcon, MicOffIcon, PhoneEndIcon } from './icons';

/**
 * What sits where the composer sits during a call: the state of the line, a mute toggle and
 * the way out. The transcript shows here too, so a mishearing is visible before the answer.
 */
export function CallBar({
  state,
  transcript,
  onToggleMute,
  onEnd,
}: {
  state: CallState;
  transcript: string;
  onToggleMute: () => void;
  onEnd: () => void;
}) {
  const label = callLabel(state);
  return (
    <div class="pl-call" role="group" aria-label="Call controls">
      <div class="pl-call__state">
        <span class={`pl-call__pulse pl-call__pulse--${state.muted ? 'muted' : state.phase}`} aria-hidden="true" />
        <span class="pl-call__body">
          <span class="pl-call__label" role="status" aria-live="polite">
            {label}
          </span>
          {transcript && <span class="pl-call__transcript">{transcript}</span>}
        </span>
      </div>
      <button
        type="button"
        class="pl-icon-btn"
        aria-pressed={state.muted}
        aria-label={state.muted ? 'Unmute the microphone' : 'Mute the microphone'}
        title={state.muted ? 'Unmute' : 'Mute'}
        onClick={onToggleMute}
      >
        {state.muted ? <MicOffIcon /> : <MicIcon />}
      </button>
      <button type="button" class="pl-btn pl-btn--end" onClick={onEnd}>
        <PhoneEndIcon />
        <span>End call</span>
      </button>
    </div>
  );
}
