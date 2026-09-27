/**
 * Whether the visitor was on a call, kept for this browser session only.
 *
 * A call is a deliberate choice, so it should survive a page navigation inside the same visit;
 * it should not greet someone with a live microphone days later, which is why this is
 * sessionStorage and never localStorage.
 */

const KEY = 'lantern:call';

export function rememberCall(active: boolean): void {
  try {
    if (active) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked. The call still works, it just does not survive a navigation.
  }
}

export function wasInCall(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
