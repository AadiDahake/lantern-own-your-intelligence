import { computeAccessibleName } from 'dom-accessibility-api';
import type { Affordance, PageContext } from '../types';
import { rank, type RankInput } from './rank';
import { visibleText } from './text';

/** Everything the scanner treats as a control. Exported so the transition watcher agrees with it. */
export const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="option"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(',');

const MAX_AFFORDANCES = 150;

export type ScanResult = { page: PageContext; lookup: Map<string, Element> };

export type ScanOptions = {
  /** Question tokens steer ranking so the model sees the relevant controls. */
  question?: string;
  root?: Document;
  limit?: number;
  /** Elements inside the widget's own shadow host are never affordances. */
  exclude?: Element | null;
};

export function scanAffordances(options: ScanOptions = {}): ScanResult {
  const doc = options.root ?? document;
  const question = options.question ?? '';
  const limit = options.limit ?? MAX_AFFORDANCES;

  const candidates: Candidate[] = [];
  const seen = new Set<Element>();
  collect(doc.body ?? doc.documentElement, candidates, seen, options.exclude ?? null);

  const kept = rank(candidates, question, limit);
  const lookup = new Map<string, Element>();
  const affordances: Affordance[] = kept.map((candidate, index) => {
    const id = `a${index + 1}`;
    lookup.set(id, candidate.element);
    const affordance: Affordance = {
      id,
      role: candidate.role,
      name: candidate.name,
      visible: candidate.visible,
    };
    if (candidate.text && candidate.text !== candidate.name) affordance.text = candidate.text;
    if (candidate.landmark) affordance.landmark = candidate.landmark;
    if (candidate.href) affordance.href = candidate.href;
    if (candidate.disabled) affordance.disabled = true;
    if (candidate.state) affordance.state = candidate.state;
    return affordance;
  });

  return {
    page: {
      url: doc.defaultView?.location?.href ?? '',
      title: doc.title ?? '',
      affordances,
      text: visibleText(doc.body ?? doc.documentElement, options.exclude ?? null),
    },
    lookup,
  };
}

type Candidate = RankInput & { element: Element };

/** Walks the tree once, descending into open shadow roots. */
function collect(root: Element | null, out: Candidate[], seen: Set<Element>, exclude: Element | null): void {
  if (!root) return;
  const queue: Element[] = [root];
  while (queue.length) {
    const node = queue.shift() as Element;
    if (exclude && (node === exclude || exclude.contains(node))) continue;

    if (node !== root && !seen.has(node) && matches(node, INTERACTIVE_SELECTOR)) {
      seen.add(node);
      out.push(describe(node));
    }
    for (const child of Array.from(node.children)) queue.push(child);
    const shadow = (node as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (shadow && shadow.mode === 'open') {
      for (const child of Array.from(shadow.children)) queue.push(child);
    }
  }
}

function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** The scanner's description of one element, without an id: what identifies it to the graph. */
export function describeElement(element: Element): Affordance {
  const candidate = describe(element);
  const affordance: Affordance = { id: '', role: candidate.role, name: candidate.name, visible: candidate.visible };
  if (candidate.text && candidate.text !== candidate.name) affordance.text = candidate.text;
  if (candidate.landmark) affordance.landmark = candidate.landmark;
  if (candidate.href) affordance.href = candidate.href;
  if (candidate.disabled) affordance.disabled = true;
  if (candidate.state) affordance.state = candidate.state;
  return affordance;
}

function describe(element: Element): Candidate {
  const name = safeAccessibleName(element);
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const href = element instanceof HTMLAnchorElement ? element.getAttribute('href') ?? undefined : undefined;
  return {
    element,
    role: roleOf(element),
    name,
    text: text || undefined,
    landmark: landmarkOf(element),
    href,
    visible: isVisible(element),
    disabled: isDisabled(element),
    state: stateOf(element),
  };
}

/**
 * Whether the control is already doing the thing it offers. A tab that is
 * showing its panel and a menu that is already open are not steps, and without
 * this the plan cheerfully tells the user to click something already active.
 */
export function stateOf(element: Element): string | undefined {
  const states: string[] = [];
  if (element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-current') === 'page') {
    states.push('selected');
  }
  if (element.getAttribute('aria-expanded') === 'true') states.push('expanded');
  const checked = element.getAttribute('aria-checked') ?? (isChecked(element) ? 'true' : null);
  if (checked === 'true') states.push('checked');
  return states.length ? states.join(', ') : undefined;
}

function isChecked(element: Element): boolean {
  return element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')
    ? element.checked
    : false;
}

function safeAccessibleName(element: Element): string {
  try {
    const name = computeAccessibleName(element).replace(/\s+/g, ' ').trim();
    if (name) return name;
  } catch {
    // dom-accessibility-api throws on exotic nodes; fall through to the label.
  }
  const fallback =
    element.getAttribute('aria-label') ??
    element.getAttribute('title') ??
    element.getAttribute('placeholder') ??
    element.getAttribute('value') ??
    element.textContent ??
    '';
  return fallback.replace(/\s+/g, ' ').trim().slice(0, 120);
}

const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  button: 'button',
  submit: 'button',
  reset: 'button',
  search: 'searchbox',
  email: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  number: 'spinbutton',
  password: 'textbox',
  text: 'textbox',
};

