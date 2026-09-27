/**
 * The on-page spotlight: a scrim with a rounded hole over the target control and
 * a caption bubble beside it. The scrim never takes pointer events, so the user
 * clicks the real control rather than a copy of it.
 */
import { isPointable } from './geometry';

export type SpotlightView = {
  target: Element;
  caption: string;
  index: number;
  total: number;
  /** Last step shows Done instead of Next. */
  isLast: boolean;
  busy?: boolean;
};

export type SpotlightHandlers = {
  onNext: () => void;
  onDone: () => void;
  onStop: () => void;
  /** The target cannot be drawn any more, so the guide has to find another one. */
  onLost?: () => void;
};

const PADDING = 8;
const RADIUS = 12;
const BUBBLE_WIDTH = 260;
const GAP = 14;

export class Spotlight {
  private readonly root: HTMLDivElement;
  private readonly hole: SVGRectElement;
  private readonly ring: SVGRectElement;
  private readonly bubble: HTMLDivElement;
  private readonly counter: HTMLSpanElement;
  private readonly text: HTMLParagraphElement;
  private readonly advance: HTMLButtonElement;
  private readonly stop: HTMLButtonElement;

  private view: SpotlightView | null = null;
  private frame = 0;
  private open = false;
  /** Layout can move the control without any scroll or resize: a panel opening above it, a
      font loading, a row being added. Both observers feed the same throttled reposition. */
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  constructor(private readonly host: ShadowRoot, private readonly handlers: SpotlightHandlers) {
    const { root, hole, ring, bubble, counter, text, advance, stop } = build();
    this.root = root;
    this.hole = hole;
    this.ring = ring;
    this.bubble = bubble;
    this.counter = counter;
    this.text = text;
    this.advance = advance;
    this.stop = stop;

    this.advance.addEventListener('click', () => {
      if (!this.view) return;
      if (this.view.isLast) this.handlers.onDone();
      else this.handlers.onNext();
    });
    this.stop.addEventListener('click', () => this.handlers.onStop());
    this.host.appendChild(this.root);
  }

  show(view: SpotlightView): void {
    // A control that has been unmounted still answers with a zero rect, and a
    // caption drawn against one lands in the corner of the screen pointing at
    // nothing. Say so instead of drawing it.
    if (!isPointable(view.target)) {
      this.hide();
      this.handlers.onLost?.();
      return;
    }
    // A step often lives further down the page or inside a scrolled dialog.
    // Measuring before scrolling puts the ring where the control used to be.
    const rect = view.target.getBoundingClientRect();
    const offscreen =
      rect.top < 8 ||
      rect.left < 8 ||
      rect.bottom > window.innerHeight - 8 ||
      rect.right > window.innerWidth - 8;
    if (offscreen) {
      view.target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    }
    const previous = this.view?.target ?? null;
    this.view = view;
    this.counter.textContent = `Step ${view.index + 1} of ${view.total}`;
    this.root.dataset.plStep = String(view.index + 1);
    this.root.dataset.plTotal = String(view.total);
    this.text.textContent = view.caption;
    this.advance.textContent = view.isLast ? 'Done' : 'Next';
    this.advance.hidden = true;
    this.root.classList.toggle('pl-spot--busy', Boolean(view.busy));
    if (!this.open) {
      this.open = true;
      showTopLayer(this.root);
      addEventListener('scroll', this.schedule, true);
      addEventListener('resize', this.schedule);
      this.watchLayout();
    }
    if (previous !== view.target) this.follow(view.target);
    this.reposition();
  }

