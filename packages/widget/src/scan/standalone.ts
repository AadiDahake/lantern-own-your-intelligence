/**
 * The scanner on its own, for the explorer.
 *
 * The explorer drives a headless browser over the host site and needs to read each page exactly
 * the way the widget does, so this entry builds the same scanner into a script the explorer
 * injects. It hangs two functions off `window`: one scans, one presses a control by the id the
 * last scan gave it. Nothing else of the widget is included.
 */
import { scanAffordances, type ScanResult } from './affordances';
import type { PageContext } from '../types';

type LanternScanner = {
  scan: (question?: string) => PageContext;
  press: (id: string) => boolean;
};

declare global {
  interface Window {
    __lanternScanner?: LanternScanner;
  }
}

let last: ScanResult | null = null;

function scan(question = ''): PageContext {
  // A site being explored may have the widget on it; the widget's own controls are not the product.
  const widget = document.querySelector('lantern-widget');
  last = scanAffordances({ question, limit: 400, exclude: widget });
  return last.page;
}

/** Presses the control the last scan reported under `id`. False when there is no such control. */
function press(id: string): boolean {
  const element = last?.lookup.get(id);
  if (!(element instanceof HTMLElement)) return false;
  element.scrollIntoView({ block: 'center', inline: 'center' });
  element.focus();
  element.click();
  return true;
}

window.__lanternScanner = { scan, press };