export function roleOf(element: Element): string {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit.trim().split(/\s+/)[0];
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return element.hasAttribute('href') ? 'link' : 'generic';
    case 'button':
      return 'button';
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'summary':
      return 'button';
    case 'input': {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase();
      return INPUT_ROLES[type] ?? 'textbox';
    }
    default:
      return element.getAttribute('contenteditable') !== null ? 'textbox' : 'button';
  }
}

const LANDMARK_TAGS: Record<string, string> = {
  nav: 'sidebar',
  header: 'header',
  main: 'main',
  aside: 'sidebar',
  footer: 'footer',
  dialog: 'dialog',
  form: 'form',
};

const LANDMARK_ROLES: Record<string, string> = {
  navigation: 'sidebar',
  banner: 'header',
  main: 'main',
  complementary: 'sidebar',
  contentinfo: 'footer',
  dialog: 'dialog',
  alertdialog: 'dialog',
  menu: 'menu',
  form: 'form',
  search: 'search',
};

export function landmarkOf(element: Element): string | undefined {
  let node: Element | null = element;
  while (node && node !== node.ownerDocument?.body) {
    const role = node.getAttribute('role');
    if (role && LANDMARK_ROLES[role]) return LANDMARK_ROLES[role];
    const tag = node.tagName.toLowerCase();
    if (LANDMARK_TAGS[tag]) return LANDMARK_TAGS[tag];
    const label = node.getAttribute('aria-label');
    if (label && node.hasAttribute('data-region')) return label.toLowerCase();
    node = node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null;
  }
  return undefined;
}

function isDisabled(element: Element): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return true;
  return 'disabled' in element && Boolean((element as HTMLButtonElement).disabled);
}

/**
 * Visible means: rendered, has a box, not hidden from assistive technology, and
 * actually on screen and clickable. jsdom has no layout, so the geometry checks
 * are skipped there and only the semantic ones apply.
 */
export function isVisible(element: Element): boolean {
  if (element.closest('[aria-hidden="true"],[hidden],[inert]')) return false;

  const view = element.ownerDocument?.defaultView;
  const style = view?.getComputedStyle(element);
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.opacity === '0') return false;
  }

  const rect = element.getBoundingClientRect();
  const hasLayout = typeof view?.innerWidth === 'number' && rect.width + rect.height > 0;
  if (!hasLayout) return isRenderedWithoutLayout(element);

  if (rect.width === 0 || rect.height === 0) return false;
  const viewportWidth = view?.innerWidth ?? 0;
  const viewportHeight = view?.innerHeight ?? 0;
  if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth) return false;

  return hitTest(element, rect, viewportWidth, viewportHeight);
}

/** jsdom reports no geometry at all, so fall back to the cascade only. */
function isRenderedWithoutLayout(element: Element): boolean {
  let node: Element | null = element;
  const view = element.ownerDocument?.defaultView;
  while (node) {
    const style = view?.getComputedStyle(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    node = node.parentElement;
  }
  return true;
}

function hitTest(element: Element, rect: DOMRect, viewportWidth: number, viewportHeight: number): boolean {
  const doc = element.ownerDocument;
  if (!doc || typeof doc.elementFromPoint !== 'function') return true;
  const x = Math.min(Math.max(rect.left + rect.width / 2, 1), viewportWidth - 1);
  const y = Math.min(Math.max(rect.top + rect.height / 2, 1), viewportHeight - 1);
  const hit = deepElementFromPoint(doc, x, y);
  if (!hit) return false;
  return hit === element || element.contains(hit) || hit.contains(element);
}

function deepElementFromPoint(doc: Document, x: number, y: number): Element | null {
  let hit = doc.elementFromPoint(x, y);
  while (hit) {
    const shadow = (hit as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (!shadow) return hit;
    const inner = shadow.elementFromPoint?.(x, y);
    if (!inner || inner === hit) return hit;
    hit = inner;
  }
  return hit;
}
