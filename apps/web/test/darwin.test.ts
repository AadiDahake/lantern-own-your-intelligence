/**
 * The agent search client, offline: the provider is mocked at the fetch boundary.
 *
 * What matters here is what an answer from outside can do to the product: put a link of its own
 * under a company's name, carry characters that hide or reorder text, or be something other than
 * the index's answer. None of that may come through.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_SEARCH } from "@lantern/shared";
import { searchAgents } from "@/lib/darwin";
import type { AgentSearchConfig } from "@/lib/env";
import { SEATS_ANSWER } from "./fixtures/agent-search";

const PUBLIC: AgentSearchConfig = { apiKey: null, apiUrl: "https://search.test" };
const KEYED: AgentSearchConfig = { apiKey: "test-key-not-real", apiUrl: "https://search.test" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = { url: string; init: RequestInit };

function fetchReturning(response: () => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** A fetch that never answers, and that ends the way the real one does when its signal fires. */
function fetchThatHangs(): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** One result and its agent, ready to start, with the fields a test wants to change. */
function answerWith(result: Record<string, unknown>, agent: Record<string, unknown> = {}): unknown {
  return {
    contractVersion: "search-public-v2",
    outcome: "MATCH",
    results: [
      {
        rank: 1,
        agent: "agent1",
        capability: "cap1",
        name: "Find seats together",
        description: "Seats a party side by side.",
        readiness: "ready",
        canStartThread: true,
        ...result,
      },
    ],
    agents: [{ agent: "agent1", name: "SeatFinder", verified: true, ...agent }],
  };
}