  /** Follows the target's own box, so the ring moves when the control does. */
  private follow(target: Element): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    this.resizeObserver.observe(target);
  }

  /** Follows the page around the target, throttled to one frame however busy the host is. */
  private watchLayout(): void {
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    this.mutationObserver = new MutationObserver(() => this.schedule());
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'],
    });
  }

  hide(): void {
    this.view = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    delete this.root.dataset.plStep;
    delete this.root.dataset.plTotal;
    if (!this.open) return;
    this.open = false;
    hideTopLayer(this.root);
    removeEventListener('scroll', this.schedule, true);
    removeEventListener('resize', this.schedule);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  destroy(): void {
    this.hide();
    this.root.remove();
  }

  private readonly schedule = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.reposition();
    });
  };

  private reposition(): void {
    if (!this.view) return;
    if (!isPointable(this.view.target)) {
      this.hide();
      this.handlers.onLost?.();
      return;
    }
    const rect = this.view.target.getBoundingClientRect();
    const width = innerWidth;
    const height = innerHeight;

    const x = Math.max(rect.left - PADDING, 4);
    const y = Math.max(rect.top - PADDING, 4);
    const w = Math.max(rect.width + PADDING * 2, 12);
    const h = Math.max(rect.height + PADDING * 2, 12);

    for (const node of [this.hole, this.ring]) {
      node.setAttribute('x', String(x));
      node.setAttribute('y', String(y));
      node.setAttribute('width', String(Math.min(w, width - x - 4)));
      node.setAttribute('height', String(Math.min(h, height - y - 4)));
      node.setAttribute('rx', String(RADIUS));
    }

    const below = y + h + GAP;
    const bubbleHeight = this.bubble.offsetHeight || 120;
    const fitsBelow = below + bubbleHeight < height;
    const top = fitsBelow ? below : Math.max(y - GAP - bubbleHeight, 8);
    const left = Math.min(Math.max(x, 8), Math.max(width - BUBBLE_WIDTH - 8, 8));
    this.bubble.dataset.side = fitsBelow ? 'below' : 'above';
    this.bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
}

function build() {
  const root = document.createElement('div');
  root.className = 'pl-spot';
  root.setAttribute('popover', 'manual');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pl-spot__svg');
  svg.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
  mask.setAttribute('id', 'pl-spot-mask');
  const full = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  full.setAttribute('width', '100%');
  full.setAttribute('height', '100%');
  full.setAttribute('fill', 'white');
  const hole = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  hole.setAttribute('fill', 'black');
  mask.append(full, hole);
  defs.append(mask);

  const scrim = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  scrim.setAttribute('class', 'pl-spot__scrim');
  scrim.setAttribute('width', '100%');
  scrim.setAttribute('height', '100%');
  scrim.setAttribute('mask', 'url(#pl-spot-mask)');

  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  ring.setAttribute('class', 'pl-spot__ring');
  svg.append(defs, scrim, ring);

  const bubble = document.createElement('div');
  bubble.className = 'pl-spot__bubble';

  const counter = document.createElement('span');
  counter.className = 'pl-spot__counter';

  const text = document.createElement('p');
  text.className = 'pl-spot__caption';

  const actions = document.createElement('div');
  actions.className = 'pl-spot__actions';

  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'pl-btn pl-btn--quiet';
  stop.textContent = 'Skip';

  const advance = document.createElement('button');
  advance.type = 'button';
  advance.className = 'pl-btn pl-btn--accent';
  advance.textContent = 'Next';
  advance.hidden = true;

  actions.append(stop, advance);
  bubble.append(counter, text, actions);
  root.append(svg, bubble);

  return { root, hole, ring, bubble, counter, text, advance, stop };
}

type PopoverElement = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };

function showTopLayer(element: HTMLElement): void {
  const popover = element as PopoverElement;
  if (typeof popover.showPopover === 'function') {
    try {
      popover.showPopover();
      return;
    } catch {
      // Already open, or popover unsupported despite the method being present.
    }
  }
  element.classList.add('pl-spot--fallback');
}

function hideTopLayer(element: HTMLElement): void {
  const popover = element as PopoverElement;
  if (typeof popover.hidePopover === 'function') {
    try {
      popover.hidePopover();
    } catch {
      // Not open; nothing to close.
    }
  }
  element.classList.remove('pl-spot--fallback');
}
