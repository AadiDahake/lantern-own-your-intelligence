import { describe, expect, it } from "vitest";
import { articleHtml } from "@/lib/ingest/helpcenter";
import { htmlToText } from "@/lib/ingest/html";

const PAGE = `<html><head><title>How do I change my seat? | NovaAir</title></head><body>
<a href="#main">Skip to main content</a>
<header><nav><a href="/">Home</a></nav></header>
<main><article>
<a href="/help">Help center</a>
<p>Seats</p>
<h1>How do I change my seat?</h1>
<p>Open your trip, go to Seats, and pick a new seat for each passenger.</p>
<section><h2>Change a seat online</h2><ul><li>Select My Booking in the top menu.</li></ul></section>
</article>
<aside><h2>Related articles</h2><a href="/help/seat-selection-fees">Seat selection fees</a></aside>
</main><footer><a href="/help/how-do-i-change-my-seat">Change my seat</a></footer></body></html>`;

describe("articleHtml", () => {
  it("keeps the article and leaves the chrome and the related links behind", () => {
    const text = htmlToText(articleHtml(PAGE));
    expect(text).toContain("# How do I change my seat?");
    expect(text).toContain("## Change a seat online");
    expect(text).toContain("Select My Booking in the top menu.");
    expect(text).not.toContain("Related articles");
    expect(text).not.toContain("Skip to main content");
    expect(text).not.toContain("| NovaAir");
  });

  it("falls back to the whole page when there is no article or main element", () => {
    expect(articleHtml("<p>plain</p>")).toBe("<p>plain</p>");
  });
});

describe("htmlToText", () => {
  it("drops the document title so it never becomes a passage", () => {
    expect(htmlToText(PAGE)).not.toContain("| NovaAir");
  });
});
