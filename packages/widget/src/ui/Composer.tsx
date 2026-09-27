import { useEffect, useRef, useState } from 'preact/hooks';
import { MicIcon, SendIcon } from './icons';

export type ComposerProps = {
  value: string;
  busy: boolean;
  voiceSupported: boolean;
  recording: boolean;
  transcribing: boolean;
  /** Bumped after every answer, to put the caret back where the next question is typed. */
  focusToken: number;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onToggleRecording: () => void;
};

export function Composer(props: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    field.current?.focus();
  }, [props.focusToken]);

  useEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 96)}px`;
    node.style.overflowY = node.scrollHeight > 96 ? 'auto' : 'hidden';
    setHeight(node.scrollHeight);
  }, [props.value]);

  // The microphone here is dictation and nothing more: it types for you, and the answer
  // still comes back as text. Speaking out loud is what a call is for.
  const micLabel = props.recording ? 'Stop and send' : 'Dictate a question';

  return (
    <form
      class="pl-composer"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <div class="pl-composer__field">
        <textarea
          ref={field}
          rows={1}
          data-height={height}
          value={props.value}
          placeholder={
            props.transcribing ? 'Transcribing...' : props.recording ? 'Listening...' : 'Ask a question'
          }
          aria-label="Ask a question"
          disabled={props.transcribing}
          onInput={(event) => props.onInput((event.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              props.onSubmit();
            }
          }}
        />
        {props.voiceSupported && (
          <button
            type="button"
            class="pl-icon-btn"
            aria-pressed={props.recording}
            aria-label={micLabel}
            title={micLabel}
            onClick={() => props.onToggleRecording()}
          >
            <MicIcon />
          </button>
        )}
      </div>
      <button type="submit" class="pl-send" aria-label="Send" disabled={props.busy || props.value.trim().length === 0}>
        <SendIcon />
      </button>
    </form>
  );
}
