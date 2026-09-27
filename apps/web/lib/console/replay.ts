/** The query parameter the widget reads on load to re-ask a question on the customer's site. */
export const ASK_PARAM = "lantern_ask";

/**
 * The "Replay on site" target: the project's own site, with the question the agent solved.
 * Returns null when there is no site or no question, so the caller simply omits the link.
 */
export function replayUrl(siteUrl: string | null, question: string | null): string | null {
  if (!siteUrl || !question) return null;
  try {
    const url = new URL(siteUrl);
    url.searchParams.set(ASK_PARAM, question);
    return url.toString();
  } catch {
    return null;
  }
}
