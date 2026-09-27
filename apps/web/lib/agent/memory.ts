/**
 * What the agent remembers about one visitor, across conversations.
 *
 * A visitor is only ever a random id the widget keeps in its own browser. The extraction prompt
 * and the filter below keep this honest: nothing sensitive is stored. No secrets, no credentials,
 * no email addresses, no phone numbers, no payment details. Only short, durable statements about
 * who the person is at work, what they are building, and how they like to be helped.
 */
import { EFFORT, MODELS } from "@lantern/shared";
import { chatJson } from "../openai";
import { serviceClient } from "../supabase";

/** Facts loaded into a turn. Twenty is far more than any answer needs and keeps the prompt small. */
const MAX_FACTS = 20;

/** New facts one turn may add. Two keeps the agent from turning small talk into a dossier. */
const MAX_NEW_FACTS = 2;

const FACT_MAX_CHARS = 160;

const FACTS_SCHEMA = {
  type: "object",
  properties: {
    facts: { type: "array", items: { type: "string" } },
  },
  required: ["facts"],
  additionalProperties: false,
};

/** Anything that looks like a credential or a way to contact a real person never reaches the table. */
const SENSITIVE = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // email address
  /\+?\d[\d\s().-]{7,}\d/, // phone or card number
  /\b(password|passphrase|secret|api[ _-]?key|token|credit card|ssn|address)\b/i,
];

/** Exported so the guard itself is covered by a test: this is the honesty rule of the feature. */
export function isStorableFact(fact: string): boolean {
  const trimmed = fact.trim();
  if (trimmed.length < 8 || trimmed.length > FACT_MAX_CHARS) return false;
  return !SENSITIVE.some((pattern) => pattern.test(trimmed));
}

/** The visitor's facts, oldest first so the prompt reads as a history. */
export async function loadVisitorFacts(
  projectId: string,
  visitorId: string | null | undefined,
): Promise<string[]> {
  if (!visitorId) return [];
  const { data } = await serviceClient()
    .from("visitor_memory")
    .select("fact, created_at")
    .eq("project_id", projectId)
    .eq("visitor_id", visitorId)
    .order("created_at", { ascending: false })
    .limit(MAX_FACTS);
  return (data ?? []).map((row) => String(row.fact)).reverse();
}

/**
 * Asks a small model what is worth remembering about the visitor after this turn, then stores
 * whatever is new. Returns only the facts that were actually written.
 */
export async function rememberFromTurn(input: {
  projectId: string;
  visitorId: string | null | undefined;
  conversationId: string;
  question: string;
  answer: string;
  known: string[];
}): Promise<string[]> {
  const { projectId, visitorId, conversationId, question, answer, known } = input;
  if (!visitorId) return [];

  const extracted = await chatJson<{ facts: string[] }>(
    MODELS.understand,
    [
      {
        role: "system",
        content: [
          "You keep a support agent's memory of one visitor.",
          `Read the exchange and return at most ${MAX_NEW_FACTS} durable facts about the visitor that are worth remembering for a future conversation: their role, what they are working on, what they prefer, or the name they use.`,
          "Write each fact as one short third-person sentence starting with \"The visitor\".",
          "Return an empty list when the exchange says nothing durable about the person, which is the normal case.",
          "Never record anything sensitive: no passwords, keys, tokens, email addresses, phone numbers, payment details or postal addresses.",
          "Never repeat a fact that is already known.",
          "JSON only.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Already known:\n${known.length ? known.map((fact) => `- ${fact}`).join("\n") : "- nothing yet"}\n\nVisitor: ${question}\n\nAgent: ${answer}`,
      },
    ],
    FACTS_SCHEMA,
    { name: "visitor_facts", effort: EFFORT.understand },
  );

  const seen = new Set(known.map((fact) => fact.trim().toLowerCase()));
  const fresh: string[] = [];
  for (const candidate of extracted.facts ?? []) {
    const fact = String(candidate).trim();
    if (!isStorableFact(fact) || seen.has(fact.toLowerCase())) continue;
    seen.add(fact.toLowerCase());
    fresh.push(fact);
    if (fresh.length === MAX_NEW_FACTS) break;
  }
  if (fresh.length === 0) return [];

  // The unique index on (project_id, visitor_id, fact) makes a repeat a no-op rather than an error.
  const { data } = await serviceClient()
    .from("visitor_memory")
    .upsert(
      fresh.map((fact) => ({
        project_id: projectId,
        visitor_id: visitorId,
        fact,
        source_conversation_id: conversationId || null,
      })),
      { onConflict: "project_id,visitor_id,fact", ignoreDuplicates: true },
    )
    .select("fact");

  return (data ?? []).map((row) => String(row.fact));
}
