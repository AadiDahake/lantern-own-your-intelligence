/**
 * The answers that need no checks: small talk, and what the page already says.
 *
 * A greeting is not a support request, and a question the page in front of the visitor answers is
 * not a search of the documentation. Both are answered here, in one call on the fast model, and
 * neither ever offers to report anything.
 *
 * Safety is in the prompts and is the same rule three times: use what is in front of you, name no
 * control this product may not have, and say plainly when the answer is not there. A capability
 * of the product is never asserted from these answers; that is what the probes are for.
 */
import { EFFORT, MODELS } from "@lantern/shared";
import type { PageContext } from "@lantern/shared";
import { chatJson } from "../openai";
import { affordanceList, pageText, visibleAffordances } from "./page";
import type { DocsEvidence } from "./probes";

/** Two friendly sentences, and the room a long one needs. Anything past this is not an answer. */
const ANSWER_MAX_CHARS = 600;

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    found: { type: "boolean" },
  },
  required: ["answer", "found"],
  additionalProperties: false,
};

export type DirectAnswer = {
  text: string;
  /** Whether the answer actually answers. False when the page or the passage did not say. */
  answered: boolean;
  latencyMs: number;
};

const CHAT_SYSTEM = [
  "You are the support assistant embedded in a company's web page.",
  "The visitor's message is not a question about what this product can do: it is a greeting, thanks, small talk, a question about you, or general knowledge.",
  "Answer it directly in one or two short, friendly sentences, from what you know and what the page in front of them says.",
  "Never say this product has a feature, never name one of its buttons or pages, and never offer to report anything to anyone.",
  "Say plainly when you do not know, and set found false then.",
  "JSON only.",
].join(" ");

const PAGE_SYSTEM = [
  "You are the support assistant embedded in a company's web page.",
  "Answer the visitor's question using only the page text and the controls listed below. Add nothing from anywhere else, and cite nothing else.",
  "Answer in one or two short sentences and give the value the page shows.",
  "If the page does not show the answer, set found false and say plainly that you cannot see it on this page.",
  "Never name a control that is not in the list, never invent a value, and never offer to report anything.",
  "JSON only.",
].join(" ");

const PASSAGE_SYSTEM = [
  "You are the support assistant embedded in a company's web page.",
  "Answer the visitor's question using only the documentation passages below, and name the article you used.",
  "Answer in one or two short sentences. Do not say the product can do anything the passages do not state.",
  "If the passages do not answer the question, set found false and return an empty answer.",
  "JSON only.",
].join(" ");

/** The remembered facts as a prompt block, empty when this is a first visit. */
function memoryBlock(memory: string[]): string {
  if (memory.length === 0) return "";
  return `\n\nWhat we know about this visitor:\n${memory.map((fact) => `- ${fact}`).join("\n")}`;
}

function coerce(raw: unknown): { text: string; answered: boolean } {
  const fields = (raw ?? {}) as Record<string, unknown>;
  const text = typeof fields.answer === "string" ? fields.answer.trim().slice(0, ANSWER_MAX_CHARS) : "";
  return { text, answered: fields.found === true && text !== "" };
}

/** What the page says, as the model reads it: its own words, then the controls on it. */
function pageBlock(page: PageContext): string {
  const text = pageText(page);
  return [
    `Page: ${page.title || "untitled"} (${page.url})`,
    `What the page says:\n${text || "nothing the scanner could read"}`,
    `Controls on this page:\n${affordanceList(visibleAffordances(page))}`,
  ].join("\n\n");
}

/** Small talk, a question about the assistant, or general knowledge. No checks, no offer. */
export async function answerChat(input: {
  question: string;
  page: PageContext;
  memory: string[];
}): Promise<DirectAnswer> {
  const started = Date.now();
  const raw = await chatJson<unknown>(
    MODELS.understand,
    [
      { role: "system", content: CHAT_SYSTEM },
      {
        role: "user",
        content: `Message: ${input.question}${memoryBlock(input.memory)}\n\n${pageBlock(input.page)}`,
      },
    ],
    ANSWER_SCHEMA,
    { name: "chat_answer", maxTokens: 2000, effort: EFFORT.understand },
  );
  const { text, answered } = coerce(raw);
  return {
    text: text || "I am not sure about that one, but ask me anything about this page and I will help.",
    answered,
    latencyMs: Date.now() - started,
  };
}

/**
 * What a page answer says when the page turns out not to say it.
 *
 * The visitor asked something real, so a dead end is the wrong ending. This invites the question
 * the product path answers well, and names no control of its own.
 */
const ASK_AGAIN = "Ask me how to do it here and I will show you the way.";

/** A question the page in front of the visitor answers, answered from that page alone. */
export async function answerFromPage(input: {
  question: string;
  page: PageContext;
  memory: string[];
}): Promise<DirectAnswer> {
  const started = Date.now();
  const raw = await chatJson<unknown>(
    MODELS.understand,
    [
      { role: "system", content: PAGE_SYSTEM },
      {
        role: "user",
        content: `Question: ${input.question}${memoryBlock(input.memory)}\n\n${pageBlock(input.page)}`,
      },
    ],
    ANSWER_SCHEMA,
    { name: "page_answer", maxTokens: 3000, effort: EFFORT.understand },
  );
  const { text, answered } = coerce(raw);
  if (answered) return { text, answered, latencyMs: Date.now() - started };
  return {
    text: `${text || "I cannot see the answer to that on this page."} ${ASK_AGAIN}`,
    answered,
    latencyMs: Date.now() - started,
  };
}

/**
 * What the documentation says about a question whose exact feature turned out to be missing.
 *
 * This is the `mixed` case: the visitor asked something general and something about the product in
 * one breath. The general half often has an answer in the help center even when the product half
 * does not, and reading it out first is more use than an apology on its own. Empty when the
 * passages do not answer, and then the absence stands alone.
 */
export async function answerFromPassage(input: {
  question: string;
  docs: DocsEvidence[];
}): Promise<DirectAnswer> {
  const started = Date.now();
  if (input.docs.length === 0) return { text: "", answered: false, latencyMs: 0 };
  const passages = input.docs.slice(0, 2).map((entry) => ({
    article: entry.documentTitle,
    heading: entry.heading,
    passage: entry.snippet.slice(0, 400),
  }));
  const raw = await chatJson<unknown>(
    MODELS.understand,
    [
      { role: "system", content: PASSAGE_SYSTEM },
      { role: "user", content: `Question: ${input.question}\n\nPassages:\n${JSON.stringify(passages)}` },
    ],
    ANSWER_SCHEMA,
    { name: "passage_answer", maxTokens: 2000, effort: EFFORT.understand },
  );
  const { text, answered } = coerce(raw);
  return { text: answered ? text : "", answered, latencyMs: Date.now() - started };
}
