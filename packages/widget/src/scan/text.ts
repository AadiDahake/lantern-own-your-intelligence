/**
 * The page's own words, as the visitor sees them.
 *
 * A question the page already answers ("what time does my flight leave?") is answered from the
 * page, not from the documentation, so the scan sends what the page says beside the controls it
 * found. Only what is rendered counts: a hidden panel, a script and the widget's own shadow host
 * are all skipped, and the whole thing is bounded so a long page cannot fill a prompt.
 */

/** Elements whose text is never page text. */
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS']);

/** Enough for a trip, a fare and a passenger list; short enough to stay a page and not a book. */
export const MAX_PAGE_TEXT = 2000;

function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return true;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  try {
    const style = view.getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden';
  } catch {
    return false;
  }
}

/**
 * The rendered text under `root`, whitespace collapsed, at most `limit` characters.
 *
 * `exclude` is the widget's own host element, which is on the page but is not part of it.
 */
export function visibleText(root: Element | null, exclude: Element | null = null, limit = MAX_PAGE_TEXT): string {
  if (!root) return '';
  const parts: string[] = [];
  let length = 0;

  const walk = (node: Node): void => {
    if (length >= limit) return;
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      parts.push(text);
      length += text.length + 1;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element === exclude || SKIP.has(element.tagName) || isHidden(element)) return;
    for (const child of Array.from(element.childNodes)) walk(child);
  };

  walk(root);
  return parts.join(' ').slice(0, limit);
}
