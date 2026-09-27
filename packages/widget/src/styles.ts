/**
 * The widget's only stylesheet. It is constructed once and adopted by the shadow
 * root, so nothing leaks in either direction. The five tokens on `:host` are the
 * public surface customers may override.
 */

export const TOKEN_DEFAULTS = {
  '--pl-accent': '#2e6f54',
  '--pl-ink': '#17201c',
  '--pl-muted': '#5b645f',
  '--pl-glass': 'rgba(255, 253, 247, 0.6)',
  '--pl-radius': '18px',
} as const;

const SHEET = `
:host {
  --pl-accent: ${TOKEN_DEFAULTS['--pl-accent']};
  --pl-ink: ${TOKEN_DEFAULTS['--pl-ink']};
  --pl-muted: ${TOKEN_DEFAULTS['--pl-muted']};
  --pl-glass: ${TOKEN_DEFAULTS['--pl-glass']};
  --pl-radius: ${TOKEN_DEFAULTS['--pl-radius']};

  --pl-accent-deep: #174633;
  /* The accent as text: the deep green on light glass, a lighter green on dark. */
  --pl-accent-text: var(--pl-accent);
  --pl-glass-strong: rgba(255, 253, 247, 0.82);
  --pl-border: rgba(255, 255, 255, 0.72);
  --pl-hairline: rgba(23, 32, 28, 0.1);
  --pl-field: rgba(255, 255, 255, 0.5);
  --pl-bubble: rgba(255, 255, 255, 0.62);
  --pl-shadow: 0 28px 74px rgba(23, 32, 28, 0.24), 0 2px 10px rgba(23, 32, 28, 0.08);
  --pl-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 0 0 1px rgba(255, 255, 255, 0.28);
  --pl-scrim: rgba(14, 18, 16, 0.42);
  --pl-blur: blur(32px) saturate(170%);
  --pl-serif: ui-serif, Georgia, "Times New Roman", serif;

  all: initial;
  position: fixed;
  inset: auto 0 0 auto;
  z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--pl-ink);
  -webkit-font-smoothing: antialiased;
}

:host([data-pl-scheme="dark"]) {
  --pl-ink: #f2f2f5;
  --pl-muted: #b3b3bd;
  --pl-accent-text: #9fd0b5;
  --pl-accent-deep: #2e6f54;
  --pl-glass: rgba(28, 30, 29, 0.66);
  --pl-glass-strong: rgba(30, 30, 36, 0.92);
  --pl-border: rgba(255, 255, 255, 0.14);
  --pl-hairline: rgba(255, 255, 255, 0.1);
  --pl-field: rgba(255, 255, 255, 0.07);
  --pl-bubble: rgba(255, 255, 255, 0.08);
  --pl-shadow: 0 28px 74px rgba(0, 0, 0, 0.5), 0 2px 10px rgba(0, 0, 0, 0.35);
  --pl-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  --pl-scrim: rgba(4, 6, 5, 0.55);
}

*, *::before, *::after { box-sizing: border-box; }

.pl-root {
  position: fixed;
  bottom: 22px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
}
.pl-root[data-position="right"] { right: 22px; align-items: flex-end; }
.pl-root[data-position="left"] { left: 22px; align-items: flex-start; }

/* Launcher */
.pl-launcher {
  appearance: none;
  position: relative;
  width: 62px;
  height: 62px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: var(--pl-accent-deep);
  box-shadow:
    0 16px 38px rgba(23, 70, 51, 0.36),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
  color: #fffdf7;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
}
.pl-launcher:hover {
  transform: translateY(-2px);
  background: var(--pl-accent);
  box-shadow:
    0 20px 44px rgba(23, 70, 51, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
}
.pl-launcher:active { transform: translateY(0) scale(0.96); }
.pl-launcher[aria-expanded="true"] { background: var(--pl-accent); }
.pl-launcher:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 3px; }
.pl-launcher svg { width: 26px; height: 26px; display: block; }
/* One small mark, no count: the panel is one conversation, so a number would always read "1". */
.pl-launcher__dot {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #fffdf7;
  box-shadow: 0 0 0 2px var(--pl-accent-deep);
}

/* Panel */
.pl-panel {
  width: min(380px, calc(100vw - 32px));
  height: min(560px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  position: relative;
  border-radius: var(--pl-radius);
  border: 1px solid var(--pl-border);
  background:
    linear-gradient(to bottom, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0) 34%),
    radial-gradient(120% 80% at 90% 0%, rgba(46, 111, 84, 0.1), transparent 60%),
    var(--pl-glass);
  -webkit-backdrop-filter: var(--pl-blur);
  backdrop-filter: var(--pl-blur);
  box-shadow: var(--pl-shadow);
  overflow: hidden;
  transform-origin: bottom right;
  animation: pl-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.pl-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: var(--pl-highlight);
}
.pl-root[data-position="left"] .pl-panel { transform-origin: bottom left; }
:host([data-pl-scheme="dark"]) .pl-panel::before { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1); }
/* The light sheen across the top of the glass is tuned for a pale ground. At full strength on a
   dark host it reads as a smudge, so the dark scheme gets the same shape at a fifth of it. */
:host([data-pl-scheme="dark"]) .pl-panel {
  background:
    linear-gradient(to bottom, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0) 34%),
    radial-gradient(120% 80% at 90% 0%, rgba(46, 111, 84, 0.18), transparent 60%),
    var(--pl-glass);
}

@keyframes pl-in { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }

.pl-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 13px;
  border-bottom: 1px solid var(--pl-hairline);
}
.pl-header__title {
  margin: 0;
  font-family: var(--pl-serif);
  font-size: 19px;
  font-weight: 500;
  letter-spacing: -0.01em;
  line-height: 1.15;
}
.pl-header__sub { font-size: 12px; color: var(--pl-muted); margin: 2px 0 0; }
.pl-header__text { min-width: 0; }
.pl-header__text p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-header__spacer { flex: 1; }

.pl-icon-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--pl-muted);
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pl-icon-btn:hover { background: var(--pl-field); color: var(--pl-ink); }
.pl-icon-btn:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-icon-btn[aria-pressed="true"] { color: var(--pl-accent-text); background: color-mix(in srgb, var(--pl-accent) 12%, transparent); }
.pl-icon-btn svg { width: 17px; height: 17px; }

/* Messages */
.pl-messages {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
}
.pl-empty { margin: auto 0; text-align: center; color: var(--pl-muted); padding: 8px 12px; }
.pl-empty h3 {
  margin: 0 0 8px;
  font-family: var(--pl-serif);
  font-size: 22px;
  font-weight: 500;
  color: var(--pl-ink);
}
.pl-empty p { margin: 0; font-size: 14px; }

.pl-msg { max-width: 88%; padding: 9px 12px; border-radius: 14px; font-size: 14px; }
.pl-msg--user {
  align-self: flex-end;
  background: color-mix(in srgb, var(--pl-accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--pl-accent) 24%, transparent);
}
.pl-msg--agent { align-self: flex-start; background: var(--pl-bubble); border: 1px solid var(--pl-hairline); }
.pl-msg p { margin: 0; white-space: pre-wrap; }

/* One quiet line when the agent already knows this visitor. */
.pl-recall {
  align-self: flex-start;
  margin: -4px 0 0;
  padding: 0 2px;
  color: var(--pl-muted);
  font-size: 11.5px;
  line-height: 1.45;
}

/* Cards */
.pl-card {
  align-self: stretch;
  border: 1px solid var(--pl-hairline);
  background: var(--pl-glass-strong);
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pl-card p { margin: 0; font-size: 14px; white-space: pre-wrap; }
.pl-card__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--pl-muted); }
.pl-card__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pl-card__note { color: var(--pl-muted); font-size: 12.5px; }

.pl-btn {
  appearance: none;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  border-radius: 10px;
  padding: 7px 12px;
  border: 1px solid var(--pl-hairline);
  background: var(--pl-field);
  color: var(--pl-ink);
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.pl-btn:hover { transform: translateY(-1px); }
.pl-btn:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-btn:disabled { opacity: 0.55; cursor: default; transform: none; }
.pl-btn--accent { background: var(--pl-accent-deep); border-color: transparent; color: #fffdf7; }
.pl-btn--accent:hover { background: var(--pl-accent); }
.pl-btn--quiet { background: transparent; color: var(--pl-muted); }
.pl-btn svg { width: 15px; height: 15px; flex: none; }
.pl-btn--call,
.pl-btn--end {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 6px 11px;
  white-space: nowrap;
}
.pl-btn--call { background: color-mix(in srgb, var(--pl-accent) 13%, transparent); border-color: color-mix(in srgb, var(--pl-accent) 30%, transparent); color: var(--pl-accent-deep); }
.pl-btn--call:hover { background: color-mix(in srgb, var(--pl-accent) 20%, transparent); }
:host([data-pl-scheme="dark"]) .pl-btn--call { color: var(--pl-ink); }
.pl-btn--end { background: #b3261e; border-color: transparent; color: #fffdf7; }
.pl-btn--end:hover { background: #c9372f; }

/* The working state: three dots and one honest line about what is happening. */
.pl-thinking {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border-radius: 14px;
  background: var(--pl-bubble);
  border: 1px solid var(--pl-hairline);
  max-width: 88%;
}
.pl-thinking__line { font-size: 13px; color: var(--pl-muted); }
.pl-typing { display: inline-flex; gap: 4px; flex: none; }
.pl-typing span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--pl-accent);
  opacity: 0.35;
  animation: pl-typing 1.25s ease-in-out infinite;
}
.pl-typing span:nth-child(2) { animation-delay: 0.16s; }
.pl-typing span:nth-child(3) { animation-delay: 0.32s; }
@keyframes pl-typing { 0%, 60%, 100% { opacity: 0.3; transform: none; } 30% { opacity: 1; transform: translateY(-2px); } }

/* Copy and rating, quiet until the pointer is on them. */
.pl-answer-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding-top: 9px;
  border-top: 1px solid var(--pl-hairline);
}
.pl-answer-actions__spacer { flex: 1; }
.pl-answer-actions__thanks { font-size: 11.5px; color: var(--pl-muted); }
.pl-mini {
  appearance: none;
  font: inherit;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: var(--pl-muted);
  border-radius: 8px;
  padding: 4px 7px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pl-mini:hover:not(:disabled) { background: var(--pl-field); color: var(--pl-ink); }
.pl-mini:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-mini:disabled { opacity: 0.4; cursor: default; }
.pl-mini svg { width: 14px; height: 14px; }
.pl-mini--icon { padding: 5px; }

/* Call bar, in the composer's place */
.pl-call {
  border-top: 1px solid var(--pl-hairline);
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.pl-call__state { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; }
.pl-call__body { min-width: 0; display: flex; flex-direction: column; }
.pl-call__label { font-size: 13px; font-weight: 550; }
.pl-call__transcript {
  font-size: 11.5px;
  color: var(--pl-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-call__pulse {
  width: 9px;
  height: 9px;
  flex: none;
  border-radius: 999px;
  background: var(--pl-accent);
  animation: pl-pulse 1.4s ease-in-out infinite;
}
.pl-call__pulse--thinking { animation-duration: 0.9s; }
.pl-call__pulse--speaking { animation: none; opacity: 1; }
.pl-call__pulse--muted { animation: none; background: var(--pl-muted); opacity: 0.5; }

/* Escalation timeline */
.pl-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pl-timeline li { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; }
.pl-timeline__mark {
  width: 8px; height: 8px; margin-top: 6px; border-radius: 999px; flex: none;
  border: 1px solid var(--pl-muted); background: transparent;
}
.pl-timeline li[data-state="done"] .pl-timeline__mark { background: var(--pl-muted); }
.pl-timeline li[data-state="current"] .pl-timeline__mark { background: var(--pl-accent); border-color: var(--pl-accent); }
.pl-timeline li[data-state="pending"] { color: var(--pl-muted); }
.pl-timeline__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pl-timeline__note { color: var(--pl-muted); font-size: 11.5px; }
.pl-link { color: var(--pl-accent-text); text-decoration: none; font-weight: 550; }
.pl-link:hover { text-decoration: underline; }

/* Composer */
.pl-composer {
  border-top: 1px solid var(--pl-hairline);
  padding: 10px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.pl-composer__field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--pl-field);
  border: 1px solid var(--pl-hairline);
  border-radius: 13px;
  padding: 6px 8px 6px 12px;
}
.pl-composer__field:focus-within { border-color: color-mix(in srgb, var(--pl-accent) 45%, transparent); }
.pl-composer textarea {
  flex: 1;
  min-width: 0;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: var(--pl-ink);
  max-height: 96px;
  padding: 3px 0;
  /* The field grows to fit its text, so it only scrolls once it hits the cap. Left on auto it
     shows a scrollbar with stepper arrows on a one-line question. */
  overflow-y: hidden;
  scrollbar-width: thin;
}
.pl-composer textarea::-webkit-scrollbar { width: 6px; }
.pl-composer textarea::-webkit-scrollbar-button { display: none; }
.pl-composer textarea::-webkit-scrollbar-thumb { border-radius: 999px; background: var(--pl-hairline); }
.pl-composer textarea::placeholder { color: var(--pl-muted); }
.pl-send {
  appearance: none;
  border: 0;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 11px;
  background: var(--pl-accent-deep);
  color: #fffdf7;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.pl-send:hover:not(:disabled) { background: var(--pl-accent); }
.pl-send:disabled { opacity: 0.35; cursor: default; }
.pl-send:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; }
.pl-send svg { width: 16px; height: 16px; }
.pl-hint { font-size: 11px; color: var(--pl-muted); padding: 0 12px 8px; }

.pl-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* Spotlight */
.pl-spot {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  overflow: visible;
  pointer-events: none;
}
.pl-spot::backdrop { background: transparent; }
.pl-spot--fallback { z-index: 2147483001; }
.pl-spot__svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.pl-spot__scrim { fill: var(--pl-scrim); transition: opacity 160ms ease; }
.pl-spot__ring {
  fill: none;
  stroke: var(--pl-accent);
  stroke-width: 2;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--pl-accent) 55%, transparent));
  transition: x 160ms ease, y 160ms ease, width 160ms ease, height 160ms ease;
}
.pl-spot__bubble {
  position: absolute;
  top: 0;
  left: 0;
  width: 260px;
  pointer-events: auto;
  border-radius: 14px;
  border: 1px solid var(--pl-border);
  background: var(--pl-glass-strong);
  -webkit-backdrop-filter: var(--pl-blur);
  backdrop-filter: var(--pl-blur);
  box-shadow: var(--pl-shadow), var(--pl-highlight);
  padding: 12px 13px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--pl-ink);
  transition: transform 160ms ease;
}
/* A caret on the edge facing the ring, so the caption reads as being about that control and
   not as a notice that happens to be nearby. */
.pl-spot__bubble::after {
  content: "";
  position: absolute;
  left: 24px;
  width: 11px;
  height: 11px;
  background: var(--pl-glass-strong);
  border: 1px solid var(--pl-border);
  transform: rotate(45deg);
}
.pl-spot__bubble[data-side="below"]::after {
  top: -6.5px;
  border-right: 0;
  border-bottom: 0;
}
.pl-spot__bubble[data-side="above"]::after {
  bottom: -6.5px;
  border-left: 0;
  border-top: 0;
}
.pl-spot__counter {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--pl-accent-text);
}
.pl-spot__caption { margin: 0; font-size: 14px; line-height: 1.45; }
.pl-spot__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 1px; }
.pl-spot--busy .pl-spot__caption { opacity: 0.6; }

@media (prefers-reduced-motion: reduce) {
  .pl-panel { animation: none; }
  .pl-launcher, .pl-btn, .pl-spot__bubble, .pl-spot__ring, .pl-spot__scrim { transition: none; }
  .pl-typing span { animation: none; opacity: 0.75; }
  .pl-call__pulse { animation: none; opacity: 1; }
  .pl-mini { transition: none; }
}
`;

