/**
 * The agent search of one turn: started when every check came back empty, and read when the
 * answer is ready.
 *
 * The search never costs the visitor time. It runs beside the work that the turn does anyway
 * (the verdict and the drafted request), and the turn does not wait for it: an answer that is
 * ready before the search has answered goes out with no offer, and the search is stopped. It
 * also never fails a turn: each failure is an outcome with a short reason.
 *
 * An offer is made only for a confirmed absence. The search starts one step sooner, on the three
 * empty checks, because the verdict is the slowest call of that path and the time is free. When
 * the verdict then does not confirm the absence, the result is dropped and the trace says so.
 *
 * A search that started is always ended and always recorded, one time: by `take` when the answer
 * is ready, or by `abandon` when the turn ends before that.
 *
 * The search is off unless the deployment turned it on (`agentSearch` in `lib/env.ts`), and then
 * nothing leaves the product.
 */
import { searchAgents, type AgentSearchResult } from "../darwin";
import { agentSearch } from "../env";
import { gate, queryFor, type GateResult } from "./gate";

export type OutsideOutcome =
  /** The search is not configured. Nothing was sent. */
  | { state: "off"; reason: string }
  /** The capability name must not leave the product, or is too short to search by. Nothing was sent. */
  | { state: "skipped"; reason: string }
  /** The index answered, and the gate read its listings. */
  | ({ state: "done"; query: string; latencyMs: number } & GateResult)
  /** The answer was ready first, so the search was stopped. */
  | { state: "late"; query: string; waitedMs: number }
  /** The index did not give a usable answer. `reason` is a short code. */
  | { state: "failed"; query: string; reason: string; latencyMs: number }
  /** The verdict did not confirm the absence, so the result was not used. */
  | { state: "dropped"; query: string; waitedMs: number }
  /** The turn ended before it read the result: a failure in it, or a reader that left. */
  | { state: "abandoned"; query: string; waitedMs: number };

export type OutsideSearch = {
  /**
   * The outcome, at the moment the answer is ready. `wanted` is true when the verdict confirmed
   * the absence. A search that has not answered yet is stopped. Null when nothing was sent and
   * nothing was wanted, so there is nothing to record.
   */
  take(wanted: boolean): OutsideOutcome | null;
  /**
   * Ends a search whose turn ended before `take`. Null when nothing was sent, and when `take`
   * or `abandon` ran before.
   */
  abandon(): OutsideOutcome | null;
};

export type OutsideDeps = {
  configured?: ReturnType<typeof agentSearch>;
  search?: typeof searchAgents;
  /** A clock that only goes forward, in milliseconds. */
  now?: () => number;
};

