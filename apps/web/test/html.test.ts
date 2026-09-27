import { describe, expect, it } from "vitest";
import { decodeEntities, htmlTitle, htmlToText, sameOriginLinks } from "@/lib/ingest/html";

describe("decodeEntities", () => {
  it("resolves named, decimal and hexadecimal entities", () => {
    expect(decodeEntities("a &amp; b &#65; c &#x42;")).toBe("a & b A c B");
  });

  it("leaves an unknown entity as it is", () => {
    expect(decodeEntities("&notreal; stays")).toBe("&notreal; stays");
  });
});

describe("htmlToText", () => {
  it("keeps headings as markdown at their own level", () => {
    const text = htmlToText("<h1>Profile</h1><p>Body text.</p><h2>Email</h2><p>More.</p>");
    expect(text).toContain("# Profile");
    expect(text).toContain("## Email");
    expect(text).toContain("Body text.");
  });

  it("drops scripts, styles and page chrome", () => {
    const text = htmlToText(
      "<nav><a href='/x'>Menu</a></nav><script>var secret = 1;</script>" +
        "<style>body{color:red}</style><main><p>Real content.</p></main><footer>Legal</footer>",
    );
    expect(text).toBe("Real content.");
  });

  it("turns list items into dashes", () => {
    const text = htmlToText("<ul><li>One</li><li>Two</li></ul>");
    expect(text).toBe("- One\n\n- Two");
  });

  it("turns table rows into pipe rows", () => {
    const text = htmlToText("<table><tr><td>Plan</td><td>Price</td></tr></table>");
    expect(text).toContain("| Plan | Price |");
  });

  it("decodes entities and collapses whitespace", () => {
    const text = htmlToText("<p>Tom &amp;   Jerry\n\n\n\n   spaced</p>");
    expect(text).toBe("Tom & Jerry\n\nspaced");
  });

  it("strips inline markup inside a heading", () => {
    expect(htmlToText("<h3>Api <em>keys</em></h3>")).toBe("### Api keys");
  });

  it("returns an empty string for markup with no text", () => {
    expect(htmlToText("<div><span></span></div>")).toBe("");
  });
});

describe("htmlTitle", () => {
  it("prefers the first h1", () => {
    expect(htmlTitle("<title>Site</title><h1>Page name</h1>")).toBe("Page name");
  });

  it("falls back to the title element", () => {
    expect(htmlTitle("<title>Site &amp; docs</title><p>no heading</p>")).toBe("Site & docs");
  });

  it("returns null when there is neither", () => {
    expect(htmlTitle("<p>nothing</p>")).toBeNull();
  });
});

describe("sameOriginLinks", () => {
  const root = "https://docs.example.com/guide";

  it("resolves relative links against the page they were found on", () => {
    const links = sameOriginLinks(
      '<a href="two">Two</a><a href="/guide/three">Three</a>',
      "https://docs.example.com/guide/one",
      root,
    );
    expect(links).toEqual([
      "https://docs.example.com/guide/two",
      "https://docs.example.com/guide/three",
    ]);
  });

  it("refuses other origins, other sections, assets and non-page schemes", () => {
    const links = sameOriginLinks(
      [
        '<a href="https://elsewhere.com/guide/x">off site</a>',
        '<a href="/blog/post">off path</a>',
        '<a href="/guide/logo.png">asset</a>',
        '<a href="mailto:someone@example.com">mail</a>',
        '<a href="#section">anchor</a>',
      ].join(""),
      root,
      root,
    );
    expect(links).toEqual([]);
  });

  it("drops the fragment and reports each address once", () => {
    const links = sameOriginLinks(
      '<a href="/guide/x#a">a</a><a href="/guide/x#b">b</a>',
      root,
      root,
    );
    expect(links).toEqual(["https://docs.example.com/guide/x"]);
  });

  it("reads single-quoted and unquoted href attributes", () => {
    const links = sameOriginLinks(
      "<a class='c' href='/guide/one'>one</a><a href=/guide/two>two</a>",
      root,
      root,
    );
    expect(links).toEqual([
      "https://docs.example.com/guide/one",
      "https://docs.example.com/guide/two",
    ]);
  });
});
