/**
 * Carrying one exploration job: the row and the trace say how the run went, and a failed run
 * comes back as a row, never as a throw, so the runner that carries it keeps polling.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExploreSummary } from "@/lib/graph/explorer";
import type { ExploreJob } from "@/lib/graph/jobs";
import { runClaimedExploration } from "@/lib/graph/run-exploration";

const summary: ExploreSummary = {
  pages: 15,
  controls: 494,
  transitions: 221,
  reveals: 58,
  formsTried: 1,
  visited: ["/"],
  skipped: [],
  durationMs: 50_000,
};

const explorer = { fail: null as string | null, calls: [] as Record<string, unknown>[] };
const rows = { finished: [] as ExploreSummary[], failed: [] as string[] };
const traces: { kind: string; status?: string; title: string; detail: Record<string, unknown> }[] = [];

vi.mock("@/lib/graph/explorer", () => ({
  exploreSite: async (options: { onProgress?: (line: string) => void } & Record<string, unknown>) => {
    explorer.calls.push(options);
    options.onProgress?.("read /");
    if (explorer.fail) throw new Error(explorer.fail);
    return summary;
  },
}));

vi.mock("@/lib/graph/jobs", () => ({
  finishExploration: async (job: ExploreJob, found: ExploreSummary) => {
    rows.finished.push(found);
    return { ...job, status: "done", summary: found };
  },
  failExploration: async (job: ExploreJob, message: string) => {
    rows.failed.push(message);
    return { ...job, status: "failed", error: message };
  },
}));

vi.mock("@/lib/trace", () => ({
  emitTrace: async (event: (typeof traces)[number]) => {
    traces.push(event);
  },
}));

const job: ExploreJob = {
  id: "job-1",
  projectId: "project-1",
  siteUrl: "https://novaair.example",
  status: "running",
  summary: null,
  error: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:01.000Z",
  finishedAt: null,
};

beforeEach(() => {
  explorer.fail = null;
  explorer.calls.length = 0;
  rows.finished.length = 0;
  rows.failed.length = 0;
  traces.length = 0;
});

describe("runClaimedExploration", () => {
  it("explores the job's site, marks the row done and traces what was found", async () => {
    const lines: string[] = [];
    const result = await runClaimedExploration(job, (line) => lines.push(line));

    expect(explorer.calls).toHaveLength(1);
    expect(explorer.calls[0]).toMatchObject({ projectId: "project-1", siteUrl: "https://novaair.example" });
    expect(lines).toEqual(["read /"]);
    expect(result).toMatchObject({ id: "job-1", status: "done", summary });
    expect(rows.finished).toEqual([summary]);
    expect(rows.failed).toEqual([]);
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      projectId: "project-1",
      kind: "tool",
      title: "Explored the site",
      detail: { tool: "explorer", result_summary: "15 pages, 494 controls, 221 transitions, 58 reveals", latencyMs: 50_000 },
    });
  });

  it("answers a failed row with the explorer's own words and does not throw", async () => {
    explorer.fail = "The scanner bundle is missing. Run `npm run build -w @lantern/widget` first.";
    const result = await runClaimedExploration(job);

    expect(result).toMatchObject({ id: "job-1", status: "failed", error: explorer.fail });
    expect(rows.finished).toEqual([]);
    expect(rows.failed).toEqual([explorer.fail]);
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      kind: "error",
      status: "failed",
      title: "The site could not be explored",
      detail: { message: explorer.fail, siteUrl: "https://novaair.example" },
    });
  });
});