/** Starts the search for one capability, when it is on and the name may leave the product. */
export function lookElsewhere(feature: string, deps: OutsideDeps = {}): OutsideSearch {
  const configured = deps.configured ?? agentSearch();
  if (!configured.configured) {
    const off: OutsideOutcome = { state: "off", reason: configured.reason };
    return { take: (wanted) => (wanted ? off : null), abandon: () => null };
  }
  const query = queryFor(feature);
  if (!query) {
    const skipped: OutsideOutcome = {
      state: "skipped",
      reason: "the capability name is not two to eight plain words, so it does not leave the product",
    };
    return { take: (wanted) => (wanted ? skipped : null), abandon: () => null };
  }

  const now = deps.now ?? (() => performance.now());
  const started = now();
  const stop = new AbortController();
  let settled: AgentSearchResult | null = null;
  let ended = false;
  // The real client never rejects. A stand-in can, and a rejection must not reach the turn.
  void (deps.search ?? searchAgents)(configured.config, query, { signal: stop.signal }).then(
    (result) => {
      settled = result;
    },
    () => {
      settled = { ok: false, reason: "network", latencyMs: Math.round(now() - started) };
    },
  );
  /** Stops a search that still runs, and says how long it had. */
  const end = (): number => {
    ended = true;
    if (!settled) stop.abort();
    return Math.round(now() - started);
  };

  return {
    take(wanted) {
      const result = settled;
      const waitedMs = end();
      if (!wanted) return { state: "dropped", query, waitedMs };
      if (!result) return { state: "late", query, waitedMs };
      if (!result.ok) return { state: "failed", query, reason: result.reason, latencyMs: result.latencyMs };
      return { state: "done", query, latencyMs: result.latencyMs, ...gate(result.listings, query) };
    },
    abandon() {
      if (ended) return null;
      return { state: "abandoned", query, waitedMs: end() };
    },
  };
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** What the gate did with one answer, as one line a person on the team can read. */
function resultSummary(result: GateResult): string {
  const { found, named, startable } = result.counts;
  const parts = [
    `${plural(found, "listing", "listings")} found`,
    `${named} named for the capability`,
    `${startable} can start now`,
    `${result.offered.length} offered`,
  ];
  const near = result.near.map(
    (listing) => `${listing.name ? `"${listing.name}"` : "a listing"} by ${listing.provider || "an unnamed service"} (${listing.why})`,
  );
  return `${parts.join(", ")}.${near.length ? ` Not offered: ${near.join("; ")}.` : ""}`;
}

type TraceRow = {
  kind: "decision" | "tool";
  status: "ok" | "failed";
  title: string;
  detail: Record<string, unknown>;
};

/**
 * The trace row for one outcome. A row for a search that ran is a `tool` row, so the console
 * shows the query and the result. No row here is of kind `status`: the console reads the newest
 * `status` row as a runner's heartbeat.
 */
export function outsideTrace(outcome: OutsideOutcome): TraceRow {
  const base = { search: "agents", state: outcome.state };
  if (outcome.state === "off") {
    return { kind: "decision", status: "ok", title: "Outside services: off", detail: { ...base, reason: outcome.reason } };
  }
  if (outcome.state === "skipped") {
    return { kind: "decision", status: "ok", title: "Outside services: not searched", detail: { ...base, reason: outcome.reason } };
  }
  const tool = { tool: "agent_search", transport: "rest", args_summary: outcome.query };
  if (outcome.state === "late") {
    return {
      kind: "tool",
      status: "failed",
      title: "Outside services: no answer in time",
      detail: { ...tool, result_summary: `The answer was ready after ${outcome.waitedMs} ms, so the search was stopped and nothing was offered.`, ...base, waitedMs: outcome.waitedMs },
    };
  }
  if (outcome.state === "dropped") {
    return {
      kind: "tool",
      status: "ok",
      title: "Outside services: not needed, the absence was not confirmed",
      detail: { ...tool, result_summary: "The verdict did not confirm the absence, so the result was not used.", ...base, waitedMs: outcome.waitedMs },
    };
  }
  if (outcome.state === "abandoned") {
    return {
      kind: "tool",
      status: "failed",
      title: "Outside services: the turn ended before the result was read",
      detail: { ...tool, result_summary: `The turn ended ${outcome.waitedMs} ms after the search started, so the search was stopped and nothing was offered.`, ...base, waitedMs: outcome.waitedMs },
    };
  }
  if (outcome.state === "failed") {
    return {
      kind: "tool",
      status: "failed",
      title: "Outside services: the search failed",
      detail: { ...tool, result_summary: `No usable answer (${outcome.reason}), so nothing was offered.`, ...base, reason: outcome.reason, latencyMs: outcome.latencyMs },
    };
  }
  const { found } = outcome.counts;
  const offered = outcome.offered.length;
  const title =
    found === 0
      ? "Outside services: none found"
      : offered === 0
        ? `Outside services: none offered of ${found} found`
        : `Outside services: ${offered} offered of ${found} found`;
  return {
    kind: "tool",
    status: "ok",
    title,
    detail: {
      ...tool,
      result_summary: resultSummary(outcome),
      ...base,
      ...outcome.counts,
      offered: outcome.offered,
      near: outcome.near,
      latencyMs: outcome.latencyMs,
    },
  };
}
