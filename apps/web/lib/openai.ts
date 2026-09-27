/**
 * The one place the app talks to a model provider.
 *
 * Every model call in `apps/web` goes through this module: chat with JSON-schema structured
 * output, embeddings, document reading, speech to text and text to speech. The model ids live in
 * `@lantern/shared` so a change is one edit; the calls live here so the provider stays swappable.
 *
 * Structured output uses the Responses API, which the OpenAI documentation presents as the current
 * primary API for it. See `docs/contracts.md` section 5.
 */
import OpenAI from "openai";
import { DEFAULT_VOICE, EMBED_DIMENSIONS, MODELS } from "@lantern/shared";
import type { ReasoningEffort } from "@lantern/shared";
import { openaiApiKey } from "./env";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** A JSON Schema object describing the shape a structured call must return. */
export type JsonSchema = Record<string, unknown>;

export type ChatOptions = {
  maxTokens?: number;
  /** How hard the model thinks first. Omitted leaves the model on its own default. */
  effort?: ReasoningEffort;
};

let cached: OpenAI | null = null;

/**
 * The client is built on first use, never at import time, so a missing key fails the one request
 * that needed it rather than the whole server at boot.
 */
export function client(): OpenAI {
  if (cached === null) cached = new OpenAI({ apiKey: openaiApiKey() });
  return cached;
}

/** Only for tests, which build their own client against a stub. */
export function resetClient(): void {
  cached = null;
}

/**
 * Reasoning models put thinking items in the output alongside the text, so every reader goes
 * through the SDK's flattened `output_text` rather than reaching into the items itself.
 */
function readText(response: { output_text?: string | null }): string {
  return response.output_text ?? "";
}

/** Plain text completion. */
export async function chatText(
  model: string,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const response = await client().responses.create({
    model,
    input: messages,
    ...(options.maxTokens ? { max_output_tokens: options.maxTokens } : {}),
    ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
  });
  return readText(response);
}

/**
 * Structured completion. The schema is enforced by the API, but the result is still model output,
 * so callers validate the parsed value before trusting its shape.
 */
export async function chatJson<T>(
  model: string,
  messages: ChatMessage[],
  schema: JsonSchema,
  options: ChatOptions & { name?: string } = {},
): Promise<T> {
  const response = await client().responses.create({
    model,
    input: messages,
    ...(options.maxTokens ? { max_output_tokens: options.maxTokens } : {}),
    ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
    text: {
      format: {
        type: "json_schema",
        name: options.name ?? "result",
        schema: schema as Record<string, unknown>,
        strict: true,
      },
    },
  });
  const text = readText(response);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`OpenAI ${model} returned text that is not JSON: ${text.slice(0, 200)}`);
  }
}

/** Embeds a batch of texts. Asserts the width the schema and `match_chunks` are built around. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await client().embeddings.create({
    model: MODELS.embed,
    input: texts,
    dimensions: EMBED_DIMENSIONS,
  });
  const vectors = (response.data ?? []).map((entry) => entry.embedding);

  if (vectors.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, received ${vectors.length}`);
  }
  return vectors.map((vector, index) => {
    if (!Array.isArray(vector) || vector.length !== EMBED_DIMENSIONS) {
      const width = Array.isArray(vector) ? vector.length : "none";
      throw new Error(`Embedding ${index} has width ${width}, expected ${EMBED_DIMENSIONS}`);
    }
    return vector as number[];
  });
}

export type OcrBlock = {
  /** What the reader thought this region is: "title", "text", "table", and so on. */
  type: string;
  /** The region's own markdown, so a low-confidence block can be shown on its own. */
  content: string;
  confidence: number | null;
};
export type OcrPage = {
  index: number;
  markdown: string;
  confidence: number | null;
  blocks: OcrBlock[];
};
export type OcrResult = { pages: OcrPage[] };

/**
 * How legible the reader found what it transcribed, 0 to 1.
 *
 * The documentation probe damps a passage's score by this number, so a blurry scan cannot outvote
 * clean text. The reader reports it per page and per block as part of its structured answer.
 */
