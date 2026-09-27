/**
 * Turning parsed pages into the passages the retriever searches.
 *
 * Two rules shape every chunk. A chunk never spans a heading, so a passage is always about one
 * thing. And a chunk repeats its heading, so a passage retrieved on its own still says what it
 * belongs to.
 */
import type { ChunkDraft, IngestBlock, IngestPage } from "./types";

/** Target size of a chunk, in tokens. */
export const WINDOW_TOKENS = 700;
/** How much of the previous window each new window repeats, so an answer never straddles a cut. */
export const OVERLAP_TOKENS = 80;

/** English prose runs at roughly four characters to the token. Close enough to size a window. */
const CHARS_PER_TOKEN = 4;

function tokensForChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** Rough token count for a piece of text. */
export function estimateTokens(text: string): number {
  return tokensForChars(text.length);
}

/** The characters a word contributes to a window, including the space before the next one. */
function wordChars(word: string): number {
  return word.length + 1;
}

/** The heading this block introduces, or null when it is body text. */
export function headingOf(block: IngestBlock): string | null {
  const hashes = /^\s*#{1,6}\s+(.+?)\s*$/.exec(block.content);
  if (hashes) return hashes[1] as string;
  if (block.type === "title" || block.type === "section-header") {
    const text = block.content.trim();
    return text === "" ? null : text;
  }
  return null;
}

/**
 * Splits text into windows of about `windowTokens`, each repeating the last `overlapTokens` of the
 * one before it. Text that already fits comes back untouched, which keeps most chunks verbatim.
 */
export function windowText(
  text: string,
  windowTokens: number = WINDOW_TOKENS,
  overlapTokens: number = OVERLAP_TOKENS,
): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (estimateTokens(trimmed) <= windowTokens) return [trimmed];

  const words = trimmed.split(/\s+/);
  const windows: string[] = [];
  let start = 0;

  while (start < words.length) {
    let end = start;
    let chars = 0;
    while (end < words.length && tokensForChars(chars) < windowTokens) {
      chars += wordChars(words[end] as string);
      end += 1;
    }
    windows.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;

    // Step back far enough that the next window opens with the tail of this one.
    let back = end;
    let backChars = 0;
    while (back > start + 1 && tokensForChars(backChars) < overlapTokens) {
      back -= 1;
      backChars += wordChars(words[back] as string);
    }
    start = back;
  }

  return windows;
}

type Section = {
  heading: string | null;
  blocks: IngestBlock[];
};

/** Groups a page's blocks into one section per heading. */
export function sectionsOf(blocks: IngestBlock[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: null, blocks: [] };

  for (const block of blocks) {
    if (block.content.trim() === "") continue;
    const heading = headingOf(block);
    if (heading !== null) {
      if (current.blocks.length > 0) sections.push(current);
      current = { heading, blocks: [] };
      continue;
    }
    current.blocks.push(block);
  }

  if (current.blocks.length > 0) sections.push(current);
  return sections;
}

function meanConfidence(blocks: IngestBlock[]): number | null {
  const scores = blocks
    .map((block) => block.confidence)
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return null;
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

/** The type most of a section's text carries, used to label the chunk it produces. */
function dominantType(blocks: IngestBlock[]): string | null {
  const counts = new Map<string, number>();
  for (const block of blocks) counts.set(block.type, (counts.get(block.type) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

/** Every chunk one page produces, in reading order. */
export function chunkPage(page: IngestPage): ChunkDraft[] {
  return sectionsOf(page.blocks).flatMap((section) => {
    const body = section.blocks
      .map((block) => block.content.trim())
      .filter(Boolean)
      .join("\n\n");
    const confidence = meanConfidence(section.blocks);
    const blockType = dominantType(section.blocks);

    return windowText(body).map((window) => ({
      heading: section.heading,
      // The heading is repeated inside the chunk because retrieval returns the chunk alone.
      content: section.heading === null ? window : `${section.heading}\n\n${window}`,
      page: page.page,
      blockType,
      confidence,
      sourceRef: page.sourceRef,
    }));
  });
}

/** Every chunk a source produces, in reading order across its pages. */
export function chunkPages(pages: IngestPage[]): ChunkDraft[] {
  return pages.flatMap(chunkPage);
}
