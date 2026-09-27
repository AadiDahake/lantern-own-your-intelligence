/**
 * Reveals an answer word by word.
 *
 * The chat API hands the answer over in one piece, so there is nothing to stream. Showing the
 * whole paragraph in a single frame reads as a jump cut; letting the words land over a beat
 * makes the panel feel like it is talking. It is decoration, so reduced motion skips it.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

/** How long the whole answer takes to appear, however long it is. */
export const REVEAL_MS = 600;

const FRAME_MS = 40;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Splits on whitespace but keeps it, so the text never reflows as it grows. */
export function splitWords(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/**
 * The portion of `text` to show right now. Each answer animates once, when its card first
 * appears; later renders of the same card keep the full text.
 */
export function useReveal(text: string): string {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text : ''));
  const started = useRef(false);

  useEffect(() => {
    if (started.current || prefersReducedMotion() || !text) {
      setShown(text);
      return;
    }
    started.current = true;

    const words = splitWords(text);
    const step = Math.max(1, Math.ceil(words.length / Math.max(1, REVEAL_MS / FRAME_MS)));
    let count = 0;
    const timer = setInterval(() => {
      count += step;
      if (count >= words.length) {
        clearInterval(timer);
        setShown(text);
        return;
      }
      setShown(words.slice(0, count).join(''));
    }, FRAME_MS);

    return () => clearInterval(timer);
  }, [text]);

  return shown;
}
