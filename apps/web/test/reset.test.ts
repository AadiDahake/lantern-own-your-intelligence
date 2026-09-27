/**
 * Reset puts the demo back to its starting position, and a known route is part of that position.
 *
 * A route the agent remembered answers a question from the last run's product map before a single
 * check runs, so a reset that leaves them behind pins yesterday's answer to today's demo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDemo } from "@/lib/demo/reset";

type Call = { method: string; url: string };

/** Stands in for both PostgREST and GitHub, counting one row per table. */
function fakeFetch(calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url.startsWith("https://api.github.com")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(null, { status: 204, headers: { "content-range": "*/1" } });
  }) as unknown as typeof fetch;
}

const OPTIONS = {
  repo: null,
  githubToken: null,
  supabaseUrl: "https://example.supabase.co",
  supabaseKey: "service-role",
  projectId: "project-1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resetDemo", () => {
  it("clears the project's known routes along with its conversations", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", fakeFetch(calls));

    const summary = await resetDemo(OPTIONS);

    const cleared = calls
      .filter((call) => call.method === "DELETE")
      .map((call) => call.url.replace("https://example.supabase.co/rest/v1/", ""));
    expect(cleared).toEqual([
      "trace_event?project_id=eq.project-1",
      "escalation?project_id=eq.project-1",
      "feature_request_group?project_id=eq.project-1",
      "conversation?project_id=eq.project-1",
      "known_route?project_id=eq.project-1",
    ]);
    expect(summary.knownRoutes).toBe(1);
    expect(summary.problems).toEqual(["No repository is bound, so nothing was closed on GitHub."]);
  });

  it("counts the known routes it would delete without deleting them on a dry run", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", fakeFetch(calls));

    const summary = await resetDemo({ ...OPTIONS, dryRun: true });

    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(summary.knownRoutes).toBe(1);
  });

  it("leaves the knowledge base alone", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", fakeFetch(calls));

    await resetDemo(OPTIONS);

    expect(calls.some((call) => /\/(document|chunk)\?/.test(call.url))).toBe(false);
  });
});
