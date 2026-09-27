/**
 * How a conversation ended, in the words a support lead would use.
 *
 * The rule is deliberately mechanical so the console never disagrees with the transcript:
 * guidance on the page means the user was shown what to do; a confirmed absence means the
 * product is missing something; anything else is an answer the agent could not stand behind.
 *
 * One judgement is left to the model, because it is not visible in the mechanics: whether the
 * user was reporting something broken rather than something missing.
 */
import type { Step, Verdict } from "@lantern/shared";

export type ConversationOutcome = "solved" | "product_bug" | "missing_feature" | "unresolved";

export const CONVERSATION_OUTCOMES: readonly ConversationOutcome[] = [
  "solved",
  "product_bug",
  "missing_feature",
  "unresolved",
];

export function isConversationOutcome(value: string): value is ConversationOutcome {
  return (CONVERSATION_OUTCOMES as readonly string[]).includes(value);
}

export function deriveOutcome(input: {
  steps: Step[] | null;
  verdict: Pick<Verdict, "outcome">;
}): ConversationOutcome {
  if (input.steps && input.steps.length > 0) return "solved";
  if (input.verdict.outcome === "absent") return "missing_feature";
  return "unresolved";
}

/**
 * Lets the model call a conversation a product bug, and nothing else.
 *
 * Whether a feature was found and whether guidance was shown both come out of the checks, so
 * the model does not get to reinterpret them. "The user says this is broken" is the one thing
 * only the transcript can say, and it outranks the rest: a workaround the agent found does not
 * stop the team needing to know something is failing.
 */
export function reconcileOutcome(
  derived: ConversationOutcome,
  suggested: string | null,
): ConversationOutcome {
  return suggested === "product_bug" ? "product_bug" : derived;
}

/** What one stored turn carries of the two things the mechanical rule reads. */
export type OutcomeEvidence = {
  role: string;
  steps: Step[] | null;
  verdict: Pick<Verdict, "outcome"> | null;
};

/**
 * The outcome of a conversation whose row never had one written back.
 *
 * A turn is only ever stored once the agent has answered, so the same rule applies to the
 * transcript: guidance means solved, a confirmed absence means the feature is missing, and
 * anything else is an answer nobody stood behind. Null means the agent has not replied yet,
 * which is the only state the console should call in progress. It never returns a product bug,
 * because that judgement lives on the row and a row without one never had it made.
 */
export function outcomeFromTurns(turns: readonly OutcomeEvidence[]): ConversationOutcome | null {
  const replies = turns.filter((turn) => turn.role === "assistant");
  const last = replies[replies.length - 1];
  if (!last) return null;
  return deriveOutcome({ steps: last.steps, verdict: { outcome: last.verdict?.outcome ?? "hedge" } });
}

const LABELS: Record<ConversationOutcome, string> = {
  solved: "Solved",
  product_bug: "Product bug",
  missing_feature: "Missing feature",
  unresolved: "Unresolved",
};

export function outcomeLabel(outcome: string | null): string {
  return outcome && isConversationOutcome(outcome) ? LABELS[outcome] : "In progress";
}

const TONES: Record<ConversationOutcome, string> = {
  solved: "is-good",
  product_bug: "is-bad",
  missing_feature: "is-wait",
  unresolved: "is-muted",
};

export function outcomeTone(outcome: string | null): string {
  return outcome && isConversationOutcome(outcome) ? TONES[outcome] : "is-muted";
}
