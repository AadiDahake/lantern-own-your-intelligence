/**
 * The mid-walk continuation asks the trained River guide for the next control first, and OpenAI
 * when the guide is off or gives no usable answer. Each case checks the path the step came from
 * and the one trace event that says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageContext, Step } from "@lantern/shared";
import { MODELS } from "@lantern/shared";
import { continueGuidance, type ContinueInput } from "@/lib/agent/continue";
import type { GuideRunner } from "@/lib/guide/provider";

const openaiCalls: string[] = [];
const traces: { kind: string; title: string; detail: Record<string, unknown> }[] = [];

vi.mock("@/lib/openai", () => ({
  chatJson: async (_model: string, _messages: unknown, _schema: unknown, options: { name?: string }) => {
    openaiCalls.push(options.name ?? "");
    return { steps: [{ target: "a3", caption: "Select Confirm seats", advanceOn: "click" }] };
  },
}));

vi.mock("@/lib/trace", () => ({
  emitTrace: async (event: { kind: string; title: string; detail: Record<string, unknown> }) => {
    traces.push(event);
  },
}));

// The walk the visitor started: one step done, and no graph identity, so the continuation reads
// the page instead of the product map.
const previousSteps: Step[] = [
  { target: "a1", caption: "Select the Passenger 2 (adult) tab", advanceOn: "click" },
  { target: "a9", caption: "Select Seat 6D", advanceOn: "click" },
];

class FakeQuery {
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  async maybeSingle(): Promise<{ data: Record<string, unknown>; error: null }> {
    return { data: { content: "Pick a seat next to your partner.", steps: previousSteps, grounding: null }, error: null };
  }
}

vi.mock("@/lib/supabase", () => ({ serviceClient: () => ({ from: () => new FakeQuery() }) }));

const page: PageContext = {
  url: "https://novaair.example/trips/ABC123/seats",
  title: "Choose seats | NovaAir",
  affordances: [
    { id: "a1", role: "tab", name: "Passenger 2 (adult)", visible: true, state: "selected" },
    { id: "a2", role: "button", name: "Seat 6E", visible: true, state: "available" },
    { id: "a3", role: "button", name: "Confirm seats", visible: true },
  ],
};

const input: ContinueInput = {
  projectId: "project-1",
  conversationId: "conversation-1",
  question: "Seat us together",
  page,
  continueFrom: 1,
};

const CHECKPOINT = "river://run/weights/guide-inf";
const reply = (answer: string) => JSON.stringify({ answer, checkpoint: CHECKPOINT, base_model: "Qwen/Qwen3.8-27B-FP8" });

const riverTraces = () => traces.filter((t) => t.title.includes("River guide model"));

beforeEach(() => {
  openaiCalls.length = 0;
  traces.length = 0;
  vi.stubEnv("RIVER_API_KEY", "test-key");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("continueGuidance with the River guide", () => {
  it("takes the next step from River when it names a control on the page", async () => {
    const runner = vi.fn<GuideRunner>(async () => reply('{"action": "press", "id": "a2"}'));
    const result = await continueGuidance(input, { guideRunner: runner });

    expect(result.steps).toEqual([{ target: "a2", caption: "Select Seat 6E", advanceOn: "click" }]);
    expect(result.routeChanged).toBe(true);
    expect(openaiCalls).toEqual([]);
    expect(riverTraces()).toHaveLength(1);
    expect(riverTraces()[0]).toMatchObject({
      kind: "model",
      title: `Next step chosen by the River guide model (checkpoint ${CHECKPOINT})`,
    });
    expect(traces.at(-1)?.detail.model).toBe(`River guide ${CHECKPOINT}`);

    // The input has the shape the guide was trained on: the goal, the names walked, the controls.
    const [sent, timeoutMs] = runner.mock.calls[0]!;
    expect(timeoutMs).toBe(8_000);
    expect(JSON.parse(sent)).toEqual({
      question: "Seat us together",
      walked: ["Select the Passenger 2 (adult) tab"],
      controls: [
        { id: "a1", role: "tab", name: "Passenger 2 (adult)", state: "selected" },
        { id: "a2", role: "button", name: "Seat 6E", state: "available" },
        { id: "a3", role: "button", name: "Confirm seats" },
      ],
    });
  });

  it("falls back to OpenAI when River names a control that is not on the page", async () => {
    const runner: GuideRunner = async () => reply('{"action": "press", "id": "a9"}');
    const result = await continueGuidance(input, { guideRunner: runner });

    expect(result.steps?.[0]?.target).toBe("a3");
    expect(openaiCalls).toEqual(["remaining_steps"]);
    expect(riverTraces()).toHaveLength(1);
    expect(riverTraces()[0]).toMatchObject({
      kind: "decision",
      title: "River guide model gave no answer, OpenAI chose the next step (the answer named no control on the page)",
    });
    expect(traces.at(-1)?.detail.model).toBe(MODELS.plan);
  });

  it("falls back to OpenAI when the River call throws", async () => {
    const runner: GuideRunner = async () => {
      throw new Error("guide model exited 1: unavailable");
    };
    const result = await continueGuidance(input, { guideRunner: runner });

    expect(result.steps?.[0]?.target).toBe("a3");
    expect(openaiCalls).toEqual(["remaining_steps"]);
    expect(riverTraces().map((t) => t.title)).toEqual([
      "River guide model gave no answer, OpenAI chose the next step (the River call failed: guide model exited 1: unavailable)",
    ]);
  });

  it("falls back to OpenAI when River does not answer within 8 seconds", async () => {
    vi.useFakeTimers();
    const runner: GuideRunner = () => new Promise<string>(() => undefined);
    const pending = continueGuidance(input, { guideRunner: runner });
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await pending;

    expect(result.steps?.[0]?.target).toBe("a3");
    expect(openaiCalls).toEqual(["remaining_steps"]);
    expect(riverTraces().map((t) => t.title)).toEqual([
      "River guide model gave no answer, OpenAI chose the next step (no answer within 8 s)",
    ]);
  });

  it("uses OpenAI as before and never runs River when it is not configured", async () => {
    vi.stubEnv("RIVER_API_KEY", "");
    const runner = vi.fn<GuideRunner>();
    const result = await continueGuidance(input, { guideRunner: runner });

    expect(runner).not.toHaveBeenCalled();
    expect(result.steps).toEqual([{ target: "a3", caption: "Select Confirm seats", advanceOn: "click" }]);
    expect(openaiCalls).toEqual(["remaining_steps"]);
    expect(riverTraces().map((t) => t.title)).toEqual([
      "River guide model gave no answer, OpenAI chose the next step (River guide model is not configured)",
    ]);
    expect(traces.at(-1)).toMatchObject({ title: "Continued the walkthrough", detail: { model: MODELS.plan } });
  });
});
