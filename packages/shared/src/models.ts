/**
 * OpenAI model ids, read from https://developers.openai.com/api/docs/models on 2026-08-29.
 * Every call site imports from here so a model change is one edit rather than a search across
 * the repository. The reason for each choice is in `docs/contracts.md` section 5.
 */
export const MODELS = {
  /** Fast understanding and small JSON tasks. The cheapest model of the current family. */
  understand: "gpt-5.6-luna",
  /**
   * Grounded answers with a step plan, and the continuation plan mid-guidance.
   * Both are small structured tasks over evidence that is already gathered, and
   * guidance has to keep up with the user's hand on the page.
   */
  plan: "gpt-5.6-luna",
  /** Issue drafting and code planning, where the writing has to stand on its own. */
  answer: "gpt-5.6-sol",
  /** Absence verdict. A reasoning call, run at high effort. */
  verdict: "gpt-5.6-terra",
  /** Code generation. */
  code: "gpt-5.6-sol",
  /**
   * The capability compiler's goal inference: reverse task synthesis, eight sessions per call
   * over prose the compiler already rendered.
   */
  synthesize: "gpt-5.6-luna",
  /**
   * The capability compiler's trajectory reward model and its one naming call. The reward
   * decides how many sessions count as evidence, and the small model misgraded half of them.
   */
  capability: "gpt-5.6-sol",
  /** Embeddings, 1536 dimensions. */
  embed: "text-embedding-3-small",
  /** Document reading: one vision call over a page image or a PDF. */
  ocr: "gpt-5.6-terra",
  /** Speech to text. */
  transcribe: "gpt-transcribe",
  /** Text to speech. */
  speak: "gpt-4o-mini-tts",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * How hard a reasoning model thinks before it answers. Every model in the `gpt-5.6` family is a
 * reasoning model that defaults to `medium`, so the two ends are both worth naming: the checks
 * the user waits on run low, and the one judgement that decides absence runs high.
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT: Record<
  "understand" | "plan" | "resolve" | "answer" | "verdict" | "ocr" | "synthesize" | "capability",
  ReasoningEffort
> = {
  understand: "low",
  plan: "low",
  /**
   * Choosing one control from a short list and writing three short sentences, while the user
   * waits. The fast model accepts `none` but not `minimal`.
   */
  resolve: "none",
  answer: "medium",
  verdict: "high",
  ocr: "low",
  synthesize: "low",
  capability: "medium",
};

/** Embedding width the schema and `match_chunks` are built around. */
export const EMBED_DIMENSIONS = 1536;

/** Default text to speech voice. */
export const DEFAULT_VOICE = "marin";

/**
 * Routing thresholds, overridable per project through `project.settings`.
 *
 * `docsThreshold` is the score at which a documentation passage counts without being read. It is
 * tuned on the offline set in `scripts/eval-docs.ts`, where the weakest sure answer scored 0.63
 * and the strongest passage about a capability the product lacks scored 0.49; between 0.40 and
 * this line the passage is read.
 */
export const DEFAULT_THRESHOLDS = {
  docsThreshold: 0.62,
  interfaceThreshold: 0.5,
} as const;
