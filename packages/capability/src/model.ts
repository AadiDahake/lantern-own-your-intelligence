import { readFileSync } from "node:fs";
import type { JsonSchema, ModelClient, ModelPrompt } from "./types";
import { validateAgainst } from "./validate";

/** A prompt file under `src/prompts/`, read once at load so the text in the diff is the text the model sees. */
export function loadPrompt(file: string): string {
  return readFileSync(new URL(`./prompts/${file}`, import.meta.url), "utf8").trim();
}

export class ModelOutputError extends Error {
  constructor(
    public readonly purpose: ModelPrompt["purpose"],
    public readonly errors: string[],
  ) {
    super(`Model output for ${purpose} did not match its schema: ${errors.join("; ")}`);
    this.name = "ModelOutputError";
  }
}

/**
 * One structured call, checked at the boundary. Whatever the client returns is validated against
 * the schema the prompt was given; a mismatch is an error, never a cast.
 */
export async function structuredCall<T>(
  model: ModelClient,
  prompt: ModelPrompt,
  schema: JsonSchema,
): Promise<T> {
  const raw = await model.structured(prompt, schema);
  const checked = validateAgainst<T>(raw, schema);
  if (!checked.ok) throw new ModelOutputError(prompt.purpose, checked.errors);
  return checked.value;
}

/** Run `fn` over `items` with at most `limit` in flight. Results keep the input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
