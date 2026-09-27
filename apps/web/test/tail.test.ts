/** The terminal live view's board, fed the rows the pipeline and the forge engine write. */
import { describe, expect, it } from "vitest";
import { apply, createState, formatLogLine, parseSse, renderLines, stepFor, STEPS } from "../../../scripts/lib/tail-render.mjs";

type Row = { id: number; source: string; kind: string; status: string; title: string; detail?: unknown; createdAt: string };

const row = (over: Partial<Row>): Row => ({ id: 1, source: "forge", kind: "status", status: "ok", title: "", createdAt: "2026-08-30T01:02:03Z", ...over });

describe("stepFor", () => {
  it("maps the compiler's four stages by the event's stage, and the sandbox rows by kind", () => {
    expect(stepFor(row({ kind: "capability", detail: { stage: "workflows" } }))).toBe("workflows");
    expect(stepFor(row({ kind: "capability", detail: { stage: "intent" } }))).toBe("intent");
    expect(stepFor(row({ kind: "capability", detail: { stage: "capability" } }))).toBe("capability");
    expect(stepFor(row({ kind: "capability", detail: { stage: "verification" } }))).toBe("verification");
    expect(stepFor(row({ kind: "tool", title: "PostHog: 65 successful sessions" }))).toBe("workflows");
    expect(stepFor(row({ kind: "artifact", title: "63 replays linked" }))).toBe("workflows");
    expect(stepFor(row({ kind: "candidate", title: "Candidate A provisioning" }))).toBe("candidate");
    expect(stepFor(row({ kind: "candidate", title: "Candidate B: 21/21" }))).toBe("verify");
    expect(stepFor(row({ kind: "preview", title: "Preview live" }))).toBe("preview");
    expect(stepFor(row({ kind: "artifact", title: "Draft PR #182" }))).toBe("pr");
    expect(stepFor(row({ kind: "pause", title: "Approve & merge?" }))).toBe("approval");
    expect(stepFor(row({ kind: "probe", title: "Checked docs" }))).toBeNull();
  });
});

describe("apply and renderLines", () => {
  it("marks each stage as the rows arrive and keeps the log", () => {
    const state = createState();
    apply(state, row({ id: 10, kind: "tool", status: "running", title: "PostHog: asking" }));
    expect(state.steps.get("workflows")).toEqual({ status: "running", note: "PostHog: asking" });
    apply(state, row({ id: 11, kind: "tool", title: "PostHog: 65 successful sessions" }));
    apply(state, row({ id: 12, kind: "capability", detail: { stage: "intent" }, title: "Inferred intent: seat the party (63 sessions)" }));
    apply(state, row({ id: 13, kind: "candidate", status: "failed", title: "Candidate A: failed" }));
    expect(state.steps.get("workflows")?.status).toBe("ok");
    expect(state.steps.get("intent")?.note).toContain("Inferred intent");
    expect(state.steps.get("candidate")?.status).toBe("failed");
    expect(state.lastId).toBe(13);
    expect(state.log.length).toBe(4);

    const lines = renderLines(state, { color: false, rows: 30, width: 120, baseUrl: "http://localhost:3000" });
    expect(lines[0]).toContain("user workflows -> inferred intent -> semantic capability -> verified implementation");
    expect(lines.some((line) => line.includes("+ 1. User workflows") && line.includes("65 successful sessions"))).toBe(true);
    expect(lines.some((line) => line.includes("x    Candidates building"))).toBe(true);
    expect(lines.filter((line) => line.includes("Candidate A: failed")).length).toBe(2);
    expect(lines.length).toBeLessThanOrEqual(30);
  });

  it("lists the four story stages before the sandbox steps", () => {
    expect(STEPS.slice(0, 4).map(([key]) => key)).toEqual(["workflows", "intent", "capability", "verification"]);
  });

  it("formats a log line without colour when asked", () => {
    const line = formatLogLine(row({ source: "agent", kind: "decision", title: "63 similar sessions worked around this by hand" }), false);
    expect(line).toBe("01:02:03 agent   decision     63 similar sessions worked around this by hand");
  });
});

describe("parseSse", () => {
  it("splits complete frames and keeps a partial one for the next chunk", () => {
    const text = ": open\n\nid: 7\nevent: trace\ndata: {\"id\":7}\n\nid: 8\nevent: trace\ndata: {\"id\":8";
    const parsed = parseSse(text);
    expect(parsed.events).toEqual([{ id: 7, event: "trace", data: '{"id":7}' }]);
    expect(parsed.rest).toBe('id: 8\nevent: trace\ndata: {"id":8');
    const next = parseSse(`${parsed.rest}}\n\n`);
    expect(next.events).toEqual([{ id: 8, event: "trace", data: '{"id":8}' }]);
    expect(next.rest).toBe("");
  });
});
