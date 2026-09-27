/**
 * Whether a control can be pointed at.
 *
 * A node that was removed from the document still answers `getBoundingClientRect`
 * with zeros, and so does a control that has not been laid out yet. Anchoring a
 * caption to either one puts it in the top-left corner of the screen, which is
 * how a broken step looks to the user, so every binding goes through here first.
 */

/** True when the document lays out at all. Test environments have no layout engine. */
export function hasLayout(doc: Document = document): boolean {
  const rect = doc.documentElement?.getBoundingClientRect();
  return Boolean(rect && rect.width + rect.height > 0);
}

/**
 * A rect the spotlight can draw around: non-empty and at least partly on screen.
 * Without a layout engine every rect is empty, so the check stands down instead
 * of rejecting every element.
 */
export function isPointable(element: Element | null | undefined): boolean {
  if (!element || !element.isConnected) return false;
  const doc = element.ownerDocument;
  if (!doc || !hasLayout(doc)) return true;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const view = doc.defaultView;
  const width = view?.innerWidth ?? 0;
  const height = view?.innerHeight ?? 0;
  // A control below the fold is fine: the spotlight scrolls to it. A control
  // parked outside the document is not.
  return rect.bottom > -height && rect.right > -width && rect.top < height * 2 && rect.left < width * 2;
}
