/**
 * Bring an element fully into view inside its own scroll box.
 *
 * `scrollIntoView` is deliberately not used: it walks every scrollable ancestor, so on the
 * stacked layout it drags the whole page under the sticky bar. This only ever writes
 * `scrollTop` on the box that was passed in, which cannot move anything else.
 */
export function keepInView(box: HTMLElement | null, item: HTMLElement | null): void {
  if (!box || !item) return;

  const boxTop = box.scrollTop;
  const boxBottom = boxTop + box.clientHeight;
  const itemTop = item.offsetTop - box.offsetTop;
  const itemBottom = itemTop + item.offsetHeight;

  if (itemTop < boxTop) {
    box.scrollTop = Math.max(itemTop - 8, 0);
  } else if (itemBottom > boxBottom) {
    box.scrollTop = itemBottom - box.clientHeight + 8;
  }
}
