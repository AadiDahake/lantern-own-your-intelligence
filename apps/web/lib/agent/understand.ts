/**
 * The first read of a message: what kind of message it is, and what capability it is about.
 *
 * This is what stops every greeting from becoming a feature request. Only `product` and `mixed`
 * run the three checks and the absence path; `chat` and `page` are answered directly, from the
 * model and from the page the visitor is on. The classification happens before any check runs, so
 * nothing is searched for a message that was never about the product.
 *
 * The two jobs share one call because they read the same sentence: naming the capability is only
 * meaningful once the message is about one, and a second call would cost the turn its latency.
 */
import { EFFORT, MODELS } from "@lantern/shared";
import type { MessageIntent, PageContext } from "@lantern/shared";
import { chatJson } from "../openai";

export type Understanding = {
  intent: MessageIntent;
  /** The capability in the visitor's own terms. Empty for `chat` and `page`. */
  feature: string;
};

const INTENTS: readonly MessageIntent[] = ["chat", "page", "product", "mixed"];

/** Long enough for "finding three seats together", short enough to stay a name and not a sentence. */
const FEATURE_MAX_CHARS = 80;

const UNDERSTANDING_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["chat", "page", "product", "mixed"] },
    feature: { type: "string" },
  },
  required: ["intent", "feature"],
  additionalProperties: false,
};

/**
 * The classifier, with three examples of each class.
 *
 * The examples are the specification: they are what the fixtures in `test/fixtures/intents.ts`
 * hold the model to. Unsure is `mixed` rather than `chat`, because `mixed` still checks its
 * evidence before it says anything about the product.
 */
export const CLASSIFIER_PROMPT = [
  "Read one message a visitor sent to the support assistant embedded in a product page.",
  "",
  "intent: which kind of message it is.",
  '- chat: a greeting, thanks, small talk, a question about you, or general knowledge that is not about this product. Examples: "Hello, can you hear me?"; "thanks, that helped"; "what is a red-eye flight?"',
  '- page: a question the page in front of the visitor already answers from what it shows. Examples: "what time does my flight leave?"; "which seats do we have?"; "how much is the fare?"',
  '- product: a question about what this product can do or where one of its controls is. Examples: "where do I change my seat?"; "can I add a checked bag?"; "does NovaAir support seats together?"',
  '- mixed: one part is general knowledge or something this page shows, and another part asks what this product can do. Use mixed when you are not sure which class fits. Examples: "what is a red-eye, and can I book one here?"; "is 21A an aisle seat and how do I pick it?"; "my flight is delayed, what do I do?"',
  "",
  "feature: for product and mixed, the capability the visitor wants, in their own terms, in two to five words: what they want to do, not the area of the product it belongs to. For example 'finding seats together' or 'changing a seat', never 'seat selection' for both. Empty for chat and page.",
  "",
  "JSON only.",
].join("\n");

/** Anything the model did not answer with lands on `mixed`, which still checks before it speaks. */
export function coerceUnderstanding(raw: unknown): Understanding {
  const fields = (raw ?? {}) as Record<string, unknown>;
  const intent = INTENTS.find((candidate) => candidate === fields.intent) ?? "mixed";
  const feature = typeof fields.feature === "string" ? fields.feature.trim().slice(0, FEATURE_MAX_CHARS) : "";
  return { intent, feature: intent === "chat" || intent === "page" ? "" : feature };
}

/** Whether the message goes through the three checks and the absence path. */
export function needsProbes(intent: MessageIntent): boolean {
  return intent === "product" || intent === "mixed";
}

/** One call on the fast model: the class of the message, and the capability it names. */
export async function understand(question: string, page: PageContext): Promise<Understanding> {
  const raw = await chatJson<unknown>(
    MODELS.understand,
    [
      { role: "system", content: CLASSIFIER_PROMPT },
      { role: "user", content: `Page: ${page.title || "untitled"} (${page.url})\nMessage: ${question}` },
    ],
    UNDERSTANDING_SCHEMA,
    { name: "understanding", maxTokens: 2000, effort: EFFORT.understand },
  );
  return coerceUnderstanding(raw);
}
