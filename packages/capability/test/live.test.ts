/**
 * The real prompts through the real model. Skipped unless OPENAI_API_KEY is set, so the suite
 * stays offline by default. The client below is the whole of what a provider needs to supply.
 */
import { describe, expect, it } from "vitest";
import { NOVAAIR_CONTEXT, compile, type JsonSchema, type ModelClient, type ModelPrompt } from "../src";
import { family, loadFixtures, unrelated } from "./helpers";

const key = process.env.OPENAI_API_KEY;
const model = process.env.LANTERN_LIVE_MODEL ?? "gpt-5.6-luna";

class OpenAIModelClient implements ModelClient {
  readonly name = model;

  async structured(prompt: ModelPrompt, schema: JsonSchema): Promise<unknown> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        max_output_tokens: 8000,
        input: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        text: { format: { type: "json_schema", name: prompt.purpose, schema, strict: true } },
      }),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const body = (await response.json()) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> };
    const text = body.output?.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text;
    if (!text) throw new Error("no output_text in the response");
    return JSON.parse(text);
  }
}

describe.skipIf(!key)("live prompts", () => {
  it(
    "compiles a slice of the fixtures through the real model",
    async () => {
      const rows = loadFixtures();
      const slice = [...family(rows).slice(0, 12), ...unrelated(rows).slice(0, 4)];
      const result = await compile(slice, NOVAAIR_CONTEXT, new OpenAIModelClient(), {
        onEvent: (e) => console.log(`[${e.stage}] ${e.title}`),
      });
      expect(result.decision).toBe("capability");
      if (result.decision !== "capability") return;
      expect(result.ir.intent).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(result.ir.evidence.session_count).toBeGreaterThanOrEqual(10);
      expect(result.ir.granularity?.rejected_too_high).toContain("manage_trip");
      console.log(JSON.stringify({ intent: result.ir.intent, summary: result.ir.summary, inputs: result.ir.observation.inputs }, null, 2));
    },
    240_000,
  );
});
