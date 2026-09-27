/**
 * Route memory, offline: the Memorable trace a completed walk becomes, the store that answers the
 * next person, and the extraction call with the provider mocked at the fetch boundary.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandFor, extract, traceFor } from "@/lib/routes/memorable";
import { recallRoute, rememberedAsKnown, rememberRoute, walkSteps, type WalkStep } from "@/lib/routes/provider";

const PROJECT = "7d1c1f8e-0000-4000-8000-000000000001";

const STEPS: WalkStep[] = [
  {
    caption: "Open My Booking",
    advanceOn: "navigation",
    control: { role: "link", name: "My Booking", landmark: "navigation", href: "/my-booking", route: "/" },
  },
  {
    caption: "Press Change seats",
    advanceOn: "click",
    control: { role: "button", name: "Change seats", landmark: "main", route: "/trips/[code]" },
  },
];

const walk = { walkId: "msg-1", feature: "change seats", answer: "Open My Booking, then Change seats.", steps: STEPS };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lantern-route-memory-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the Memorable trace", () => {
  it("names each control by identity only, with a fill for an input step", () => {
    expect(commandFor(STEPS[0] as WalkStep)).toBe('press role=link name="My Booking" landmark=navigation href=/my-booking route=/');
    expect(commandFor({ ...(STEPS[1] as WalkStep), advanceOn: "input", control: { role: "textbox", name: 'The "new" name', route: "/account" } })).toBe(
      'fill role=textbox name="The \\"new\\" name" route=/account',
    );
  });

  it("is one tool call per step, every one ok, with the question as the task", () => {
    const trace = traceFor({ walkId: "msg-1", question: "How do I change my seats?", steps: STEPS });
    expect(trace).toMatchObject({ session_id: "walk-msg-1", harness: "lantern", task_description: "How do I change my seats?" });
    expect(trace.tool_calls.map((call) => [call.name, call.result.ok])).toEqual([
      ["press", true],
      ["press", true],
    ]);
  });
});

describe("extract", () => {
  it("sends the trace with the key and reads the draft title", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ draft: { title: "Change seats", steps: [] }, request_id: "r1" }));
    const result = await extract(traceFor({ walkId: "m", question: "q", steps: STEPS }), {
      apiKey: "mk_test",
      baseUrl: "https://memorable.test/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ status: "extracted", title: "Change seats", draft: { title: "Change seats", steps: [] } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://memorable.test/v1/extract");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer mk_test");
  });

  it("reports a refusal, an HTTP error and a network error without throwing", async () => {
    const options = (response: () => Promise<Response>) => ({ apiKey: "k", baseUrl: "https://m.test", fetchImpl: response as unknown as typeof fetch });
    const trace = traceFor({ walkId: "m", question: "q", steps: STEPS });
    expect(await extract(trace, options(async () => jsonResponse({ refused: "allowance_exhausted" })))).toEqual({ status: "refused", reason: "allowance_exhausted" });
    expect(await extract(trace, options(async () => jsonResponse({ error: "unauthorized" }, 401)))).toEqual({ status: "failed", reason: "unauthorized" });
    expect(await extract(trace, options(async () => Promise.reject(new Error("offline"))))).toEqual({ status: "failed", reason: "offline" });
  });
});

describe("walkSteps", () => {
  it("keeps a walk whose every step names a control and a route, and drops anything else", () => {
    expect(walkSteps(STEPS)).toEqual(STEPS);
    expect(walkSteps([{ caption: "x", advanceOn: "click", target: "a1" }])).toBeNull();
    expect(walkSteps([])).toBeNull();
    expect(walkSteps("nope")).toBeNull();
  });
});

describe("route memory", () => {
  it("is off unless configured: nothing is stored and nothing is recalled", async () => {
    const result = await rememberRoute(PROJECT, "How do I change my seats?", walk, { mode: "off", dir });
    expect(result).toEqual({ status: "skipped", reason: "route memory is off" });
    expect(await recallRoute(PROJECT, "How do I change my seats?", { mode: "off", dir })).toBeNull();
  });

  it("recalls a completed walk for the same question, and counts a second walk of the same route", async () => {
    const options = { mode: "local" as const, dir };
    expect(await recallRoute(PROJECT, "How do I change my seats?", options)).toBeNull();

    const first = await rememberRoute(PROJECT, "How do I change my seats?", walk, options);
    expect(first.status).toBe("remembered");

    const recalled = await recallRoute(PROJECT, "how do i change my seats", options);
    expect(recalled?.steps).toHaveLength(2);
    expect(recalled?.walks).toBe(1);
    expect(recalled?.extracted).toBe(false);

    await rememberRoute(PROJECT, "How can I change my seats?", walk, options);
    expect((await recallRoute(PROJECT, "How do I change my seats?", options))?.walks).toBe(2);
    expect(await recallRoute("another-project", "How do I change my seats?", options)).toBeNull();
  });

  it("keeps Memorable's draft when extraction succeeds, and stores nothing when Memorable refuses", async () => {
    const extracted = vi.fn(async () => jsonResponse({ draft: { title: "Change seats on a trip" } }));
    const stored = await rememberRoute(PROJECT, "How do I change my seats?", walk, {
      mode: "memorable",
      dir,
      apiKey: "mk_test",
      apiUrl: "https://m.test",
      fetchImpl: extracted as unknown as typeof fetch,
    });
    expect(stored.status === "remembered" && stored.route.title).toBe("Change seats on a trip");
    expect((await recallRoute(PROJECT, "How do I change my seats?", { mode: "memorable", dir }))?.extracted).toBe(true);

    const refused = vi.fn(async () => jsonResponse({ refused: "allowance_exhausted" }));
    const skipped = await rememberRoute(PROJECT, "Where is my boarding pass?", walk, {
      mode: "memorable",
      dir,
      apiKey: "mk_test",
      apiUrl: "https://m.test",
      fetchImpl: refused as unknown as typeof fetch,
    });
    expect(skipped).toEqual({ status: "skipped", reason: "Memorable refused the walk: allowance_exhausted" });
    expect(await recallRoute(PROJECT, "Where is my boarding pass?", { mode: "memorable", dir })).toBeNull();
  });

  it("still remembers a walk that only opens pages, which Memorable refuses as read_only", async () => {
    const readOnly = vi.fn(async () => jsonResponse({ refused: "read_only" }));
    const result = await rememberRoute(PROJECT, "How do I change my seats?", walk, {
      mode: "memorable",
      dir,
      apiKey: "mk_test",
      apiUrl: "https://m.test",
      fetchImpl: readOnly as unknown as typeof fetch,
    });
    expect(result.status === "remembered" && result.route.extracted).toBe(false);
  });

  it("gives the turn the control the walk ended on as the target", async () => {
    const result = await rememberRoute(PROJECT, "How do I change my seats?", walk, { mode: "local", dir });
    if (result.status !== "remembered") throw new Error("not remembered");
    expect(rememberedAsKnown(result.route)).toMatchObject({
      feature: "change seats",
      target: { route: "/trips/[code]", key: "button|change seats|main|" },
      hitCount: 1,
    });
  });
});
