/**
 * The first read of a message, offline.
 *
 * The model's answer is untrusted like any other, so what is tested here is the coercion, the
 * fallback that keeps an unsure message on the path that checks its evidence, and the prompt
 * carrying three examples of every class. The classification itself is measured against the real
 * model in `understand.live.test.ts`, which skips itself without a key.
 */
import { describe, expect, it, vi } from "vitest";
import type { MessageIntent } from "@lantern/shared";
import { INTENT_FIXTURES, TRIP_PAGE } from "./fixtures/intents";

type Call = { model: string; messages: { role: string; content: string }[]; schema: Record<string, unknown>; options: { name?: string } };
const calls: Call[] = [];
let answer: unknown = { intent: "product", feature: "changing a seat" };

vi.mock("@/lib/openai", () => ({
  chatJson: async (
    model: string,
    messages: { role: string; content: string }[],
    schema: Record<string, unknown>,
    options: { name?: string },
  ) => {
    calls.push({ model, messages, schema, options });
    return answer;
  },
}));

const { CLASSIFIER_PROMPT, coerceUnderstanding, needsProbes, understand } = await import("@/lib/agent/understand");

describe("the intent fixtures", () => {
  it("cover every class, with the message that started this", () => {
    const counts = new Map<MessageIntent, number>();
    for (const fixture of INTENT_FIXTURES) {
      counts.set(fixture.intent, (counts.get(fixture.intent) ?? 0) + 1);
    }
    expect(INTENT_FIXTURES.length).toBeGreaterThanOrEqual(12);
    for (const intent of ["chat", "page", "product", "mixed"] as const) {
      expect(counts.get(intent) ?? 0).toBeGreaterThanOrEqual(3);
    }
    expect(INTENT_FIXTURES.find((fixture) => fixture.message === "Hello, can you hear me?")?.intent).toBe("chat");
  });

  it("does not reuse the prompt's own examples, so the live suite measures more than recall", () => {
    const reused = INTENT_FIXTURES.filter(
      (fixture) => fixture.message !== "Hello, can you hear me?" && CLASSIFIER_PROMPT.includes(fixture.message),
    );
    expect(reused).toEqual([]);
  });
});

describe("the classifier prompt", () => {
  it("gives three examples of each class", () => {
    for (const intent of ["chat", "page", "product", "mixed"] as const) {
      const line = CLASSIFIER_PROMPT.split("\n").find((entry) => entry.startsWith(`- ${intent}:`));
      expect(line, `no line for ${intent}`).toBeTruthy();
      expect(line!.split('"').length - 1, `${intent} needs three quoted examples`).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("coerceUnderstanding", () => {
  it("keeps each of the four classes", () => {
    for (const intent of ["chat", "page", "product", "mixed"] as const) {
      expect(coerceUnderstanding({ intent, feature: "changing a seat" }).intent).toBe(intent);
    }
  });

  it("falls back to mixed, which still checks before it speaks", () => {
    expect(coerceUnderstanding({ intent: "howto", feature: "x" }).intent).toBe("mixed");
    expect(coerceUnderstanding({}).intent).toBe("mixed");
    expect(coerceUnderstanding(null).intent).toBe("mixed");
    expect(needsProbes(coerceUnderstanding(null).intent)).toBe(true);
  });

  it("keeps no capability name on a message that is not about one", () => {
    expect(coerceUnderstanding({ intent: "chat", feature: "changing a seat" }).feature).toBe("");
    expect(coerceUnderstanding({ intent: "page", feature: "changing a seat" }).feature).toBe("");
  });

  it("trims the capability and caps its length", () => {
    expect(coerceUnderstanding({ intent: "product", feature: "  changing a seat \n" }).feature).toBe("changing a seat");
    expect(coerceUnderstanding({ intent: "product", feature: "x".repeat(200) }).feature).toHaveLength(80);
    expect(coerceUnderstanding({ intent: "product", feature: 7 }).feature).toBe("");
  });
});

describe("needsProbes", () => {
  it("is true only for the classes that ask what the product can do", () => {
    expect(needsProbes("product")).toBe(true);
    expect(needsProbes("mixed")).toBe(true);
    expect(needsProbes("chat")).toBe(false);
    expect(needsProbes("page")).toBe(false);
  });
});

describe("understand", () => {
  it("sends the message and the page, and asks for one of the four classes", async () => {
    calls.length = 0;
    answer = { intent: "chat", feature: "" };
    const result = await understand("Hello, can you hear me?", TRIP_PAGE);

    expect(result).toEqual({ intent: "chat", feature: "" });
    const call = calls[0]!;
    expect(call.options.name).toBe("understanding");
    expect(call.messages[0]!.content).toBe(CLASSIFIER_PROMPT);
    expect(call.messages[1]!.content).toContain("Hello, can you hear me?");
    expect(call.messages[1]!.content).toContain("Manage Trip | NovaAir");
    const intent = (call.schema.properties as { intent: { enum: string[] } }).intent;
    expect(intent.enum).toEqual(["chat", "page", "product", "mixed"]);
  });
});
