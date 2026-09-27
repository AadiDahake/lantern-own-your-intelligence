/**
 * Reads for the Conversations page: a filterable list of what the agent handled, and the full
 * transcript behind any one of them.
 */
import type {
  FeatureRequest,
  FeedbackRating,
  ProbeResult,
  RequestGroup,
  Step,
  Verdict,
} from "@lantern/shared";
import {
  CONVERSATION_OUTCOMES,
  outcomeFromTurns,
  type ConversationOutcome,
  type OutcomeEvidence,
} from "@/lib/agent/outcome";
import { loadVisitorFacts } from "@/lib/agent/memory";
import { groupsByConversation } from "@/lib/console/groups";
import { serviceClient } from "@/lib/supabase";

export type ConversationEscalation = {
  id: string;
  status: string;
  issueUrl: string | null;
  issueNumber: number | null;
  prUrl: string | null;
  prNumber: number | null;
};

export type ConversationSummary = {
  id: string;
  outcome: string | null;
  summary: string | null;
  /** Verbatim from the user, supporting the outcome. */
  evidence: string[] | null;
  nextSteps: string[] | null;
  resolution: string | null;
  closeReason: string | null;
  question: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  createdAt: string;
  messageCount: number;
  durationMs: number | null;
  escalation: ConversationEscalation | null;
};

/** What the visitor said about one answer, straight from the widget. */
export type TurnFeedback = { rating: FeedbackRating; note: string | null };

export type ConversationTurn = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  steps: Step[] | null;
  probes: ProbeResult[] | null;
  verdict: Verdict | null;
  featureRequest: FeatureRequest | null;
  feedback: TurnFeedback | null;
};

export type ConversationDetail = ConversationSummary & {
  messages: ConversationTurn[];
  /** The request this conversation was filed under, shared with everyone who asked the same. */
  group: RequestGroup | null;
  /** What the agent remembers about the visitor behind this conversation, oldest first. */
  memory: string[];
};

export type OutcomeCounts = { all: number } & Record<ConversationOutcome, number>;

const CONVERSATION_COLUMNS =
  "id, page_url, page_title, outcome, summary, evidence, next_steps, resolution, close_reason, visitor_id, created_at";

