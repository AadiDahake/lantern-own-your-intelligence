/**
 * The one module in the web app that calls Darwin, the search engine for agents.
 *
 * Documented at https://darwin.so/docs (`POST /api/v2/search`, public with no key, `x-api-key`
 * with one). Four rules shape the call:
 *
 * - One attempt, and no redirect. A search that fails is not worth a second wait, and a redirect
 *   would carry the key header to a different host.
 * - The answer is untrusted input. Each listing is read into a checked shape, its words are
 *   cleaned and cut, and a listing that does not fit is left out. The answer is read up to a
 *   fixed size and no further, and one time limit covers the whole call, the body too.
 * - A link is never taken from the answer. The page of a listing is built here from two ids of a
 *   fixed form, on the index's own host.
 * - A failure is a short code and never the provider's own words.
 *
 * Nothing here decides what a visitor is offered. That is the gate in `lib/alternatives`.
 */
import { AGENT_SEARCH } from "@lantern/shared";
import type { AgentSearchConfig } from "./env";

/** One ranked capability of the index, as the rest of the app reads it. */
export type AgentListing = {
  /** The index's own rank, 1 first. */
  rank: number;
  agentId: string;
  capabilityId: string;
  /** The capability as the service names it. */
  name: string;
  /** The service that offers it. Empty when the answer did not name one. */
  provider: string;
  /** The service's own description, cleaned. Empty when it gave none. Never shown to a visitor. */
  description: string;
  /** The index has verified who the service is. */
  verified: boolean;
  /** The index says that work with this capability can start now. */
  startable: boolean;
  /** The index says that this capability needs a payment. */
  paid: boolean;
  /** The index's readiness word (`ready`, `unavailable`), or `unknown`. */
  readiness: string;
  /** The listing's public page, built here. */
  url: string;
};

export type AgentSearchResult =
  | { ok: true; listings: AgentListing[]; latencyMs: number }
  | { ok: false; reason: string; latencyMs: number };

/** Where a person can open one listing. */
const LISTING_BASE = "https://index.darwin.so/agent";

/** An id of the index: letters, digits and four marks. Anything else is not put into a link. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;

/** A readiness word of the index. Anything else is free text and is not kept. */
const READINESS = /^[a-z][a-z_]{0,39}$/;

/** The most listings one answer is read for, whatever it holds. */
const MAX_LISTINGS = 50;

/** The longest description that is kept. */
const DESCRIPTION_CHARS = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Words from outside as plain text: no invisible or direction-changing character, no control
 * character, one space between words, and at most `max` characters. This is the floor for each
 * text that is kept. The gate has a narrower rule for a text that a visitor sees.
 */
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // A format character (a soft hyphen, a joiner, a direction mark) has no width, so it goes with
  // no space in its place. Each other character of the "other" classes becomes a space.
  const plain = value.replace(/\p{Cf}/gu, "").replace(/\p{C}/gu, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(plain);
  return chars.length <= max ? plain : `${chars.slice(0, max - 3).join("").trimEnd()}...`;
}

/** True when the listing says that it needs a payment. An answer that does not say is not "paid". */
function needsPayment(row: Record<string, unknown>): boolean {
  const requirements = row.executionRequirements;
  const payment = isRecord(requirements) ? requirements.payment : null;
  return isRecord(payment) && payment.state === "REQUIRED";
}

function toListing(row: unknown, index: number, agents: Map<string, { name: string; verified: boolean }>): AgentListing | null {
  if (!isRecord(row)) return null;
  const { agent, capability } = row;
  if (typeof agent !== "string" || !ID.test(agent)) return null;
  if (typeof capability !== "string" || !ID.test(capability)) return null;
  const name = clean(row.name, AGENT_SEARCH.nameChars);
  if (!name) return null;
  const owner = agents.get(agent);
  const readiness = typeof row.readiness === "string" && READINESS.test(row.readiness) ? row.readiness : "unknown";
  return {
    rank: typeof row.rank === "number" && Number.isFinite(row.rank) ? row.rank : index + 1,
    agentId: agent,
    capabilityId: capability,
    name,
    provider: owner?.name ?? "",
    description: clean(row.description, DESCRIPTION_CHARS),
    verified: owner?.verified === true,
    // Both of the index's own signals must say yes. `authentication_required` is not "now".
    startable: readiness === "ready" && row.canStartThread === true,
    paid: needsPayment(row),
    readiness,
    url: `${LISTING_BASE}/${encodeURIComponent(agent)}?capability=${encodeURIComponent(capability)}`,
  };
}

