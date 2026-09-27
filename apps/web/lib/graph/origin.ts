/**
 * Which pages a project's product map is allowed to learn from.
 *
 * The map is what the planner routes over, so a control that is on it is a control the agent will
 * tell a visitor to press. A preview deployment of an unmerged branch serves the same product on a
 * different origin, and the widget on it scans pages whose controls the live site has not got. One
 * visit to such a page is enough to teach the map a capability that does not exist, and the next
 * visitor on the live site is walked to a button that is not there.
 *
 * So the site the project names is the only site it learns from. A page from anywhere else still
 * answers the question in front of it - the turn reads its live controls - but nothing about it is
 * written down.
 */

/** The origin of a URL, or null when it is not a URL at all. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Whether a scanned page belongs to the site this project is bound to.
 *
 * A project with no `site_url` has not said where it lives yet, so every scan is taken: that is
 * how a map gets started. Once it has one, only that origin is believed.
 */
export function belongsToSite(siteUrl: string | null | undefined, pageUrl: string): boolean {
  const site = siteUrl ? originOf(siteUrl) : null;
  if (!site) return true;
  return originOf(pageUrl) === site;
}