/** Adopts the stylesheet, falling back to a <style> tag on older browsers. */
export function attachStyles(root: ShadowRoot): void {
  if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in Document.prototype) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(SHEET);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    } catch {
      // Constructed stylesheets unavailable; fall through.
    }
  }
  const style = document.createElement('style');
  style.textContent = SHEET;
  root.appendChild(style);
}

/**
 * Reads the host page's own background and mirrors its brightness, so the widget
 * looks native on a dark console and on a white one without any configuration.
 *
 * It looks at what is actually painted behind the widget's corner, walking up from the element
 * there until something has an opaque colour, because a page whose body only carries a gradient
 * would otherwise report nothing. The body and the root come next, then the system preference.
 */
export function detectScheme(): 'light' | 'dark' {
  const candidates: Element[] = [];
  if (typeof document.elementFromPoint === 'function') {
    // Beside the launcher, not under it, so the widget never reads its own colour.
    const hit = document.elementFromPoint(Math.max(innerWidth - 120, 0), Math.max(innerHeight - 30, 0));
    for (let node: Element | null = hit; node; node = node.parentElement) {
      if (node.tagName.toLowerCase() !== 'lantern-widget') candidates.push(node);
    }
  }
  candidates.push(document.body, document.documentElement);
  for (const element of candidates) {
    if (!element) continue;
    const colour = getComputedStyle(element).backgroundColor;
    const luminance = relativeLuminance(colour);
    if (luminance !== null) return luminance < 0.4 ? 'dark' : 'light';
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function relativeLuminance(colour: string): number | null {
  const match = colour.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  if (parts.length > 3 && parts[3] === 0) return null;
  const [r, g, b] = parts;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
