/**
 * Host pages are single page apps: the URL changes without a document load and
 * the DOM is replaced under the guide. This module turns both into one callback.
 */

type Unsubscribe = () => void;

let patched = false;
const urlListeners = new Set<() => void>();

/** Patches history once per page, however many guides run. */
function ensureHistoryPatch(): void {
  if (patched || typeof history === 'undefined') return;
  patched = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function patchedHistoryMethod(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      for (const listener of urlListeners) listener();
      return result;
    };
  }
}

/** Fires whenever the host navigates without a document load. */
export function onNavigate(callback: () => void): Unsubscribe {
  ensureHistoryPatch();
  let lastUrl = location.href;
  const handler = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    callback();
  };
  urlListeners.add(handler);
  addEventListener('popstate', handler);
  addEventListener('hashchange', handler);
  return () => {
    urlListeners.delete(handler);
    removeEventListener('popstate', handler);
    removeEventListener('hashchange', handler);
  };
}

/**
 * Fires once the DOM has stopped changing for `settleMs`. Re-scanning mid-render
 * is what makes guidance point at controls that are about to be replaced.
 */
export function onDomSettle(callback: () => void, settleMs = 300, target: Node = document.body): Unsubscribe {
  if (typeof MutationObserver === 'undefined') return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(callback, settleMs);
  });
  observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
  return () => {
    if (timer) clearTimeout(timer);
    observer.disconnect();
  };
}

/**
 * Resolves once the DOM has been quiet for `quietMs`, or after `maxMs` whichever
 * comes first. A dialog that opens on a click renders over several frames, so a
 * scan taken the instant the click lands misses the fields inside it.
 */
export function domSettled(quietMs = 300, maxMs = 1500, target: Node | null = document.body): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let cap: ReturnType<typeof setTimeout> | undefined;
    const observer =
      typeof MutationObserver === 'undefined' || !target ? null : new MutationObserver(() => restart());

    const finish = () => {
      if (done) return;
      done = true;
      if (quiet) clearTimeout(quiet);
      if (cap) clearTimeout(cap);
      observer?.disconnect();
      resolve();
    };
    const restart = () => {
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(finish, quietMs);
    };

    if (observer && target) {
      observer.observe(target, { childList: true, subtree: true, attributes: true });
      cap = setTimeout(finish, maxMs);
    }
    restart();
  });
}

/** Both signals, one callback, already debounced. */
export function watchPage(callback: () => void, settleMs = 300): Unsubscribe {
  const stopNav = onNavigate(() => setTimeout(callback, settleMs));
  const stopDom = onDomSettle(callback, settleMs);
  return () => {
    stopNav();
    stopDom();
  };
}
