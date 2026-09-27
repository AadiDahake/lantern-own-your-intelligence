/**
 * The company brain: what counts as configured, what a search returns, and what the
 * documentation check does with it. The network is a stub; no test reaches a brain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearerTokenOf, brainWorkspace } from "@/lib/brain/config";
import { searchBrain } from "@/lib/brain/provider";
import { gapPage, helpPage } from "../../../integrations/gbrain/pages";

const WORKSPACE = { url: "https://brain.example.test/mcp", token: "token-for-tests" };

/** Every request the code sent, as the server would see it. */
const requests: { url: string; authorization: string; body: { method: string; params: Record<string, unknown> } }[] = [];
/** What the search tool answers with. */
let rows: unknown = [];
/** Set to make the server fail. */
let status = 200;

const BAGGAGE = {
  slug: "help/baggage-allowance",
  title: "Baggage allowance",
  type: "help-doc",
  chunk_text: "Add a checked bag on the Manage Trip page. Select Bags, then select Add a checked bag.",
  chunk_source: "compiled_truth",
  score: 0.97,
  cosine: 0.71,
  evidence: "keyword_exact",
  source_id: "default",
};

const GAP = {
  slug: "gaps/checked-bag-by-text",
  title: "Known gap: Add a checked bag by text message",
  type: "known-gap",
  chunk_text: "NovaAir does not do this today. Add a checked bag by text message.",
  chunk_source: "compiled_truth",
  score: 1,
  cosine: 0.8,
  evidence: "keyword_exact",
  source_id: "default",
};

beforeEach(() => {
  requests.length = 0;
  rows = [GAP, BAGGAGE];
  status = 200;
  vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string>; body: string }) => {
    requests.push({
      url,
      authorization: init.headers.authorization ?? "",
      body: JSON.parse(init.body) as { method: string; params: Record<string, unknown> },
    });
    const answer = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(rows) }], isError: false } };
    return new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the brain's configuration", () => {
  it("is off unless the address and the token are both set", () => {
    expect(brainWorkspace({})).toBeNull();
    expect(brainWorkspace({ GBRAIN_MCP_URL: WORKSPACE.url })).toBeNull();
    expect(brainWorkspace({ GBRAIN_TOKEN: WORKSPACE.token })).toBeNull();
    expect(brainWorkspace({ GBRAIN_MCP_URL: WORKSPACE.url, GBRAIN_TOKEN: WORKSPACE.token })).toEqual(WORKSPACE);
  });

  it("reads the names the vault uses for the same two values", () => {
    expect(
      brainWorkspace({ gbrain_mcp_url_hackathon: WORKSPACE.url, gbrain_token_hackathon: WORKSPACE.token }),
    ).toEqual(WORKSPACE);
  });

  it("takes the token from any form it is copied around in", () => {
    expect(bearerTokenOf("token-for-tests")).toBe("token-for-tests");
    expect(bearerTokenOf("Bearer token-for-tests")).toBe("token-for-tests");
    expect(bearerTokenOf("Authorization: Bearer token-for-tests\n")).toBe("token-for-tests");
    expect(bearerTokenOf('"token-for-tests"')).toBe("token-for-tests");
  });

  it("is off when the address is not an address", () => {
    expect(brainWorkspace({ GBRAIN_MCP_URL: "not an address", GBRAIN_TOKEN: WORKSPACE.token })).toBeNull();
  });
});