const CONFIDENCE_RULE =
  "For every page and every block also report `confidence`, from 0 to 1: how legible that region " +
  "was to you. Use 1.0 for text you read with no doubt at all, 0.5 where you had to guess at " +
  "words, and below 0.3 where the region is mostly unreadable. Never round every block to 1.0.";

const OCR_SYSTEM =
  "You read a document and transcribe it. Return every page in order. For each page give the " +
  "whole page as markdown, preserving headings, lists and tables, and also split it into the " +
  "blocks it is made of, each with the type of region it is (title, text, list, table, caption, " +
  "figure). Transcribe only what is there; never summarise, never add a word that is not on the " +
  `page. ${CONFIDENCE_RULE} JSON only.`;

const OCR_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          markdown: { type: "string" },
          confidence: { type: "number" },
          blocks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                content: { type: "string" },
                confidence: { type: "number" },
              },
              required: ["type", "content", "confidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["index", "markdown", "confidence", "blocks"],
        additionalProperties: false,
      },
    },
  },
  required: ["pages"],
  additionalProperties: false,
};

/** A number the model produced, clamped into the range the probe expects, or null when it is not one. */
function confidenceOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * Reads a document supplied as a data URL.
 *
 * The API takes a PDF directly, page text and page images together, so there is no page rendering
 * step here; an image is sent as an image. Both go to the same vision model and come back in the
 * same shape.
 */
export async function ocr(dataUrl: string): Promise<OcrResult> {
  const isPdf = dataUrl.startsWith("data:application/pdf");
  const file = isPdf
    ? ({ type: "input_file", filename: "document.pdf", file_data: dataUrl } as const)
    : ({ type: "input_image", image_url: dataUrl, detail: "high" } as const);

  const response = await client().responses.create({
    model: MODELS.ocr,
    input: [
      { role: "system", content: OCR_SYSTEM },
      { role: "user", content: [file, { type: "input_text", text: "Transcribe this document." }] },
    ],
    text: {
      format: { type: "json_schema", name: "document", schema: OCR_SCHEMA, strict: true },
    },
  });

  const text = readText(response);
  let payload: { pages?: unknown };
  try {
    payload = JSON.parse(text) as { pages?: unknown };
  } catch {
    throw new Error(`OpenAI ${MODELS.ocr} returned text that is not JSON: ${text.slice(0, 200)}`);
  }
  const pages = Array.isArray(payload.pages) ? payload.pages : [];

  return {
    pages: pages.map((raw, index) => {
      const page = (raw ?? {}) as Record<string, unknown>;
      const blocks = Array.isArray(page.blocks) ? page.blocks : [];
      return {
        index: typeof page.index === "number" ? page.index : index,
        markdown: typeof page.markdown === "string" ? page.markdown : "",
        confidence: confidenceOf(page.confidence),
        blocks: blocks.map((rawBlock) => {
          const block = (rawBlock ?? {}) as Record<string, unknown>;
          return {
            type: typeof block.type === "string" ? block.type : "text",
            content: typeof block.content === "string" ? block.content : "",
            confidence: confidenceOf(block.confidence),
          };
        }),
      };
    }),
  };
}

/** Transcribes an audio file. */
export async function transcribe(file: Blob, filename = "audio.webm"): Promise<string> {
  const result = await client().audio.transcriptions.create({
    model: MODELS.transcribe,
    file: new File([file], filename, { type: file.type || "audio/webm" }),
  });
  return typeof result.text === "string" ? result.text : "";
}

/**
 * Streams speech as mp3 bytes. The API answers with chunked audio, so yielding each chunk as it
 * lands lets the caller start playing before the whole utterance has been synthesised.
 */
export async function* speakStream(
  text: string,
  voice: string = DEFAULT_VOICE,
): AsyncGenerator<Uint8Array> {
  const response = await client().audio.speech.create({
    model: MODELS.speak,
    input: text,
    voice,
    response_format: "mp3",
  });
  if (!response.body) throw new Error("OpenAI /audio/speech returned no body");

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) yield value;
  }
}

/** Liveness check used by `/api/health`. */
export async function listModels(): Promise<boolean> {
  const page = await client().models.list();
  return Array.isArray(page.data);
}
