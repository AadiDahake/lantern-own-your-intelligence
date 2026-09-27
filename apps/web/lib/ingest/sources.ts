/**
 * Everything a person can hand the console, parsed into pages.
 *
 * A file is either scanned or read: pdfs and images go through the document reader, markdown,
 * text and html are parsed here. An address is crawled. A written note is taken as it is.
 */
import { ocr } from "../openai";
import { crawl, crawledToPages } from "./crawl";
import { htmlToText } from "./html";
import { firstHeading, markdownPage } from "./markdown";
import type { IngestPage, ParsedSource } from "./types";

/** File types the reader scans. */
const SCANNED: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** File types parsed as text. */
const WRITTEN: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
};

export const ACCEPTED_EXTENSIONS = [...Object.keys(SCANNED), ...Object.keys(WRITTEN)];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Everything before the extension: the name a person recognises the source by. */
function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot === -1 ? name : name.slice(0, dot)).trim() || name;
}

/** Reads a scanned document into one page per page, keeping every block's confidence. */
async function scan(bytes: Uint8Array, mime: string): Promise<IngestPage[]> {
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  const result = await ocr(dataUrl);

  return result.pages.map((page, index) => ({
    page: (page.index ?? index) + 1,
    sourceRef: null,
    markdown: page.markdown,
    confidence: page.confidence,
    blocks: page.blocks,
  }));
}

/** An uploaded file. Word documents are out of scope and say so rather than failing silently. */
export async function fileSource(file: File): Promise<ParsedSource> {
  const extension = extensionOf(file.name);

  if (extension === "doc" || extension === "docx") {
    throw new Error("Word documents are not supported yet. Export it as a PDF and add that.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("That file is empty.");

  const scannedMime = SCANNED[extension];
  if (scannedMime) {
    const pages = await scan(bytes, scannedMime);
    if (pages.length === 0) throw new Error("The reader found no pages in that file.");
    return {
      title: baseName(file.name),
      kind: "upload",
      sourceRef: file.name,
      mime: scannedMime,
      pages,
      sourceText: null,
      scanned: true,
      original: file,
    };
  }

  const writtenMime = WRITTEN[extension];
  if (!writtenMime) {
    throw new Error(`Lantern cannot read .${extension} files. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}.`);
  }

  const raw = new TextDecoder().decode(bytes);
  const markdown = writtenMime === "text/html" ? htmlToText(raw) : raw;
  if (markdown.trim() === "") throw new Error("That file has no readable text.");

  return {
    title: baseName(file.name),
    kind: "upload",
    sourceRef: file.name,
    mime: writtenMime,
    pages: [markdownPage(1, null, markdown)],
    sourceText: markdown,
    scanned: false,
    original: file,
  };
}

/** An address, and up to a dozen pages linked from it. */
export async function urlSource(rawUrl: string): Promise<ParsedSource> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("That is not a web address. It needs to start with http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https addresses can be read.");
  }

  const crawled = await crawl(url.toString());
  const pages = crawledToPages(crawled);
  if (pages.length === 0) throw new Error(`Nothing readable was found at ${url.toString()}.`);

  const root = crawled[0];
  return {
    title: root?.title ?? url.hostname,
    kind: "url",
    sourceRef: url.toString(),
    mime: "text/html",
    pages,
    // Kept so the page can be shown again without going back to the network.
    sourceText: pages.map((page) => page.markdown).join("\n\n"),
    scanned: false,
    original: null,
  };
}

/** A note somebody typed. */
export function textSource(title: string, text: string): ParsedSource {
  const body = text.trim();
  if (body === "") throw new Error("There is nothing to add. Write the note first.");

  const name = title.trim() || firstHeading(body) || "Untitled note";
  return {
    title: name,
    kind: "text",
    sourceRef: null,
    mime: "text/markdown",
    // The title becomes the note's heading so its chunks carry it the way every other chunk does.
    pages: [markdownPage(1, null, body.startsWith("#") ? body : `# ${name}\n\n${body}`)],
    sourceText: body,
    scanned: false,
    original: null,
  };
}
