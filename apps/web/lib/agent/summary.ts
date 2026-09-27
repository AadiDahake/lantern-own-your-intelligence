/**
 * Closes a conversation out: how it ended, and everything the console shows about it.
 *
 * This runs after the assistant's message is stored, so a failure here costs the console a
 * detail panel and never costs the user their answer.
 */
import { EFFORT, MODELS } from "@lantern/shared";
import type { Step, Verdict } from "@lantern/shared";
import { chatJson } from "../openai";
import { serviceClient } from "../supabase";
import { deriveOutcome, reconcileOutcome, type ConversationOutcome } from "./outcome";

export type CloseInput = {
  conversationId: string;
  question: string;
  answer: string;
  steps: Step[] | null;
  verdict: Verdict;
};

/** What the model is asked for, once the untrusted answer has been coerced into shape. */
export type ConversationDetailFields = {
  summary: string;
  /** Verbatim from the user, so a product decision can be traced back to their words. */
  evidence: string[];
  nextSteps: string[];
  resolution: string;
  closeReason: string;
  /** Only ever used to promote an outcome to `product_bug`; see `reconcileOutcome`. */
  outcome: string | null;
};

const INSTRUCTION = [
  "Summarise one support exchange for the team that owns the product. Answer in JSON.",
  "summary: one sentence of at most 22 words, past tense, no greeting, no quotes.",
  "outcome: solved when the agent showed the user how to do it; product_bug when the user reported something broken, erroring or behaving wrongly; missing_feature when they asked for something the product does not have; unresolved otherwise.",
  "evidence: up to three short quotes copied word for word from the user's message that support the outcome. Copy exactly or leave the list empty.",
  "next_steps: up to three imperative sentences saying what the team should do. Empty when nothing is needed.",
  "resolution: the agent's closing answer in one sentence.",
  "close_reason: three to six words saying why the conversation ended here, such as 'user was shown the steps' or 'reported to the developers'.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    outcome: {
      type: "string",
      enum: ["solved", "product_bug", "missing_feature", "unresolved"],
    },
    evidence: { type: "array", items: { type: "string" } },
    next_steps: { type: "array", items: { type: "string" } },
    resolution: { type: "string" },
    close_reason: { type: "string" },
  },
  required: ["summary", "outcome", "evidence", "next_steps", "resolution", "close_reason"],
  additionalProperties: false,
} as const;

function line(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().replace(/^["']|["']$/g, "").slice(0, limit) : "";
}

function bullets(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => line(entry, 300))
    .filter((entry) => entry !== "")
    .slice(0, limit);
}

/**
 * Coerces the model's answer into the fields the console stores.
 *
 * Evidence is meant to be the user's own words, so anything the model did not actually copy from
 * the question is dropped rather than shown to a reader as a quote.
 */
export function parseDetail(raw: unknown, question: string): ConversationDetailFields {
  const fields = (raw ?? {}) as Record<string, unknown>;
  const haystack = question.toLowerCase();
  return {
    summary: line(fields.summary, 400),
    evidence: bullets(fields.evidence, 3).filter((quote) =>
      haystack.includes(quote.toLowerCase()),
    ),
    nextSteps: bullets(fields.next_steps, 3),
    resolution: line(fields.resolution, 400),
    closeReason: line(fields.close_reason, 80),
    outcome: typeof fields.outcome === "string" ? fields.outcome : null,
  };
}

async function describe(input: CloseInput): Promise<ConversationDetailFields> {
  const raw = await chatJson<unknown>(
    MODELS.understand,
    [
      { role: "system", content: INSTRUCTION },
      {
        role: "user",
        content: `User asked: ${input.question}\n\nAgent replied: ${input.answer}\n\nGuidance steps given: ${
          input.steps?.length ?? 0
        }\nOutcome of the checks: ${input.verdict.outcome}`,
      },
    ],
    SCHEMA as unknown as Record<string, unknown>,
    { name: "conversation_detail", effort: EFFORT.understand },
  );
  return parseDetail(raw, input.question);
}

/** Derives the outcome, writes the detail the console shows, and stores both. */
export async function closeConversation(input: CloseInput): Promise<ConversationOutcome> {
  const derived = deriveOutcome(input);
  let detail: ConversationDetailFields | null = null;
  try {
    detail = await describe(input);
  } catch {
    detail = null;
  }

  const outcome = reconcileOutcome(derived, detail?.outcome ?? null);

  await serviceClient()
    .from("conversation")
    .update({
      outcome,
      ...(detail?.summary ? { summary: detail.summary } : {}),
      ...(detail?.evidence.length ? { evidence: detail.evidence } : {}),
      ...(detail?.nextSteps.length ? { next_steps: detail.nextSteps } : {}),
      ...(detail?.resolution ? { resolution: detail.resolution } : {}),
      ...(detail?.closeReason ? { close_reason: detail.closeReason } : {}),
    })
    .eq("id", input.conversationId);

  return outcome;
}
