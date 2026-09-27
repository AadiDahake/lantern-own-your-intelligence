/**
 * The compiler's `ModelClient`, built on the app's one provider module.
 *
 * Goal inference runs on the small fast model. The reward model and the naming call run on the
 * flagship: on the seeded sessions the small model graded half of the completed workflows as
 * unfinished, and the reward is what decides how many sessions count as evidence. Every reply is
 * validated by the compiler against the schema it passed, so nothing here casts.
 */
import type { JsonSchema, ModelClient, ModelPrompt } from "@lantern/capability";
import { EFFORT, MODELS } from "@lantern/shared";
import { chatJson } from "../openai";

/** Reasoning tokens count against the budget, so it sits well above the size of any answer. */
const MAX_OUTPUT_TOKENS = 24_000;

/**
 * One retry per call. A reply that fails to parse is one bad generation (a model that finished
 * its JSON and then ran on until the budget), not a bad prompt, and a second attempt is cheap
 * next to failing a whole discovery. The compiler validates whatever comes back.
 */
const ATTEMPTS = 2;

export function modelFor(purpose: ModelPrompt["purpose"]): string {
  return purpose === "f_high" ? MODELS.synthesize : MODELS.capability;
}

export function effortFor(purpose: ModelPrompt["purpose"]) {
  return purpose === "f_high" ? EFFORT.synthesize : EFFORT.capability;
}

export function openaiModelClient(options: { log?: (line: string) => void } = {}): ModelClient {
  const log = options.log ?? ((line: string) => console.warn(line));
  return {
    name: `${MODELS.synthesize} (synthesis), ${MODELS.capability} (reward, naming)`,
    async structured(prompt: ModelPrompt, schema: JsonSchema): Promise<unknown> {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        try {
          return await chatJson<unknown>(
            modelFor(prompt.purpose),
            [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            schema,
            {
              name: prompt.purpose,
              maxTokens: MAX_OUTPUT_TOKENS,
              effort: effortFor(prompt.purpose),
            },
          );
        } catch (error) {
          lastError = error;
          if (attempt < ATTEMPTS) {
            log(`${prompt.purpose} attempt ${attempt} failed, retrying: ${(error as Error).message.slice(0, 160)}`);
          }
        }
      }
      throw lastError;
    },
  };
}
