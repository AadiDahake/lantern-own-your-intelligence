// The terminal live view's state and rendering, with no I/O, so it can be tested.
//
// A trace row lands in one of the stages below through `stepFor`. The board shows the four
// stages of the story first, in order, then the sandbox steps of the forge run; the log under
// it shows every row as it arrives.

export const STEPS = [
  ["workflows", "1. User workflows", "PostHog sessions, rendered as steps"],
  ["intent", "2. Inferred intent", "OS-Genesis: reverse task synthesis, trajectory reward"],
  ["capability", "3. Semantic capability", "ToolCUA: granularity; ASIL: the interface shape"],
  ["verification", "4. Verified implementation", "the scenarios the verifier runs"],
  ["candidate", "   Candidates building", "two sandboxes, three personas each"],
  ["verify", "   Verification", "the repository's own tests, per scenario"],
  ["preview", "   Sandbox preview", "the winner, served and health-checked"],
  ["pr", "   Draft PR", "the branch pushed, the pull request opened"],
  ["approval", "   Human approval", "nothing merges without it"],
];

export const ANSI = {
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  accent: "\x1b[38;5;29m",
  good: "\x1b[32m",
  bad: "\x1b[31m",
  lane: { agent: "\x1b[36m", workflow: "\x1b[35m", forge: "\x1b[33m" },
};

const MARK = { pending: "  ", running: "* ", ok: "+ ", failed: "x " };

/** Which board step a trace row belongs to, or null for rows that only go to the log. */
export function stepFor(event) {
  const title = event.title ?? "";
  if (event.kind === "capability") {
    const stage = event.detail && typeof event.detail === "object" ? event.detail.stage : null;
    if (stage === "workflows" || stage === "intent" || stage === "capability" || stage === "verification") return stage;
    return "capability";
  }
  if (event.kind === "tool" && title.startsWith("PostHog")) return "workflows";
  if (event.kind === "artifact" && /replays? linked$/.test(title)) return "workflows";
  if (event.kind === "artifact" && title.startsWith("Capability specification")) return "capability";
  if (event.kind === "candidate") return /\d+\/\d+/.test(title) ? "verify" : "candidate";
  if (event.kind === "decision" && title.startsWith("Selected candidate")) return "verify";
  if (event.kind === "preview") return "preview";
  if (event.kind === "artifact" && title.startsWith("Draft PR")) return "pr";
  if (event.kind === "tool" && title.startsWith("Pushed ")) return "pr";
  if (event.kind === "pause") return "approval";
  if (event.kind === "decision" && /^A developer (approved|rejected)/.test(title)) return "approval";
  if (event.kind === "status" && /^Status: (shipped|rejected|merging)/.test(title)) return "approval";
  return null;
}

/** A fresh board: every step pending, an empty log. */
export function createState() {
  return {
    steps: new Map(STEPS.map(([key]) => [key, { status: "pending", note: "" }])),
    log: [],
    lastId: 0,
    connection: "connecting",
  };
}

function statusOf(event) {
  if (event.status === "failed") return "failed";
  if (event.status === "running") return "running";
  return "ok";
}

/** Folds one trace row into the state: the board step it maps to, and the log line. */
export function apply(state, event) {
  const key = stepFor(event);
  if (key) {
    const step = state.steps.get(key);
    const next = statusOf(event);
    // A stage that already failed stays failed until a later row for it succeeds outright.
    step.status = next;
    step.note = event.title;
  }
  if (typeof event.id === "number" && event.id > state.lastId) state.lastId = event.id;
  state.log.push(event);
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
  return state;
}

export function formatClock(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "        " : date.toISOString().slice(11, 19);
}

/** One log line: clock, lane, kind, title. `color` false gives plain text. */
export function formatLogLine(event, color = true) {
  const a = color ? ANSI : { dim: "", reset: "", bold: "", accent: "", good: "", bad: "", lane: {} };
  const lane = (color && ANSI.lane[event.source]) || "";
  const status = event.status === "failed" ? `${a.bad}x ` : event.status === "running" ? `${a.accent}* ` : "  ";
  return `${a.dim}${formatClock(event.createdAt)}${a.reset} ${lane}${String(event.source ?? "").padEnd(8)}${a.reset}${a.dim}${String(event.kind ?? "").padEnd(11)}${a.reset}${status}${event.title ?? ""}${a.reset}`;
}

/** The whole screen as lines: header, board, rule, the tail of the log that fits. */
export function renderLines(state, options = {}) {
  const color = options.color ?? true;
  const rows = options.rows ?? 40;
  const width = options.width ?? 100;
  const a = color ? ANSI : { dim: "", reset: "", bold: "", accent: "", good: "", bad: "", lane: {} };
  const lines = [];
  lines.push(`${a.bold}${a.accent}lantern${a.reset} ${a.bold}opportunity${a.reset}   ${a.dim}user workflows -> inferred intent -> semantic capability -> verified implementation${a.reset}`);
  lines.push(`${a.dim}${options.baseUrl ?? ""}  ${state.connection}${a.reset}`);
  lines.push("");
  for (const [key, label, hint] of STEPS) {
    const step = state.steps.get(key);
    const tone = step.status === "ok" ? a.good : step.status === "failed" ? a.bad : step.status === "running" ? a.accent : a.dim;
    const note = step.note ? `  ${a.dim}${step.note}${a.reset}` : `  ${a.dim}${hint}${a.reset}`;
    lines.push(`  ${tone}${MARK[step.status]}${label.padEnd(30)}${a.reset}${note}`);
  }
  lines.push("");
  lines.push(`${a.dim}${"-".repeat(Math.max(20, Math.min(width, 120)))}${a.reset}`);
  const room = Math.max(3, rows - lines.length - 1);
  for (const event of state.log.slice(-room)) lines.push(formatLogLine(event, color));
  return lines.map((line) => (line.length > width * 2 ? line.slice(0, width * 2) : line));
}

/**
 * Splits raw SSE text into frames. Returns the parsed events and the unconsumed remainder, so a
 * chunk that ends mid-frame waits for the rest.
 */
export function parseSse(buffer) {
  const events = [];
  let rest = buffer;
  let index;
  while ((index = rest.indexOf("\n\n")) !== -1) {
    const frame = rest.slice(0, index);
    rest = rest.slice(index + 2);
    let id = null;
    let name = "message";
    const data = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("id:")) id = Number(line.slice(3).trim());
      else if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) continue;
    events.push({ id, event: name, data: data.join("\n") });
  }
  return { events, rest };
}