const MESSAGE_COLUMNS =
  "id, conversation_id, role, content, steps, probes, verdict, feature_request, created_at";

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function number(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** A jsonb column the model filled: a list of strings, or nothing worth showing. */
function lines(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const kept = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  return kept.length > 0 ? kept : null;
}

function toEscalation(row: Record<string, unknown>): ConversationEscalation {
  return {
    id: String(row.id),
    status: String(row.status),
    issueUrl: text(row.issue_url),
    issueNumber: number(row.issue_number),
    prUrl: text(row.pr_url),
    prNumber: number(row.pr_number),
  };
}

function toTurn(row: Record<string, unknown>): ConversationTurn {
  return {
    id: String(row.id),
    role: String(row.role),
    content: String(row.content),
    createdAt: String(row.created_at),
    steps: (row.steps ?? null) as Step[] | null,
    probes: (row.probes ?? null) as ProbeResult[] | null,
    verdict: (row.verdict ?? null) as Verdict | null,
    featureRequest: (row.feature_request ?? null) as FeatureRequest | null,
    feedback: null,
  };
}

/** The rating a visitor left on each of these messages, keyed by message id. */
async function feedbackByMessage(ids: string[]): Promise<Map<string, TurnFeedback>> {
  const found = new Map<string, TurnFeedback>();
  if (ids.length === 0) return found;

  const { data } = await serviceClient()
    .from("message_feedback")
    .select("message_id, rating, note")
    .in("message_id", ids);

  for (const row of data ?? []) {
    const rating = String(row.rating);
    if (rating !== "up" && rating !== "down") continue;
    found.set(String(row.message_id), { rating, note: text(row.note) });
  }
  return found;
}

/** The two fields the outcome rule reads, from a message row of either shape. */
function toEvidence(row: Record<string, unknown>): OutcomeEvidence {
  return {
    role: String(row.role),
    steps: (row.steps ?? null) as Step[] | null,
    verdict: (row.verdict ?? null) as Verdict | null,
  };
}

/** Wall-clock time between the first and last message, or null when there is only one. */
function spanMs(times: string[]): number | null {
  const first0 = times[0];
  const last0 = times[times.length - 1];
  if (times.length < 2 || !first0 || !last0) return null;
  const first = new Date(first0).getTime();
  const last = new Date(last0).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return null;
  return last - first;
}

async function escalationsByConversation(
  ids: string[],
): Promise<Map<string, ConversationEscalation>> {
  const found = new Map<string, ConversationEscalation>();
  if (ids.length === 0) return found;

  const { data } = await serviceClient()
    .from("escalation")
    .select("id, conversation_id, status, issue_url, issue_number, pr_url, pr_number")
    .in("conversation_id", ids)
    .order("created_at", { ascending: true });

  // One conversation can only report a feature once in practice; the newest wins if it happened.
  for (const row of data ?? []) {
    found.set(String(row.conversation_id), toEscalation(row as Record<string, unknown>));
  }
  return found;
}

/** Recent conversations, newest first, optionally narrowed to one outcome. */
export async function loadConversationSummaries(
  projectId: string,
  options: { outcome?: ConversationOutcome; limit?: number } = {},
): Promise<ConversationSummary[]> {
  const db = serviceClient();
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);

  let query = db
    .from("conversation")
    .select(CONVERSATION_COLUMNS)
    .eq("project_id", projectId);
  // Rows that never had an outcome written back still belong to whichever filter their
  // transcript puts them in, so they have to come back from the query and be sorted below.
  if (options.outcome) query = query.or(`outcome.eq.${options.outcome},outcome.is.null`);

  const { data: rows, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);

  const ids = (rows ?? []).map((row) => String(row.id));
  const questions = new Map<string, string>();
  const times = new Map<string, string[]>();
  const evidence = new Map<string, OutcomeEvidence[]>();

  if (ids.length > 0) {
    const { data: messages } = await db
      .from("message")
      .select("conversation_id, role, content, steps, verdict, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: true });

    for (const message of messages ?? []) {
      const key = String(message.conversation_id);
      times.set(key, [...(times.get(key) ?? []), String(message.created_at)]);
      evidence.set(key, [...(evidence.get(key) ?? []), toEvidence(message as Record<string, unknown>)]);
      if (message.role === "user" && !questions.has(key)) {
        questions.set(key, String(message.content));
      }
    }
  }

  const escalations = await escalationsByConversation(ids);

  const summaries = (rows ?? []).map((row) => {
    const id = String(row.id);
    const stamps = times.get(id) ?? [];
    return {
      id,
      outcome: text(row.outcome) ?? outcomeFromTurns(evidence.get(id) ?? []),
      summary: text(row.summary),
      evidence: lines(row.evidence),
      nextSteps: lines(row.next_steps),
      resolution: text(row.resolution),
      closeReason: text(row.close_reason),
      question: questions.get(id) ?? null,
      pageUrl: text(row.page_url),
      pageTitle: text(row.page_title),
      createdAt: String(row.created_at),
      messageCount: stamps.length,
      durationMs: spanMs(stamps),
      escalation: escalations.get(id) ?? null,
    };
  });

  return options.outcome
    ? summaries.filter((summary) => summary.outcome === options.outcome)
    : summaries;
}

/**
 * How many conversations sit under each filter pill.
 *
 * The stored column answers most of it in one head count each. The rows without one are read
 * out and put through the same rule the list uses, so a pill can never disagree with the
 * badge on the card it filters to.
 */
export async function loadOutcomeCounts(projectId: string): Promise<OutcomeCounts> {
  const db = serviceClient();
  const countFor = async (outcome?: ConversationOutcome): Promise<number> => {
    let query = db
      .from("conversation")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    if (outcome) query = query.eq("outcome", outcome);
    const { count } = await query;
    return count ?? 0;
  };

  const [all, perOutcome, derived] = await Promise.all([
    countFor(),
    Promise.all(CONVERSATION_OUTCOMES.map((outcome) => countFor(outcome))),
    countDerivedOutcomes(projectId),
  ]);

  const counts = { all } as OutcomeCounts;
  CONVERSATION_OUTCOMES.forEach((outcome, index) => {
    counts[outcome] = (perOutcome[index] ?? 0) + (derived[outcome] ?? 0);
  });
  return counts;
}

/** The same tally for the rows the agent never wrote an outcome back to. */
async function countDerivedOutcomes(
  projectId: string,
): Promise<Partial<Record<ConversationOutcome, number>>> {
  const db = serviceClient();
  const { data: rows } = await db
    .from("conversation")
    .select("id")
    .eq("project_id", projectId)
    .is("outcome", null);

  const ids = (rows ?? []).map((row) => String(row.id));
  if (ids.length === 0) return {};

  const { data: messages } = await db
    .from("message")
    .select("conversation_id, role, steps, verdict")
    .in("conversation_id", ids)
    .order("created_at", { ascending: true });

  const evidence = new Map<string, OutcomeEvidence[]>();
  for (const message of messages ?? []) {
    const key = String(message.conversation_id);
    evidence.set(key, [...(evidence.get(key) ?? []), toEvidence(message as Record<string, unknown>)]);
  }

  const tally: Partial<Record<ConversationOutcome, number>> = {};
  for (const id of ids) {
    const outcome = outcomeFromTurns(evidence.get(id) ?? []);
    if (outcome) tally[outcome] = (tally[outcome] ?? 0) + 1;
  }
  return tally;
}

/** One conversation with every message in order, and the escalation it produced. */
export async function loadConversationDetail(
  projectId: string,
  id: string,
): Promise<ConversationDetail | null> {
  const db = serviceClient();
  const { data: row } = await db
    .from("conversation")
    .select(CONVERSATION_COLUMNS)
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle();
  if (!row) return null;

  const { data: messages } = await db
    .from("message")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  const rows = (messages ?? []).map((message) => toTurn(message as Record<string, unknown>));
  const ratings = await feedbackByMessage(rows.map((turn) => turn.id));
  const turns = rows.map((turn) => ({ ...turn, feedback: ratings.get(turn.id) ?? null }));
  const escalation = (await escalationsByConversation([id])).get(id) ?? null;
  const group = (await groupsByConversation([id])).get(id) ?? null;
  const memory = await loadVisitorFacts(projectId, text(row.visitor_id));

  return {
    id: String(row.id),
    outcome: text(row.outcome) ?? outcomeFromTurns(turns),
    summary: text(row.summary),
    evidence: lines(row.evidence),
    nextSteps: lines(row.next_steps),
    resolution: text(row.resolution),
    closeReason: text(row.close_reason),
    question: turns.find((turn) => turn.role === "user")?.content ?? null,
    pageUrl: text(row.page_url),
    pageTitle: text(row.page_title),
    createdAt: String(row.created_at),
    messageCount: turns.length,
    durationMs: spanMs(turns.map((turn) => turn.createdAt)),
    escalation,
    group,
    messages: turns,
    memory,
  };
}
