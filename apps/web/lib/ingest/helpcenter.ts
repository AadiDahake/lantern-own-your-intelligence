/**
 * Importing a site's help center into the knowledge base.
 *
 * The explorer has already found the help pages; this reads each article, keeps only its body,
 * and stores it as its own document with its address, so a passage the retriever finds can be
 * cited by the article it came from. A sitemap is the fallback when the graph has no help pages.
 */
import { routeOf } from "@lantern/shared";
import { loadGraph } from "../graph/store";
import { fetchPage } from "./crawl";
import { htmlTitle, htmlToText } from "./html";
import { markdownPage } from "./markdown";
import { ingestSource, reingestSource } from "./run";
import { serviceClient } from "../supabase";
import type { ConsoleDocument, ParsedSource } from "./types";

/** Routes that are documentation rather than product. */
const HELP_ROUTE = /^\/(help|support|faq|docs|documentation|knowledge|kb|guides?)(\/|$)/i;

const MAX_ARTICLES = 60;

/** Help article addresses: from the graph first, else from the sitemap. Index pages are left out. */
export async function helpPageUrls(projectId: string, siteUrl: string): Promise<string[]> {
  const site = new URL(siteUrl);
  const graph = await loadGraph(projectId);
  const fromGraph = graph.pages
    .filter((page) => HELP_ROUTE.test(page.route))
    .map((page) => page.url)
    .filter((url) => sameOrigin(url, site));
  const urls = fromGraph.length > 0 ? fromGraph : await sitemapUrls(site);
  const articles = dedupe(urls).filter((url) => isArticle(url));
  return articles.slice(0, MAX_ARTICLES);
}

function sameOrigin(url: string, site: URL): boolean {
  try {
    return new URL(url).origin === site.origin;
  } catch {
    return false;
  }
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      url.hash = "";
      url.search = "";
      const key = url.toString().replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    } catch {
      // Not an address.
    }
  }
  return out;
}

/** An article lives below the help index: `/help/how-do-i-change-my-seat`, not `/help`. */
function isArticle(url: string): boolean {
  const route = routeOf(url);
  return HELP_ROUTE.test(route) && route.split("/").filter(Boolean).length >= 2;
}

async function sitemapUrls(site: URL): Promise<string[]> {
  try {
    const xml = await fetchPage(new URL("/sitemap.xml", site).toString());
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
      .map((match) => match[1] as string)
      .filter((url) => HELP_ROUTE.test(routeOf(url)) && sameOrigin(url, site));
  } catch {
    return [];
  }
}

/**
 * The article itself: the `<article>` or `<main>` element when the page has one, so navigation,
 * related links and footers do not become passages the retriever can confuse with the answer.
 */
export function articleHtml(html: string): string {
  const article = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(html);
  if (article) return article[1] as string;
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html);
  return main ? (main[1] as string) : html;
}

/** One help article as a source: its title, its body as markdown, and its address. */
export async function helpArticleSource(url: string): Promise<ParsedSource> {
  const html = await fetchPage(url);
  const title = htmlTitle(html) ?? url;
  const body = htmlToText(articleHtml(html));
  if (body.trim() === "") throw new Error(`Nothing readable at ${url}.`);
  // Every section chunk names its article: a passage retrieved on its own has to say what it is
  // about, and "Checked bags" alone does not say "Baggage allowance".
  const sectioned = body.replace(/^(#{2,6})\s+(.+)$/gm, (_match, hashes: string, heading: string) =>
    heading.toLowerCase().startsWith(title.toLowerCase()) ? `${hashes} ${heading}` : `${hashes} ${title}: ${heading}`,
  );
  // The body already opens with the article's own heading when it has one; give it one otherwise.
  const markdown = /^#\s/.test(sectioned) ? sectioned : `# ${title}\n\n${sectioned}`;
  return {
    title,
    kind: "url",
    sourceRef: url,
    mime: "text/html",
    pages: [markdownPage(1, url, markdown)],
    sourceText: markdown,
    scanned: false,
    original: null,
  };
}

export type HelpImportResult = { documents: ConsoleDocument[]; pages: number; problems: string[] };

/**
 * Imports every help article as its own document. An article already imported from the same
 * address is read again in place, so a second import refreshes rather than duplicates.
 */
export async function importHelpCenter(projectId: string, siteUrl: string): Promise<HelpImportResult> {
  const urls = await helpPageUrls(projectId, siteUrl);
  if (urls.length === 0) {
    throw new Error("No help pages were found. Explore the site first, or add a sitemap.");
  }

  const { data: existing } = await serviceClient()
    .from("document")
    .select("id, source_ref")
    .eq("project_id", projectId)
    .eq("source_kind", "url");
  const byUrl = new Map<string, string>();
  for (const row of (existing ?? []) as { id: string; source_ref: string | null }[]) {
    if (row.source_ref) byUrl.set(row.source_ref.replace(/\/$/, ""), row.id);
  }

  const documents: ConsoleDocument[] = [];
  const problems: string[] = [];
  for (const url of urls) {
    try {
      const source = await helpArticleSource(url);
      const known = byUrl.get(url);
      documents.push(
        known ? await reingestSource(projectId, known, source) : await ingestSource(projectId, source),
      );
    } catch (error) {
      problems.push(`${url}: ${(error as Error).message}`);
    }
  }
  return { documents, pages: urls.length, problems };
}
