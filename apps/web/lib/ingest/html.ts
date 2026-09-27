/**
 * HTML to text, keeping the structure that matters for retrieval.
 *
 * The chunker splits on headings, so the conversion has one job beyond stripping tags: turn
 * `<h1>` to `<h4>` into markdown headings and leave the rest as readable prose. Chrome and a
 * parser are not available in a route handler, so this works on the markup directly, which is
 * also what makes it fast enough to run over a dozen crawled pages inside one request.
 */

/** Elements whose content is chrome or code rather than documentation. */
const DROPPED =
  /<(head|title|script|style|noscript|template|svg|canvas|iframe|nav|footer|header|aside|form|select)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "-",
  ndash: "-",
  hellip: "...",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** Resolves the named and numeric entities that survive tag stripping. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/** Normalises whitespace without touching entities, so nothing is decoded twice. */
function squash(text: string): string {
  return text
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collapse(text: string): string {
  return squash(decodeEntities(text));
}

/** The page's own name: its first `<h1>`, else its `<title>`. */
export function htmlTitle(html: string): string | null {
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  for (const match of [heading, title]) {
    if (!match) continue;
    const text = collapse(stripTags(match[1] as string)).replace(/\n+/g, " ").trim();
    if (text !== "") return text;
  }
  return null;
}

/**
 * The readable text of a page as markdown: headings keep their level, list items become dashes,
 * table rows become pipe rows, everything else becomes paragraphs.
 */
export function htmlToText(html: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, " ").replace(DROPPED, "\n");

  text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_match, level: string, body: string) => {
    const heading = squash(stripTags(body)).replace(/\n+/g, " ").trim();
    return heading === "" ? "\n" : `\n\n${"#".repeat(Number(level))} ${heading}\n\n`;
  });

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<t[hd]\b[^>]*>/gi, " | ")
    .replace(/<\/tr\s*>/gi, " |\n")
    .replace(/<\/(p|div|section|article|ul|ol|li|table|blockquote|pre|h[1-6])\s*>/gi, "\n\n");

  return collapse(stripTags(text));
}

/** Whatever this file extension is, it is not documentation. */
const ASSET = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|zip|gz|pdf|mp4|mov|mp3|woff2?)$/i;

/**
 * The addresses on this page worth following: same origin as where the crawl started, at or below
 * its path, and not an asset. A docs site is one URL to the person adding it, so the crawl has to
 * find the rest of it on its own.
 */
export function sameOriginLinks(html: string, pageUrl: string, rootUrl: string): string[] {
  const root = new URL(rootUrl);
  const prefix = root.pathname.replace(/\/$/, "");
  const found = new Set<string>();

  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const raw = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (raw === "" || /^(mailto:|tel:|javascript:|data:|#)/i.test(raw)) continue;
    let url: URL;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    url.hash = "";
    if (url.origin !== root.origin) continue;
    if (!url.pathname.startsWith(prefix)) continue;
    if (ASSET.test(url.pathname)) continue;
    found.add(url.toString());
  }

  return [...found];
}
