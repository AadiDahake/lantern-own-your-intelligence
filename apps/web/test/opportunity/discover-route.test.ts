/**
 * `POST /api/opportunities/:groupId/discover`: enqueue and answer 202, never run in the request.
 * The console, the queue and the runner are mocked at their module boundaries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const project = { id: "proj-1", slug: "novaair" };
const state = vi.hoisted(() => ({
  project: null as { id: string } | null,
  groupRow: null as { id: string } | null,
  enqueue: vi.fn(),
  execute: vi.fn(),
  mode: "inline" as "inline" | "runner",
  posthog: true,
}));

vi.mock("@/lib/console/current", () => ({
  currentProject: async () => {
    if (!state.project) throw Response.json({ error: "Sign in to use the console." }, { status: 401 });
    return state.project;
  },
  asErrorResponse: (error: unknown) => {
    if (error instanceof Response) return error;
    throw error;
  },
}));

vi.mock("@/lib/supabase", () => ({
  serviceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state.groupRow }) }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/env", () => ({
  posthogConfigured: () => state.posthog,
  discoveryMode: () => state.mode,
}));

vi.mock("@/lib/opportunity/queue", () => ({ enqueueDiscovery: state.enqueue }));
vi.mock("@/lib/opportunity/run", () => ({ executeDiscovery: state.execute }));

import { POST } from "@/app/api/opportunities/[groupId]/discover/route";

const call = () => POST(new Request("http://localhost/api/opportunities/g1/discover", { method: "POST" }), { params: Promise.resolve({ groupId: "g1" }) });

describe("POST /api/opportunities/:groupId/discover", () => {
  beforeEach(() => {
    state.project = project;
    state.groupRow = { id: "g1" };
    state.mode = "inline";
    state.posthog = true;
    state.enqueue.mockReset();
    state.execute.mockReset();
    state.execute.mockResolvedValue(null);
  });

  it("enqueues a manual run, answers 202 at once, and starts it after the response in inline mode", async () => {
    state.enqueue.mockResolvedValue({ discovery: { id: "d1", status: "queued" }, created: true });
    const response = await call();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ discoveryId: "d1", status: "queued", created: true });
    expect(state.enqueue).toHaveBeenCalledWith({ projectId: "proj-1", groupId: "g1", trigger: "manual" });
    expect(state.execute).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(state.execute).toHaveBeenCalledWith("d1");
  });

  it("leaves a queued run for the runner in runner mode", async () => {
    state.mode = "runner";
    state.enqueue.mockResolvedValue({ discovery: { id: "d1", status: "queued" }, created: true });
    const response = await call();
    expect(response.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(state.execute).not.toHaveBeenCalled();
  });

  it("joins a run already in flight rather than starting a second", async () => {
    state.enqueue.mockResolvedValue({ discovery: { id: "d0", status: "running" }, created: false });
    const response = await call();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ discoveryId: "d0", status: "running", created: false });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(state.execute).not.toHaveBeenCalled();
  });

  it("answers 404 for a group of another project", async () => {
    state.groupRow = null;
    expect((await call()).status).toBe(404);
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it("answers 503 and writes nothing when PostHog is not configured", async () => {
    state.posthog = false;
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reason: "posthog_unavailable" });
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    state.project = null;
    expect((await call()).status).toBe(401);
  });
});
