/**
 * The page as the planner sees it: its route, the controls the user can see and reach right now,
 * and the ones that are already active, all keyed by stable identity.
 */
import { controlKey, controlRefOf, routeOf } from "@lantern/shared";
import type { CurrentPage, PageContext } from "@lantern/shared";

export function currentPageOf(page: PageContext): CurrentPage {
  const visibleKeys = new Set<string>();
  const activeKeys = new Set<string>();
  for (const affordance of page.affordances) {
    const key = controlKey(controlRefOf(affordance, page.url));
    if (affordance.visible) visibleKeys.add(key);
    if (affordance.state?.includes("selected") || affordance.state?.includes("expanded")) activeKeys.add(key);
  }
  return { route: routeOf(page.url), visibleKeys, activeKeys };
}
