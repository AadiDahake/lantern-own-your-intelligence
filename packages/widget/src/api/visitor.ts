/**
 * A stable, anonymous id for this browser.
 *
 * It is a random value, never anything about the person, and it lives only in the host page's
 * localStorage. It exists so the agent can recall what a returning visitor already told it.
 */

const STORAGE_KEY = 'lantern:visitor';

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Reads the id, creating it on the first visit. Falls back to a per-load id in private modes. */
export function visitorId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && /^[0-9a-f]{32}$/.test(stored)) return stored;
    const fresh = randomId();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Storage can be blocked. The turn still works; the agent just starts fresh each load.
    return randomId();
  }
}
