/**
 * Reading a site.
 *
 * One address is what a person has; a documentation site is what they mean. So the crawl starts
 * at the address they gave and follows a bounded number of links below it, and every page it
 * reads becomes its own page of the one document.
 */
import { htmlToText, htmlTitle, sameOriginLinks } from "./html";
import { markdownPage } from "./markdown";
import type { IngestPage } from "./types";

/** Nothing larger is documentation, and a route handler should not buffer more than this. */
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
/** How many further pages one address may pull in. */
export const MAX_FOLLOWED_LINKS = 12;

const USER_AGENT = "Lantern knowledge ingestion";

/** Fetches one page as text, giving up on a slow server and on anything oversized. */
export async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (failure) {
    clearTimeout(timer);
    // `fetch failed` tells the person nothing; say which address, and whether it was slow or wrong.
    const reason = controller.signal.aborted
      ? `did not answer within ${TIMEOUT_MS / 1000} seconds`
      : "could not be reached";
    throw new Error(`${url} ${reason}.`, { cause: failure });
  }

  try {
    if (!response.ok) throw new Error(`${url} answered ${response.status}.`);

    const type = response.headers.get("content-type") ?? "";
    if (type !== "" && !/text\/|application\/(xhtml|xml|json)/i.test(type)) {
      throw new Error(`${url} is ${type.split(";")[0]}, which is not a readable page.`);
    }
    return await readCapped(response);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a body up to the cap and stops there rather than buffering the whole thing. */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;

  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

/** One crawled address, already converted to text. */
export type CrawledPage = { url: string; title: string | null; text: string };

/**
 * Reads the given address, then up to `MAX_FOLLOWED_LINKS` more pages linked from it. A link that
 * fails is skipped: one broken page in a documentation site should not lose the other twelve.
 */
export async function crawl(startUrl: string): Promise<CrawledPage[]> {
  const start = new URL(startUrl);
  const rootHtml = await fetchPage(start.toString());
  const pages: CrawledPage[] = [
    { url: start.toString(), title: htmlTitle(rootHtml), text: htmlToText(rootHtml) },
  ];

  const seen = new Set([start.toString()]);
  const queue = sameOriginLinks(rootHtml, start.toString(), start.toString()).filter(
    (link) => !seen.has(link),
  );

  while (queue.length > 0 && pages.length <= MAX_FOLLOWED_LINKS) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    try {
      const html = await fetchPage(next);
      pages.push({ url: next, title: htmlTitle(html), text: htmlToText(html) });
    } catch {
      // A page that will not load is simply not part of the knowledge base.
    }
  }

  return pages;
}

/** Turns crawled pages into ingestion pages, one page per address. */
export function crawledToPages(pages: CrawledPage[]): IngestPage[] {
  return pages
    .filter((page) => page.text.trim() !== "")
    .map((page, index) =>
      // The page's own name is the heading its first chunks hang from.
      markdownPage(index + 1, page.url, page.title ? `# ${page.title}\n\n${page.text}` : page.text),
    );
}