async function onlyListing(result: Record<string, unknown>, agent: Record<string, unknown> = {}) {
  const { fetchImpl } = fetchReturning(() => jsonResponse(answerWith(result, agent)));
  const found = await searchAgents(PUBLIC, "finding seats together", { fetchImpl });
  if (!found.ok) throw new Error(`the search failed: ${found.reason}`);
  return found.listings;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("searchAgents", () => {
  it("posts one search with the query and the result count, and no key in public mode", async () => {
    const { fetchImpl, calls } = fetchReturning(() => jsonResponse(SEATS_ANSWER));
    const found = await searchAgents(PUBLIC, "finding seats together", { fetchImpl });

    expect(found.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://search.test/api/v2/search");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toEqual({ "content-type": "application/json" });
    // A redirect is never followed: it would carry the key header to a different host.
    expect(calls[0]?.init.redirect).toBe("manual");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ query: "finding seats together", numResults: 10 });
  });

  it("sends the key in its own header when there is one", async () => {
    const { fetchImpl, calls } = fetchReturning(() => jsonResponse(SEATS_ANSWER));
    await searchAgents(KEYED, "finding seats together", { fetchImpl });
    expect(calls[0]?.init.headers).toEqual({ "content-type": "application/json", "x-api-key": "test-key-not-real" });
  });

  it("reads a real answer into listings, in the index's own order, with the service of each", async () => {
    const { fetchImpl } = fetchReturning(() => jsonResponse(SEATS_ANSWER));
    const found = await searchAgents(PUBLIC, "finding seats together", { fetchImpl });
    if (!found.ok) throw new Error(found.reason);

    expect(found.listings.map((listing) => listing.name)).toEqual(SEATS_ANSWER.results.map((result) => result.name));
    expect(found.listings[0]).toMatchObject({
      rank: 1,
      name: "Find best seats",
      provider: "FlightSeatMap",
      verified: true,
      readiness: "unavailable",
      startable: false,
      paid: false,
    });
    // On the day this answer was read, no listing of the index could start.
    expect(found.listings.filter((listing) => listing.startable)).toEqual([]);
    expect(found.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ["ready", true, true],
    ["ready", false, false],
    ["ready", "true", false],
    ["authentication_required", true, false],
    ["recheck_available", true, false],
    ["unavailable", false, false],
  ])("reads readiness %s with canStartThread %s as startable %s", async (readiness, canStartThread, startable) => {
    const [listing] = await onlyListing({ readiness, canStartThread });
    expect(listing?.startable).toBe(startable);
  });

  it.each([
    [{ payment: { state: "REQUIRED", termsDigest: null } }, true],
    [{ payment: { state: "NOT_REQUIRED" } }, false],
    [{ payment: { state: "UNKNOWN" } }, false],
    [{ payment: "REQUIRED" }, false],
    ["REQUIRED", false],
    [undefined, false],
  ])("reads the payment word of the execution requirements %j as paid %s", async (executionRequirements, paid) => {
    const [listing] = await onlyListing({ executionRequirements });
    expect(listing?.paid).toBe(paid);
  });

  it("keeps a readiness word only when it is one, so free text does not reach the trace", async () => {
    const [listing] = await onlyListing({ readiness: "Ready! Call +1 415 555 0100 now" });
    expect(listing).toMatchObject({ readiness: "unknown", startable: false });
  });

  it("builds the link from the two ids, and takes no link from the answer", async () => {
    const [listing] = await onlyListing(
      { agent: "protocol-agent:f7dc73", capability: "mcp-tool:00225e", url: "https://evil.example/x", websiteUrl: "javascript:alert(1)" },
      { agent: "protocol-agent:f7dc73", websiteUrl: "https://evil.example/agent" },
    );
    expect(listing?.url).toBe("https://index.darwin.so/agent/protocol-agent%3Af7dc73?capability=mcp-tool%3A00225e");
    expect(JSON.stringify(listing)).not.toContain("evil.example");
    expect(JSON.stringify(listing)).not.toContain("javascript");
  });

  it.each([
    ["a path", "../../admin"],
    ["a path after a first letter", "abc/def"],
    ["a query", "abc?next=https://evil.example"],
    ["a space", "abc def"],
    ["a fragment", "abc#frag"],
    ["nothing", ""],
    ["a number", 42],
    ["a very long id", "a".repeat(201)],
  ])("leaves out a listing whose id is %s, and keeps the one beside it", async (_label, id) => {
    const good = { agent: "a1", capability: "good", name: "Find seats together", readiness: "ready", canStartThread: true };
    for (const bad of [{ ...good, agent: id }, { ...good, capability: id }]) {
      const { fetchImpl } = fetchReturning(() =>
        jsonResponse({ results: [bad, good], agents: [{ agent: "a1", name: "SeatFinder", verified: true }] }),
      );
      const found = await searchAgents(PUBLIC, "finding seats together", { fetchImpl });
      expect(found.ok && found.listings.map((listing) => listing.capabilityId)).toEqual(["good"]);
    }
  });

  it("makes the words of a listing plain: no control, invisible or direction character, one space between words", async () => {
    const hidden = String.fromCharCode(0x202e, 0x200b, 0x0007, 0x2028, 0xfeff);
    const [listing] = await onlyListing(
      { name: `Find${hidden} seats\n\n\ttogether  `, description: `Seats${hidden}a\r\nparty.` },
      { name: `Seat${hidden}Finder` },
    );
    expect(listing).toMatchObject({ name: "Find seats together", description: "Seats a party.", provider: "Seat Finder" });
    for (const text of [listing?.name, listing?.description, listing?.provider]) {
      expect(text).toMatch(/^[\x20-\x7e]*$/);
    }
  });

  it("takes a character with no width out with no space, so a word stays one word", async () => {
    // A soft hyphen, a zero width joiner and a direction mark.
    const noWidth = String.fromCharCode(0x00ad, 0x200d, 0x200f);
    const [listing] = await onlyListing({ name: `Find sea${noWidth}ts together` });
    expect(listing?.name).toBe("Find seats together");
  });

  it.each([
    ["a control character", String.fromCharCode(0x0001)],
    ["a character of the private use area", String.fromCharCode(0xe000)],
    ["a code point that is not assigned", String.fromCodePoint(0x50000)],
    ["a line separator", String.fromCharCode(0x2028)],
    ["a space that does not break", String.fromCharCode(0x00a0)],
    ["a wide space", String.fromCharCode(0x3000)],
  ])("puts one space in the place of %s", async (_label, char) => {
    const [listing] = await onlyListing({ name: `Find${char}seats${char}${char}together` });
    expect(listing?.name).toBe("Find seats together");
  });

  it("cuts a long name, a long service name and a long description", async () => {
    const [listing] = await onlyListing(
      { name: `Find seats together ${"x".repeat(200)}`, description: "word ".repeat(1000) },
      { name: "S".repeat(200) },
    );
    expect(listing?.name).toHaveLength(80);
    expect(listing?.name.endsWith("...")).toBe(true);
    expect(listing?.provider).toHaveLength(60);
    expect(listing?.description.length).toBeLessThanOrEqual(2000);
  });

  it("does not cut a name in the middle of a character that takes two code units", async () => {
    const plane = String.fromCodePoint(0x1f6eb);
    const [listing] = await onlyListing({ name: plane.repeat(100) });
    expect(Array.from(listing?.name ?? "")).toHaveLength(80);
    // A half of such a character is a lone surrogate, which is its own class.
    expect(/\p{Cs}/u.test(listing?.name ?? "")).toBe(false);
  });

  it("leaves out a listing with no name, and keeps the others", async () => {
    const { fetchImpl } = fetchReturning(() =>
      jsonResponse({
        results: [
          { agent: "a1", capability: "c1", name: "   ", readiness: "ready", canStartThread: true },
          { agent: "a1", capability: "c2", name: 7, readiness: "ready", canStartThread: true },
          "not a listing",
          null,
          { agent: "a1", capability: "c3", name: "Find seats together", readiness: "ready", canStartThread: true },
        ],
        agents: [{ agent: "a1", name: "SeatFinder", verified: true }],
      }),
    );
    const found = await searchAgents(PUBLIC, "finding seats together", { fetchImpl });
    expect(found.ok && found.listings.map((listing) => [listing.capabilityId, listing.rank])).toEqual([["c3", 5]]);
  });

  it("reads the service of a listing wherever it stands in a long list of agents", async () => {
    const agents = Array.from({ length: 120 }, (_unused, index) => ({ agent: `a${index}`, name: `Service ${index}`, verified: true }));
    const { fetchImpl } = fetchReturning(() =>
      jsonResponse({
        results: [{ agent: "a119", capability: "c1", name: "Find seats together", readiness: "ready", canStartThread: true }],
        agents,
      }),
    );
    const found = await searchAgents(PUBLIC, "finding seats together", { fetchImpl });
    expect(found.ok && found.listings[0]).toMatchObject({ provider: "Service 119", verified: true });
  });

  it("reads a service as not verified and not named when the answer does not list it", async () => {
    const [listing] = await onlyListing({ agent: "other" });
    expect(listing).toMatchObject({ provider: "", verified: false });
  });

  it.each([
    [true, true],
    ["true", false],
    [1, false],
    [undefined, false],
  ])("reads verified %s as %s", async (verified, expected) => {
    const [listing] = await onlyListing({}, { verified });
    expect(listing?.verified).toBe(expected);
  });

  it("reads at most 50 listings of one answer", async () => {
    const results = Array.from({ length: 80 }, (_unused, index) => ({
      agent: "a1",
      capability: `c${index}`,
      name: `Listing ${index}`,
      readiness: "unavailable",
      canStartThread: false,
    }));
    const { fetchImpl } = fetchReturning(() => jsonResponse({ results, agents: [] }));
    const found = await searchAgents(PUBLIC, "finding seats together", { fetchImpl });
    expect(found.ok && found.listings).toHaveLength(50);
  });

  it("reads an answer with no result as an empty list, which is not a failure", async () => {
    const { fetchImpl } = fetchReturning(() => jsonResponse({ outcome: "NO_ELIGIBLE_SUPPLY", results: [], agents: [] }));
    expect(await searchAgents(PUBLIC, "finding seats together", { fetchImpl })).toMatchObject({ ok: true, listings: [] });
  });

  it.each([
    [429, "rate_limited"],
    [503, "http_503"],
    [500, "http_500"],
    [401, "http_401"],
    [302, "http_302"],
  ])("reads a %s as a failure with a short code, after one attempt", async (status, reason) => {
    const { fetchImpl, calls } = fetchReturning(
      () => new Response(JSON.stringify({ code: "X", message: "finding seats together is not allowed" }), { status }),
    );
    const found = await searchAgents(KEYED, "finding seats together", { fetchImpl });
    expect(found).toMatchObject({ ok: false, reason });
    // Never the provider's own words, and never the key.
    expect(JSON.stringify(found)).not.toContain("not allowed");
    expect(JSON.stringify(found)).not.toContain("test-key-not-real");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["a page", () => new Response("<html><body>Welcome</body></html>", { status: 200 })],
    ["a different JSON", () => jsonResponse({ ok: true })],
    ["results that are not a list", () => jsonResponse({ results: "none", agents: [] })],
    ["no agents", () => jsonResponse({ results: [] })],
    ["a list", () => jsonResponse([])],
    ["an empty body", () => new Response(null, { status: 200 })],
  ])("does not read %s with a 200 as the index's answer", async (_label, response) => {
    const { fetchImpl } = fetchReturning(response);
    expect(await searchAgents(PUBLIC, "finding seats together", { fetchImpl })).toMatchObject({
      ok: false,
      reason: "unreadable_answer",
    });
  });

  it("does not read rows of a different shape as an index with no service", async () => {
    const renamed = { results: [{ agentId: "a1", capabilityId: "c1", title: "Find seats together" }], agents: [] };
    const { fetchImpl } = fetchReturning(() => jsonResponse(renamed));
    expect(await searchAgents(PUBLIC, "finding seats together", { fetchImpl })).toMatchObject({
      ok: false,
      reason: "unreadable_answer",
    });
  });

  it("reads an answer that starts with a byte order mark", async () => {
    const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(SEATS_ANSWER))]);
    const { fetchImpl } = fetchReturning(() => new Response(body, { status: 200 }));
    const found = await searchAgents(PUBLIC, "finding seats together", { fetchImpl });
    expect(found.ok && found.listings).toHaveLength(7);
  });

  it("stops reading an answer that is larger than the cap", async () => {
    const huge = JSON.stringify({ results: [], agents: [], pad: "x".repeat(600_000) });
    const { fetchImpl } = fetchReturning(() => new Response(huge, { status: 200 }));
    expect(await searchAgents(PUBLIC, "finding seats together", { fetchImpl })).toMatchObject({
      ok: false,
      reason: "answer_too_large",
    });
  });

  it("ends a search that gets no answer in the time it has", async () => {
    const { fetchImpl, calls } = fetchThatHangs();
    const found = await searchAgents(PUBLIC, "finding seats together", { fetchImpl, timeoutMs: 20 });
    expect(found).toMatchObject({ ok: false, reason: "timeout" });
    expect(calls).toHaveLength(1);
  });

  it("keeps its time limit when the caller gives a signal, which is how a turn calls it", async () => {
    const { fetchImpl } = fetchThatHangs();
    const found = await searchAgents(PUBLIC, "finding seats together", {
      fetchImpl,
      timeoutMs: 20,
      signal: new AbortController().signal,
    });
    expect(found).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("has 8 seconds when no limit is given, and not a millisecond more", async () => {
    expect(AGENT_SEARCH.timeoutMs).toBe(8_000);
    vi.useFakeTimers();
    const { fetchImpl } = fetchThatHangs();
    let found: unknown = null;
    void searchAgents(PUBLIC, "finding seats together", { fetchImpl, signal: new AbortController().signal }).then((result) => {
      found = result;
    });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(found).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(found).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("leaves no timer behind after a search that answered", async () => {
    vi.useFakeTimers();
    const { fetchImpl } = fetchReturning(() => jsonResponse(SEATS_ANSWER));
    await searchAgents(PUBLIC, "finding seats together", { fetchImpl });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("says stopped, with no wait, for a signal that fired before the call", async () => {
    const { fetchImpl } = fetchThatHangs();
    const stop = new AbortController();
    stop.abort();
    expect(await searchAgents(PUBLIC, "finding seats together", { fetchImpl, signal: stop.signal })).toMatchObject({
      ok: false,
      reason: "stopped",
    });
  });

  it("ends at once when the caller stops it, and says so", async () => {
    const { fetchImpl } = fetchThatHangs();
    const stop = new AbortController();
    const pending = searchAgents(PUBLIC, "finding seats together", { fetchImpl, signal: stop.signal });
    stop.abort();
    expect(await pending).toMatchObject({ ok: false, reason: "stopped" });
  });

  it.each([
    ["ECONNREFUSED", "unreachable"],
    ["ENOTFOUND", "unreachable"],
    ["ERR_INVALID_URL", "bad_api_url"],
    ["ECONNRESET", "network"],
  ])("reads a connection failure with the code %s as %s", async (code, reason) => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: { code } });
    }) as unknown as typeof fetch;
    expect(await searchAgents(PUBLIC, "finding seats together", { fetchImpl })).toMatchObject({ ok: false, reason });
  });

  it("never throws, whatever is thrown at it", async () => {
    const hostile = new Error("fetch failed");
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error("the cause cannot be read");
      },
    });
    for (const thrown of ["a string, not an error", null, hostile]) {
      const fetchImpl = vi.fn(async () => {
        throw thrown;
      }) as unknown as typeof fetch;
      expect(await searchAgents(PUBLIC, "finding seats together", { fetchImpl })).toMatchObject({
        ok: false,
        reason: "network",
      });
    }
  });
});
