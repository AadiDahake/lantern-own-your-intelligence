import { beforeEach, describe, expect, it, vi } from "vitest";
import { EFFORT, MODELS } from "@lantern/shared";

const chatJson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/openai", () => ({ chatJson }));

import { effortFor, modelFor, openaiModelClient } from "@/lib/opportunity/model";

const PROMPT = { purpose: "trm" as const, system: "grade", user: "Session a (1 step)" };

describe("modelFor", () => {
  it("runs goal inference on the small model and the reward and naming calls on the flagship", () => {
    expect(modelFor("f_high")).toBe(MODELS.synthesize);
    expect(modelFor("trm")).toBe(MODELS.capability);
    expect(modelFor("tool_synth")).toBe(MODELS.capability);
    expect(effortFor("f_high")).toBe(EFFORT.synthesize);
    expect(effortFor("trm")).toBe(EFFORT.capability);
  });
});

describe("openaiModelClient", () => {
  beforeEach(() => chatJson.mockReset());

  it("sends the prompt as a system and a user message with the purpose as the schema name", async () => {
    chatJson.mockResolvedValueOnce({ grades: [] });
    const log = vi.fn();
    expect(await openaiModelClient({ log }).structured(PROMPT, { type: "object" })).toEqual({ grades: [] });
    expect(chatJson).toHaveBeenCalledTimes(1);
    const [model, messages, schema, options] = chatJson.mock.calls[0] as [string, { role: string; content: string }[], unknown, { name: string; effort: string }];
    expect(model).toBe(MODELS.capability);
    expect(messages).toEqual([
      { role: "system", content: "grade" },
      { role: "user", content: "Session a (1 step)" },
    ]);
    expect(schema).toEqual({ type: "object" });
    expect(options.name).toBe("trm");
    expect(options.effort).toBe(EFFORT.capability);
    expect(log).not.toHaveBeenCalled();
  });

  it("retries once when a reply does not parse, and gives up after the second failure", async () => {
    chatJson
      .mockRejectedValueOnce(new Error("OpenAI gpt-5.6-sol returned text that is not JSON: {\"grades\":["))
      .mockResolvedValueOnce({ grades: [{ session_id: "a" }] });
    const log = vi.fn();
    expect(await openaiModelClient({ log }).structured(PROMPT, {})).toEqual({ grades: [{ session_id: "a" }] });
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("trm attempt 1 failed");

    chatJson.mockReset();
    chatJson.mockRejectedValueOnce(new Error("first reply not JSON")).mockRejectedValueOnce(new Error("second reply not JSON"));
    let caught: unknown = null;
    try {
      await openaiModelClient({ log: vi.fn() }).structured(PROMPT, {});
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toBe("second reply not JSON");
    expect(chatJson).toHaveBeenCalledTimes(2);
  });
});