/** The listings of one answer, in the index's own order, or null when it is not the index's answer. */
function toListings(answer: unknown): AgentListing[] | null {
  if (!isRecord(answer) || !Array.isArray(answer.results) || !Array.isArray(answer.agents)) return null;
  const agents = new Map<string, { name: string; verified: boolean }>();
  for (const row of answer.agents) {
    if (!isRecord(row) || typeof row.agent !== "string") continue;
    agents.set(row.agent, { name: clean(row.name, AGENT_SEARCH.providerChars), verified: row.verified === true });
  }
  const listings: AgentListing[] = [];
  answer.results.slice(0, MAX_LISTINGS).forEach((row, index) => {
    const listing = toListing(row, index, agents);
    if (listing) listings.push(listing);
  });
  // Rows that all fail the shape are a different contract, not "the index has no service".
  if (answer.results.length > 0 && listings.length === 0) return null;
  return listings;
}

const TOO_LARGE = Symbol("too large");

/** The answer body as JSON, read up to `maxBytes`. Null when it is not JSON. */
async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  try {
    const text = Buffer.concat(chunks).toString("utf8");
    // A byte order mark in front of the JSON is allowed on the wire and is not part of it.
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
  } catch {
    return null;
  }
}

/** Why a call got no answer, as a short code. It reads the error with care: an error is input too. */
function failureOf(error: unknown): string {
  try {
    const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
    const code = typeof cause?.code === "string" ? cause.code : "";
    if (code === "ERR_INVALID_URL") return "bad_api_url";
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") return "unreachable";
  } catch {
    // A getter that throws tells nothing.
  }
  return "network";
}

/**
 * Searches the index for one capability. Never throws and never repeats the call.
 *
 * `signal` lets the caller stop a search that it no longer waits for; the result is then
 * `stopped`. The time limit holds with and without it. The query is sent as it is given, so the
 * caller decides what may leave the product.
 */
export async function searchAgents(
  config: AgentSearchConfig,
  query: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AgentSearchResult> {
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers["x-api-key"] = config.apiKey;

  // One controller ends the call for both causes, and the two flags say which one it was.
  const control = new AbortController();
  let timedOut = false;
  let stopped = options.signal?.aborted === true;
  const onStop = (): void => {
    stopped = true;
    control.abort();
  };
  if (stopped) control.abort();
  else options.signal?.addEventListener("abort", onStop, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    control.abort();
  }, options.timeoutMs ?? AGENT_SEARCH.timeoutMs);

  try {
    const response = await fetchImpl(`${config.apiUrl}${AGENT_SEARCH.searchPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, numResults: AGENT_SEARCH.numResults }),
      redirect: "manual",
      signal: control.signal,
    });
    if (!response.ok) {
      // The rest of a refusal is not read, and the connection is not kept open for it.
      await response.body?.cancel().catch(() => undefined);
      const reason = response.status === 429 ? "rate_limited" : `http_${response.status}`;
      return { ok: false, reason, latencyMs: elapsed() };
    }
    const answer = await readJson(response, AGENT_SEARCH.maxAnswerBytes);
    if (answer === TOO_LARGE) return { ok: false, reason: "answer_too_large", latencyMs: elapsed() };
    const listings = toListings(answer);
    // A 200 from a different server (a wrong base address, a proxy's page) is not "no service".
    if (!listings) return { ok: false, reason: "unreadable_answer", latencyMs: elapsed() };
    return { ok: true, listings, latencyMs: elapsed() };
  } catch (error) {
    const reason = stopped ? "stopped" : timedOut ? "timeout" : failureOf(error);
    return { ok: false, reason, latencyMs: elapsed() };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onStop);
  }
}
