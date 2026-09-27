/**
 * The Reflex client against a scripted API, and the Reflex strategy's persona chain: launch the
 * Capability Builder from its persona, snapshot, launch the UX Builder on the snapshot, snapshot,
 * launch the Verifier, stream every event into the trace. The agent's devbox is stubbed.
 */
import { describe, expect, it, vi } from "vitest";
import { payloadText, ReflexClient, type ReflexEvent } from "@/lib/forge/reflex-client";
import { ReflexStrategy, traceForReflexEvent } from "@/lib/forge/reflex";
import { loadPersonas } from "@/lib/forge/personas";
import type { ForgeTrace } from "@/lib/forge/store";
import { REPO } from "./fake-strategy";

type Request = { method: string; path: string; body: unknown; headers: Record<string, string> };

/** A scripted Reflex: agents complete on the second poll, snapshots on the first status check. */
function reflexServer() {
  const requests: Request[] = [];
  const agents = new Map<string, { status: string; polls: number; devboxId: string; events: ReflexEvent[] }>();
  let counter = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: url.pathname.replace(/^\/api/, "") + url.search, body, headers });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

    const pathname = url.pathname.replace(/^\/api/, "");
    const launch = /\/agent-personas\/([^/]+)\/launch$/.exec(pathname);
    if (launch && method === "POST") {
      counter += 1;
      const id = `agt_${counter}`;
      const devboxId = `dbx_${counter}`;
      agents.set(id, {
        status: "starting",
        polls: 0,
        devboxId,
        events: [
          { id: "e1", sequence: 1, streamId: "s", type: "agent.started", payload: { message: "started" }, timestamp: 1 },
          { id: "e2", sequence: 2, streamId: "s", type: "turn.tool_call", payload: { name: "bash", command: "npm test" }, timestamp: 2 },
          { id: "e3", sequence: 3, streamId: "s", type: "assistant", payload: { text: `{"scenarios":[{"id":"three_contiguous_available","passed":true}],"test_command":"npm test","test_file":"tests/x.test.ts","summary":"ok"}` }, timestamp: 3 },
          { id: "e4", sequence: 4, streamId: "s", type: "agent.complete", payload: { message: "done" }, timestamp: 4 },
        ],
      });
      return json({ id, streamId: "s", agentType: "codex", status: "starting", turnState: "working", devboxId, tunnelKey: `tk_${counter}`, name: body.name, personaId: launch[1], daemons: null }, 201);
    }
    const agentMatch = /\/agents\/([^/]+)(\/[a-z-]+)?$/.exec(pathname);
    if (agentMatch) {
      const agent = agents.get(agentMatch[1]!)!;
      if (agentMatch[2] === "/stream") {
        const from = Number(url.searchParams.get("fromSeq") ?? 0);
        return json(agent.events.filter((event) => (event.sequence ?? 0) >= from));
      }
      if (agentMatch[2] === "/stop") {
        agent.status = "stopped";
        return json({ id: agentMatch[1], status: "stopped" });
      }
      if (agentMatch[2] === "/snapshots") {
        agent.status = "completed";
        return json({ id: `snp_${agentMatch[1]}`, name: body.name, createTimeMs: 1, sourceDevboxId: agent.devboxId }, 202);
      }
      agent.polls += 1;
      if (agent.polls >= 2) agent.status = "completed";
      return json({ id: agentMatch[1], streamId: "s", agentType: "codex", status: agent.status, turnState: agent.status === "completed" ? "idle" : "working", devboxId: agent.devboxId, tunnelKey: `tk_${agentMatch[1]!.slice(4)}`, name: "n", personaId: null, daemons: null });
    }
    const snapshot = /\/snapshots\/([^/]+)\/status$/.exec(pathname);
    if (snapshot) return json({ status: "complete", snapshot: { id: snapshot[1], name: "n", createTimeMs: 1, sourceDevboxId: "d" } });
    if (/\/snapshots\/[^/]+$/.test(pathname) && method === "DELETE") return new Response(null, { status: 204 });
    if (pathname.endsWith("/agent-personas")) return json([{ id: "prs_1", name: "Capability Builder", agentType: "codex" }]);
    return json({ error: `unhandled ${method} ${pathname}` }, 404);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const RUNLOOP_MOCK = vi.hoisted(() => ({
  exec: vi.fn(async (command: string) => ({ exitCode: 0, stdout: command.startsWith("git status") ? " M lib/seats/index.ts\n?? lib/seats/together.ts\n" : "", stderr: "" })),
}));

