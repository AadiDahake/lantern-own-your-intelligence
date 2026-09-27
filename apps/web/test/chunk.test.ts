import { describe, expect, it } from "vitest";
import {
  chunkPages,
  estimateTokens,
  headingOf,
  sectionsOf,
  windowText,
  WINDOW_TOKENS,
} from "@/lib/ingest/chunk";
import type { IngestBlock, IngestPage } from "@/lib/ingest/types";

const block = (type: string, content: string, confidence: number | null = null): IngestBlock => ({
  type,
  content,
  confidence,
});

const page = (blocks: IngestBlock[], overrides: Partial<IngestPage> = {}): IngestPage => ({
  page: 1,
  sourceRef: null,
  markdown: blocks.map((entry) => entry.content).join("\n\n"),
  confidence: null,
  blocks,
  ...overrides,
});

/** A body of prose long enough to need more than one window. */
function longBody(words: number): string {
  return Array.from({ length: words }, (_, index) => `word${index}`).join(" ");
}

describe("headingOf", () => {
  it("reads a markdown heading at any level", () => {
    expect(headingOf(block("text", "## Email address"))).toBe("Email address");
    expect(headingOf(block("text", "#### Deeply nested"))).toBe("Deeply nested");
  });

  it("treats a scanned title block as a heading even without hashes", () => {
    expect(headingOf(block("title", "Profile and account"))).toBe("Profile and account");
  });

  it("leaves body text alone", () => {
    expect(headingOf(block("text", "Open the account menu."))).toBeNull();
    expect(headingOf(block("text", "#hashtag not a heading"))).toBeNull();
  });
});

describe("sectionsOf", () => {
  it("starts a new section at every heading", () => {
    const sections = sectionsOf([
      block("title", "# One"),
      block("text", "First body."),
      block("title", "# Two"),
      block("text", "Second body."),
    ]);
    expect(sections.map((section) => section.heading)).toEqual(["One", "Two"]);
    expect(sections[0]?.blocks).toHaveLength(1);
  });

  it("keeps text that comes before any heading", () => {
    const sections = sectionsOf([block("text", "Preamble."), block("title", "# One")]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBeNull();
  });

  it("drops empty blocks and heading-only sections", () => {
    expect(sectionsOf([block("title", "# Empty"), block("text", "   ")])).toEqual([]);
  });
});

describe("windowText", () => {
  it("returns short text verbatim", () => {
    expect(windowText("Two short lines.\n\nStill short.")).toEqual([
      "Two short lines.\n\nStill short.",
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(windowText("   \n  ")).toEqual([]);
  });

  it("splits long text into windows of about the target size", () => {
    const windows = windowText(longBody(2000));
    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) {
      expect(estimateTokens(window)).toBeLessThanOrEqual(WINDOW_TOKENS + 20);
    }
  });

  it("repeats the tail of each window at the head of the next", () => {
    const [first, second] = windowText(longBody(2000));
    const tail = (first as string).split(" ").slice(-10).join(" ");
    expect(second as string).toContain(tail);
  });

  it("covers every word", () => {
    const words = longBody(1500).split(" ");
    const seen = new Set(windowText(longBody(1500)).join(" ").split(" "));
    for (const word of words) expect(seen.has(word)).toBe(true);
  });

  it("terminates on text made of one very long word", () => {
    const windows = windowText("x".repeat(20_000));
    expect(windows).toHaveLength(1);
  });
});

describe("chunkPages", () => {
  it("prefixes every chunk with its heading", () => {
    const chunks = chunkPages([
      page([block("title", "# Profile and account"), block("text", "Edit the Username field.")]),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe("Profile and account");
    expect(chunks[0]?.content).toBe("Profile and account\n\nEdit the Username field.");
  });

  it("carries the page, the block type and the mean confidence of what it came from", () => {
    const chunks = chunkPages([
      page(
        [
          block("title", "# Billing", 0.9),
          block("text", "Open Settings.", 0.8),
          block("text", "Then Billing.", 0.6),
        ],
        { page: 4, sourceRef: "https://example.com/billing" },
      ),
    ]);
    expect(chunks[0]?.page).toBe(4);
    expect(chunks[0]?.blockType).toBe("text");
    expect(chunks[0]?.confidence).toBeCloseTo(0.7, 5);
    expect(chunks[0]?.sourceRef).toBe("https://example.com/billing");
  });

  it("keeps chunks from separate headings apart", () => {
    const chunks = chunkPages([
      page([
        block("title", "# One"),
        block("text", "About one."),
        block("title", "# Two"),
        block("text", "About two."),
      ]),
    ]);
    expect(chunks.map((chunk) => chunk.heading)).toEqual(["One", "Two"]);
  });

  it("produces several chunks for one long section, each carrying the heading", () => {
    const chunks = chunkPages([
      page([block("title", "# Long"), block("text", longBody(2000))]),
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.content.startsWith("Long\n\n")).toBe(true);
  });

  it("returns nothing for a page with no readable text", () => {
    expect(chunkPages([page([])])).toEqual([]);
  });
});
