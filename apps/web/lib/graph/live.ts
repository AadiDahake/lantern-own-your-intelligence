/**
 * The page in front of the visitor, as part of the map for the length of one turn.
 *
 * The product map is what a route is planned over, so until a page is on it, a control the
 * visitor can see is a control the agent cannot point at. That is a race the visitor always
 * loses: the map is written at the start of the turn but read beside it, it is cached for a few
 * seconds per process, and a page from another origin is never written at all
 * (`lib/graph/origin.ts`). The button that shipped this morning was on screen and unmentionable.
 *
 * So the turn plans over the stored map with the live page merged into it, in memory and for that
 * turn only. Nothing here writes: what a scan is allowed to teach the map is still decided by
 * `belongsToSite`, and a control that arrived this way carries a `live:` id so it is never
 * mistaken for a stored row.
 */
import { routeOf } from "@lantern/shared";
import type { PageContext } from "@lantern/shared";
import { controlRows, type StoredControl, type StoredGraph, type StoredPage } from "./store";

/** Where a control that is only on the page in front of the visitor gets its id from. */
export const LIVE_CONTROL_PREFIX = "live:";

/**
 * The project's map with the controls of this page in it. Anything the map already holds is kept
 * exactly as it is stored, so a route's counts, titles and transitions are still the map's.
 */
export function mapWithCurrentPage(graph: StoredGraph, page: PageContext): StoredGraph {
  const route = routeOf(page.url);
  const held = new Set(graph.controls.filter((control) => control.route === route).map((control) => control.key));
  const seen = new Date().toISOString();

  const added: StoredControl[] = [];
  for (const row of controlRows(page)) {
    if (held.has(row.key)) continue;
    const control: StoredControl = {
      id: `${LIVE_CONTROL_PREFIX}${route}\n${row.key}`,
      route,
      key: row.key,
      role: row.role,
      name: row.name,
      visible: row.visible,
      seenCount: 1,
      lastSeen: seen,
    };
    if (row.landmark) control.landmark = row.landmark;
    if (row.href) control.href = row.href;
    added.push(control);
  }

  const known = graph.pages.some((stored) => stored.route === route);
  if (added.length === 0 && known) return graph;

  const here: StoredPage = {
    route,
    url: page.url,
    title: page.title,
    source: "widget",
    firstSeen: seen,
    lastSeen: seen,
  };
  return {
    pages: known ? graph.pages : [...graph.pages, here],
    controls: added.length === 0 ? graph.controls : [...graph.controls, ...added],
    transitions: graph.transitions,
  };
}