vi.mock("@/lib/forge/runloop", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/forge/runloop")>();
  class FakeRunloopSandbox {
    writableRoots: string[] = [];
    constructor(readonly handle: unknown, readonly devbox: { id: string }, readonly repoDir: string) {}
    exec = RUNLOOP_MOCK.exec;
    async writeFile(): Promise<void> {}
    async readFile(): Promise<string> {
      return "";
    }
    async serve(port: number): Promise<string> {
      return `https://${port}-x.tunnel.runloop.ai`;
    }
    async pushBranch(): Promise<{ sha: string }> {
      return { sha: "abc" };
    }
    async openDraftPr(): Promise<{ url: string; number: number; nodeId: null }> {
      return { url: "u", number: 1, nodeId: null };
    }
    async teardown(): Promise<void> {}
  }
  return { ...original, RunloopSandbox: FakeRunloopSandbox };
});

vi.mock("@runloop/api-client", () => ({
  RunloopSDK: class {
    devbox = { fromId: (id: string) => ({ id, shutdown: async () => undefined, getInfo: async () => ({ status: "running" }) }) };
  },
}));

describe("ReflexClient", () => {
  it("sends the key and the organization on every call and reads the launch response", async () => {
    const server = reflexServer();
    const client = new ReflexClient({ apiKey: "rfx_test", organizationId: "doing_something", fetchImpl: server.fetchImpl });
    const agent = await client.launchPersona("prs_1", { prompt: "go", repoSlug: "AadiDahake/novaair-own-your-intelligence", repoBranch: "main" });
    expect(agent.id).toBe("agt_1");
    expect(agent.devboxId).toBe("dbx_1");
    expect(agent.tunnelKey).toBe("tk_1");
    const request = server.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/agent-personas/prs_1/launch");
    expect(request.headers.authorization).toBe("Bearer rfx_test");
    expect(request.headers["x-organization-id"]).toBe("doing_something");
    expect(request.body).toMatchObject({ prompt: "go", repoSlug: "AadiDahake/novaair-own-your-intelligence", repoBranch: "main" });
  });

  it("reads events from a sequence and both response shapes", async () => {
    const server = reflexServer();
    const client = new ReflexClient({ apiKey: "k", organizationId: "o", fetchImpl: server.fetchImpl });
    await client.launchPersona("prs_1", { prompt: "go" });
    const events = await client.streamEvents("agt_1", 3);
    expect(events.map((event) => event.type)).toEqual(["assistant", "agent.complete"]);
    expect(server.requests.at(-1)?.path).toBe("/agents/agt_1/stream?fromSeq=3");
  });

  it("names the status when Reflex refuses", async () => {
    const fetchImpl = (async () => new Response("no such org", { status: 403 })) as typeof fetch;
    const client = new ReflexClient({ apiKey: "k", organizationId: "o", fetchImpl });
    await expect(client.getAgent("agt_1")).rejects.toThrow(/403 to GET \/agents\/agt_1/);
  });
});

describe("payloadText", () => {
  it("finds the most descriptive string in an untyped payload", () => {
    expect(payloadText({ message: "hi" })).toBe("hi");
    expect(payloadText({ data: { command: "npm test" } })).toBeNull();
    expect(payloadText({ result: { text: "nested" } })).toBe("nested");
    expect(payloadText("plain")).toBe("plain");
    expect(payloadText(42)).toBeNull();
  });
});

describe("traceForReflexEvent", () => {
  const context = { persona: "UX Builder", candidate: "A" };
  it("maps tool calls, messages and errors and drops chunks", () => {
    expect(traceForReflexEvent({ id: "1", streamId: "s", type: "turn.tool_call", payload: { command: "npm run lint" }, timestamp: 1 }, context)).toMatchObject({ kind: "tool", title: "UX Builder (A): npm run lint" });
    expect(traceForReflexEvent({ id: "1", streamId: "s", type: "assistant", payload: { text: "Added the button." }, timestamp: 1 }, context)).toMatchObject({ kind: "model" });
    expect(traceForReflexEvent({ id: "1", streamId: "s", type: "agent.error", payload: { message: "boom" }, timestamp: 1 }, context)).toMatchObject({ kind: "error", status: "failed" });
    expect(traceForReflexEvent({ id: "1", streamId: "s", type: "agent_message_chunk", payload: { text: "A" }, timestamp: 1 }, context)).toBeNull();
    expect(traceForReflexEvent({ id: "1", streamId: "s", type: "agent.pr_created", payload: { url: "https://github.com/x/y/pull/1", message: "https://github.com/x/y/pull/1" }, timestamp: 1 }, context)).toMatchObject({ kind: "artifact" });
  });
});

