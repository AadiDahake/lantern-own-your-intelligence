/**
 * The shapes ingestion passes between its stages, and the shapes the console reads back.
 *
 * Every source ends up as the same thing: pages of blocks. A PDF gets its pages from the reader,
 * a crawled site gets one page per address, a written note gets one page. Everything downstream
 * (chunking, previewing, the confidence tint) only ever sees this.
 */

/** One region of a page: a heading, a paragraph, a table. */
export type IngestBlock = {
  /** What the region is: "title", "text", "table". Stored on the chunk it produced. */
  type: string;
  /** The region's own markdown. */
  content: string;
  /** How well the region was read, 0 to 1. Null when the text was never scanned. */
  confidence: number | null;
};

export type IngestPage = {
  /** 1-based, in reading order. */
  page: number;
  /** Where this page came from: an address for a crawl, null for a local file. */
  sourceRef: string | null;
  /** The whole page as markdown, kept so the console can show what was read. */
  markdown: string;
  /** Mean confidence over the page's blocks. Null when the text was never scanned. */
  confidence: number | null;
  blocks: IngestBlock[];
};

export type SourceKind = "upload" | "url" | "text";

/** A source parsed into pages, ready to chunk. */
export type ParsedSource = {
  title: string;
  kind: SourceKind;
  /** The filename or the address. */
  sourceRef: string | null;
  mime: string | null;
  pages: IngestPage[];
  /** Kept on the row so a written note can be re-indexed without the original upload. */
  sourceText: string | null;
  /** True when the pages came out of the reader rather than out of plain text. */
  scanned: boolean;
  /** The uploaded file itself, kept so the console can show it next to what was read. */
  original: File | null;
};

/** A chunk before it has an embedding and an ordinal. */
export type ChunkDraft = {
  heading: string | null;
  content: string;
  page: number | null;
  blockType: string | null;
  confidence: number | null;
  sourceRef: string | null;
};

/** A document row as every console surface consumes it. */
export type ConsoleDocument = {
  id: string;
  title: string;
  sourceKind: string;
  sourceRef: string | null;
  mime: string | null;
  status: string;
  pageCount: number | null;
  meanConfidence: number | null;
  chunkCount: number;
  error: string | null;
  createdAt: string;
  /** Object key of the stored original, when the source arrived as a file. */
  storagePath: string | null;
};

/** One passage the retriever would hand the agent, as the "Test a question" box shows it. */
export type SearchMatch = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  heading: string | null;
  content: string;
  page: number | null;
  confidence: number | null;
  similarity: number;
};