describe("searchBrain", () => {
  it("says it is not configured, and calls nothing", async () => {
    expect(await searchBrain("Where do I add a checked bag?", { workspace: null })).toEqual({
      configured: false,
      reason: "not configured",
    });
    expect(await searchBrain("Where do I add a checked bag?")).toEqual({ configured: false, reason: "not configured" });
    expect(requests).toEqual([]);
  });

  it("calls the search tool with the token and returns the hits with their sources", async () => {
    const found = await searchBrain("Where do I add a checked bag?", { workspace: WORKSPACE });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(WORKSPACE.url);
    expect(requests[0]?.authorization).toBe("Bearer token-for-tests");
    expect(requests[0]?.body.method).toBe("tools/call");
    expect(requests[0]?.body.params).toMatchObject({
      name: "search",
      arguments: { query: "Where do I add a checked bag?", limit: 6 },
    });
    expect(found.configured).toBe(true);
    if (!found.configured) return;
    expect(found.hits.map((hit) => hit.source.slug)).toEqual(["gaps/checked-bag-by-text", "help/baggage-allowance"]);
    expect(found.hits[1]).toMatchObject({
      title: "Baggage allowance",
      cosine: 0.71,
      evidence: "keyword_exact",
      source: { slug: "help/baggage-allowance", sourceId: "default", part: "compiled_truth" },
    });
  });

  it("keeps one kind of page when a prefix is given", async () => {
    const found = await searchBrain("Where do I add a checked bag?", { workspace: WORKSPACE, prefix: "help/" });
    expect(found.configured && found.hits.map((hit) => hit.source.slug)).toEqual(["help/baggage-allowance"]);
  });

  it("drops a row that is not a hit, and never casts one", async () => {
    rows = [null, "text", { title: "no slug" }, { slug: "help/check-in", score: "high" }];
    const found = await searchBrain("check-in", { workspace: WORKSPACE });
    expect(found.configured && found.hits).toEqual([
      {
        title: "help/check-in",
        type: "",
        snippet: "",
        score: 0,
        cosine: null,
        evidence: null,
        source: { slug: "help/check-in", sourceId: "", part: null },
      },
    ]);
  });

  it("throws when the brain refuses, with no token in the message", async () => {
    status = 401;
    const failure = await searchBrain("check-in", { workspace: WORKSPACE }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("401");
    expect((failure as Error).message).not.toContain(WORKSPACE.token);
    expect((failure as Error).message).not.toContain(WORKSPACE.url);
  });
});

describe("the pages of the brain", () => {
  const article = {
    slug: "baggage-allowance",
    title: 'Baggage: what is "allowed"?',
    category: "Bags",
    summary: "One carry-on bag is free.",
    sections: [{ heading: "Add a checked bag", body: ["Open Manage Trip.", "Select Bags."] }],
  };

  it("writes a help article as one page under help/", () => {
    const page = helpPage(article, "NovaAir");
    expect(page.slug).toBe("help/baggage-allowance");
    expect(page.content.startsWith("---\n")).toBe(true);
    // A title with quotes and a colon is still one valid frontmatter value.
    expect(page.content).toContain('title: "Baggage: what is \\"allowed\\"?"');
    expect(page.content).toContain('type: "help-doc"');
    expect(page.content).toContain("## Add a checked bag\n\n- Open Manage Trip.\n- Select Bags.");
  });

  it("writes a known gap as one page under gaps/, in the customer's words", () => {
    const page = gapPage(
      {
        slug: "find-seats-together",
        title: "Find seats together for a party",
        description: "Let a family take three seats side by side in one move.",
        area: "seats",
        quote: "Can you find us three seats together?",
        rationale: "Today they rebook one passenger at a time.",
        status: "observed",
        fixture: "apps/web/test/turn.test.ts",
      },
      "NovaAir",
    );
    expect(page.slug).toBe("gaps/find-seats-together");
    expect(page.content).toContain('type: "known-gap"');
    expect(page.content).toContain("NovaAir does not do this today.");
    expect(page.content).toContain("> Can you find us three seats together?");
  });
});

describe("the documentation check with a brain", () => {
  /** The rows the present search returns. */
  let chunks: Record<string, unknown>[] = [];
  /** What the passage read answers, and how often it was asked. */
  let covers = true;
  let reads = 0;

  beforeEach(() => {
    chunks = [];
    covers = true;
    reads = 0;
    vi.resetModules();
    vi.doMock("@/lib/openai", () => ({
      chatJson: async () => {
        reads += 1;
        return { covers, reason: "" };
      },
      embed: async (inputs: string[]) => inputs.map(() => new Array(1536).fill(0)),
    }));
    vi.doMock("@/lib/supabase", () => ({
      serviceClient: () => ({ rpc: async () => ({ data: chunks, error: null }) }),
    }));
  });

  const configure = () => {
    vi.stubEnv("GBRAIN_MCP_URL", WORKSPACE.url);
    vi.stubEnv("GBRAIN_TOKEN", WORKSPACE.token);
  };

  const check = async (question: string) => {
    const { probeDocs } = await import("@/lib/agent/probes");
    return probeDocs(question, "project-1", new Array(1536).fill(0));
  };

  it("does not call the brain when it is not configured, and answers as before", async () => {
    const result = await check("Where do I add a checked bag?");
    expect(requests).toEqual([]);
    expect(result).toMatchObject({ probe: "docs", hit: false, summary: "No documentation covers this." });
  });

  it("answers from the brain's help page, and never from a gap page", async () => {
    configure();
    const result = await check("Where do I add a checked bag?");
    expect(requests).toHaveLength(1);
    expect(result.hit).toBe(true);
    expect(result.summary).toContain('The company brain covers this: "Baggage allowance"');
    expect(result.summary).toContain("help/baggage-allowance");
    expect((result.evidence as { documentTitle: string }[]).map((entry) => entry.documentTitle)).toEqual([
      "Baggage allowance",
    ]);
    expect(reads).toBe(0);
  });

  it("reads a passage the brain matched on meaning alone before it trusts it", async () => {
    configure();
    rows = [{ ...BAGGAGE, evidence: "weak_semantic" }];
    const result = await check("Where do I add a checked bag?");
    expect(reads).toBe(1);
    expect(result.hit).toBe(true);
    expect(result.summary).toContain("confirmed by reading it");
  });

  it("falls back to the present search when the brain finds no help page", async () => {
    configure();
    rows = [GAP];
    chunks = [
      {
        document_title: "Baggage allowance",
        source_ref: "http://localhost:4150/help/baggage-allowance",
        heading: "Add a checked bag",
        content: "Add a checked bag on the Manage Trip page.",
        similarity: 0.9,
        confidence: null,
      },
    ];
    const result = await check("Where do I add a checked bag?");
    expect(result.hit).toBe(true);
    expect(result.summary).toContain('The documentation covers this: "Baggage allowance"');
  });

  it("falls back to the present search when the brain fails", async () => {
    configure();
    status = 500;
    const result = await check("Where do I add a checked bag?");
    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({ probe: "docs", hit: false, summary: "No documentation covers this." });
  });

  it("never rules a capability out from the brain alone", async () => {
    configure();
    covers = false;
    rows = [{ ...BAGGAGE, cosine: 0.5 }];
    const result = await check("Where do I add a checked bag?");
    // The brain's passage was read and did not cover the question, so the present search decided.
    expect(reads).toBe(1);
    expect(result.summary).toBe("No documentation covers this.");
  });
});
