/**
 * The user's own moves, reported to the site graph.
 *
 * The widget never drives the page, but it watches it: a press on a control followed by a new
 * address is one transition the product has, discovered by the person using it. The press is
 * kept in session storage so a full page load does not lose it, and the report waits for the
 * new page to settle so the scan describes what the user actually reached.
 */
import { controlKey, controlRefOf, routeOf } from '@lantern/shared';
import type { ApiClient, ObservedTransition } from '../api/client';
import { INTERACTIVE_SELECTOR, describeElement, scanAffordances, type ScanResult } from '../scan/affordances';
import { domSettled, onNavigate } from './navigation';

const PRESS_KEY = 'lantern:press';
const SEEN_KEY = 'lantern:seen';
/** A press older than this did not lead here. */
const PRESS_TTL_MS = 10_000;
const SETTLE_MS = 400;
/** How long a new address may take to render its page before the report is given up. */
const ARRIVAL_MS = 8000;
const ARRIVAL_POLL_MS = 150;

/** What a page reads as: its title and the identity of every control on it. */
function signatureOf(scan: ScanResult): string {
  const keys = scan.page.affordances.map((affordance) => controlKey(controlRefOf(affordance, scan.page.url)));
  return `${scan.page.title}\n${keys.sort().join('\n')}`;
}

type Press = ObservedTransition & { at: number };

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage can be blocked. The graph then only learns from this page load.
  }
}

function loadPress(): Press | null {
  const raw = read(PRESS_KEY);
  if (!raw) return null;
  try {
    const press = JSON.parse(raw) as Press;
    if (typeof press.fromUrl !== 'string' || typeof press.at !== 'number') return null;
    return press;
  } catch {
    return null;
  }
}

/** The routes and moves already reported in this session, so a page is described once. */
function loadSeen(): Set<string> {
  const raw = read(SEEN_KEY);
  if (!raw) return new Set();
  try {
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : []);
  } catch {
    return new Set();
  }
}

export type TransitionWatcher = { dispose: () => void };

/** Starts watching the host page. Returns a handle that stops it. */
export function watchTransitions(client: ApiClient, host: Element | null): TransitionWatcher {
  const seen = loadSeen();
  let disposed = false;

  const remember = (entry: string) => {
    seen.add(entry);
    write(SEEN_KEY, JSON.stringify([...seen]));
  };

  /**
   * The page the user reached, once it is really there. A host pushes its address before it
   * renders, so the scan waits until the page no longer reads as the one the user left; a page
   * that never changes is not reported, because its controls would be filed under the wrong route.
   */
  const arrive = async (leftSignature: string | null): Promise<ScanResult | null> => {
    const deadline = Date.now() + ARRIVAL_MS;
    for (;;) {
      await domSettled(SETTLE_MS, 2000, document.body);
      if (disposed) return null;
      const scan = scanAffordances({ exclude: host });
      if (leftSignature === null || signatureOf(scan) !== leftSignature) return scan;
      if (Date.now() > deadline) return null;
      await new Promise((done) => setTimeout(done, ARRIVAL_POLL_MS));
    }
  };

  const report = async (transition: ObservedTransition | undefined, leftSignature: string | null) => {
    const scan = await arrive(leftSignature);
    if (!scan) return;
    const { page } = scan;
    const route = routeOf(page.url);
    const firstVisit = !seen.has(`page|${route}`);
    let move: ObservedTransition | undefined;
    if (transition && routeOf(transition.fromUrl) !== route) {
      const edge = `move|${routeOf(transition.fromUrl)}|${transition.control.role}|${transition.control.name.toLowerCase()}|${route}`;
      if (!seen.has(edge)) {
        move = transition;
        remember(edge);
      }
    }
    if (!firstVisit && !move) return;
    if (firstVisit) remember(`page|${route}`);
    await client.observe(move ? { page, transition: move } : { page });
  };

  const onPress = (event: Event) => {
    const node = event.target instanceof Element ? event.target : null;
    if (!node || (host && host.contains(node))) return;
    if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Enter') return;
    const control = node.closest(INTERACTIVE_SELECTOR);
    if (!control) return;
    const described = describeElement(control);
    if (!described.name.trim()) return;
    const press: Press = {
      fromUrl: location.href,
      fromTitle: document.title,
      control: controlRefOf(described, location.href),
      at: Date.now(),
    };
    write(PRESS_KEY, JSON.stringify(press));
  };

  document.addEventListener('pointerdown', onPress, true);
  document.addEventListener('keydown', onPress, true);

  /** The press that led to the address the page is at now, if there was one and it is fresh. */
  const takePress = (): ObservedTransition | undefined => {
    const press = loadPress();
    if (!press) return undefined;
    write(PRESS_KEY, null);
    if (Date.now() - press.at > PRESS_TTL_MS) return undefined;
    if (press.fromUrl === location.href) return undefined;
    return { fromUrl: press.fromUrl, fromTitle: press.fromTitle, control: press.control };
  };

  // The page as it read before the address changed, so the next one is known to be new.
  let leftSignature = signatureOf(scanAffordances({ exclude: host }));
  const stopNav = onNavigate(() => {
    const left = leftSignature;
    void report(takePress(), left)
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) leftSignature = signatureOf(scanAffordances({ exclude: host }));
      });
  });

  // A full page load: the press that brought the user here is still in storage.
  void report(takePress(), null).catch(() => undefined);

  return {
    dispose: () => {
      disposed = true;
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('keydown', onPress, true);
      stopNav();
    },
  };
}
