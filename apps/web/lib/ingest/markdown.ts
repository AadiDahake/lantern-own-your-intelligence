/** Markdown and plain text become blocks the same way scanned pages do. */
import type { IngestBlock, IngestPage } from "./types";

const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Splits markdown into one block per heading and one block per paragraph. Headings keep their
 * hashes so the chunker reads them the same way it reads a scanned title block.
 */
export function markdownToBlocks(markdown: string): IngestBlock[] {
  const blocks: IngestBlock[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (text !== "") blocks.push({ type: "text", content: text, confidence: null });
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: "title",
        content: `${heading[1]} ${heading[2]}`,
        confidence: null,
      });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    paragraph.push(line);
  }

  flush();
  return blocks;
}

/** The first heading in a piece of markdown, used to name an otherwise untitled source. */
export function firstHeading(markdown: string): string | null {
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) return heading[2] as string;
  }
  return null;
}

/** Wraps a piece of markdown as one ingestion page. */
export function markdownPage(
  page: number,
  sourceRef: string | null,
  markdown: string,
): IngestPage {
  return { page, sourceRef, markdown, confidence: null, blocks: markdownToBlocks(markdown) };
}
