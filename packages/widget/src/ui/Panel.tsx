import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { CloseIcon, PhoneIcon, SpeakerIcon } from './icons';

const FOCUSABLE = 'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Panel({
  title,
  subtitle,
  speaking,
  onCall,
  onStopSpeaking,
  onClose,
  onEscape,
  children,
}: {
  title: string;
  subtitle: string;
  speaking: boolean;
  /** Absent during a call: the call bar owns leaving it. */
  onCall?: () => void;
  onStopSpeaking: () => void;
  onClose: () => void;
  onEscape: () => void;
  children: ComponentChildren;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Focus stays inside the panel while it is open, but the panel never pulls
  // focus away from a control the spotlight is pointing at.
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === node.ownerDocument.activeElement,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = (node.getRootNode() as ShadowRoot).activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [onEscape]);

  return (
    <div class="pl-panel" role="dialog" aria-label={title} ref={panel}>
      <header class="pl-header">
        <div class="pl-header__text">
          <p class="pl-header__title">{title}</p>
          <p class="pl-header__sub">{subtitle}</p>
        </div>
        <span class="pl-header__spacer" />
        {onCall && (
          <button type="button" class="pl-btn pl-btn--call" onClick={onCall}>
            <PhoneIcon />
            <span>Start a call</span>
          </button>
        )}
        {speaking && (
          <button type="button" class="pl-icon-btn" aria-label="Stop speaking" onClick={onStopSpeaking}>
            <SpeakerIcon />
          </button>
        )}
        <button type="button" class="pl-icon-btn" aria-label="Close support" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      {children}
    </div>
  );
}