describe("ReflexStrategy", () => {
  it("chains the three personas by id through snapshots and streams their events", async () => {
    const server = reflexServer();
    const client = new ReflexClient({ apiKey: "k", organizationId: "o", fetchImpl: server.fetchImpl });
    const strategy = new ReflexStrategy({
      reflex: client,
      personaIds: { capability_builder: "prs_cb", ux_builder: "prs_ux", capability_verifier: "prs_cv" },
      runloopApiKey: "rl_test",
      pollMs: 0,
    });
    const personas = loadPersonas();
    const sandbox = await strategy.provision({ label: "A", escalationId: "esc-1", branch: "lantern/x-a" }, REPO);
    await sandbox.writeFile(".lantern/spec.json", '{"intent":"x"}');
    expect(sandbox.handle.devboxId).toBeNull();

    const rows: ForgeTrace[] = [];
    const first = await sandbox.runPersona!({ persona: personas.capability_builder, prompt: "BUILD", resumeThreadId: null, apiKeyEnvVar: null, onTrace: (row) => rows.push(row) });
    expect(first.exitCode).toBe(0);
    expect(first.summary.threadId).toBe("agt_1");
    expect(first.summary.changedFiles).toEqual([{ path: "lib/seats/index.ts", kind: "update" }, { path: "lib/seats/together.ts", kind: "add" }]);
    expect(sandbox.handle).toMatchObject({ agentId: "agt_1", devboxId: "dbx_1", tunnelKey: "tk_1" });
    const launch = server.requests.find((request) => request.path === "/agent-personas/prs_cb/launch")!;
    expect(launch.body).toMatchObject({ promptStrategy: "prepend-default", promptMode: "implement", repoSlug: "AadiDahake/novaair-own-your-intelligence", repoBranch: "main", sandboxOptions: { resourceSize: "LARGE" } });
    expect(String((launch.body as { prompt: string }).prompt)).toContain("BUILD");
    expect(String((launch.body as { prompt: string }).prompt)).toContain('{"intent":"x"}');

    const second = await sandbox.runPersona!({ persona: personas.ux_builder, prompt: "UX", resumeThreadId: "agt_1", apiKeyEnvVar: null, onTrace: (row) => rows.push(row) });
    expect(second.summary.threadId).toBe("agt_2");
    const snapshot = server.requests.find((request) => request.path === "/agents/agt_1/snapshots")!;
    expect(snapshot.method).toBe("POST");
    const uxLaunch = server.requests.find((request) => request.path === "/agent-personas/prs_ux/launch")!;
    expect(uxLaunch.body).toMatchObject({ sandboxOptions: { snapshotId: "snp_agt_1" } });
    expect(uxLaunch.body).not.toHaveProperty("repoSlug");

    const third = await sandbox.runPersona!({ persona: personas.capability_verifier, prompt: "VERIFY", resumeThreadId: null, apiKeyEnvVar: null, onTrace: (row) => rows.push(row) });
    expect(third.summary.lastMessage).toContain('"scenarios"');
    expect(server.requests.find((request) => request.path === "/agent-personas/prs_cv/launch")!.body).toMatchObject({ promptMode: "review", sandboxOptions: { snapshotId: "snp_agt_2" } });

    const titles = rows.map((row) => row.title);
    expect(titles).toContain("Candidate A: Reflex agent agt_1 launched from persona prs_cb");
    expect(titles).toContain("Capability Builder (A): npm test");
    expect(titles).toContain("Candidate A: snapshot snp_agt_1 taken for the UX Builder");
    expect(rows.filter((row) => row.kind === "tool")).toHaveLength(3);

    await sandbox.teardown();
    expect(server.requests.filter((request) => request.path === "/agents/agt_3/stop")).toHaveLength(1);
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(2);
  });
});
