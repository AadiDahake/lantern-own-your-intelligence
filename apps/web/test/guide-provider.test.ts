import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseControl, guideConfigured, parseChoice, type GuideControl } from "@/lib/guide/provider";

const controls: GuideControl[] = [
  { id: "a1", role: "tab", name: "Passenger 1 (adult)", state: "selected" },
  { id: "a2", role: "button", name: "Seat 6D", state: "available" },
  { id: "a3", role: "button", name: "Confirm seats" },
];

const reply = (answer: string) =>
  JSON.stringify({ answer, checkpoint: "river://run/weights/guide-inf", base_model: "Qwen/Qwen3.8-27B-FP8" });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseChoice", () => {
  it("takes the id the model named when it is on the page", () => {
    const stdout = `Installed 38 packages\n${reply('{"action": "press", "id": "a2"}')}\n`;
    expect(parseChoice(stdout, controls)).toEqual({
      id: "a2",
      checkpoint: "river://run/weights/guide-inf",
      baseModel: "Qwen/Qwen3.8-27B-FP8",
    });
  });

  it("refuses an id the widget did not send", () => {
    expect(parseChoice(reply('{"action": "press", "id": "a9"}'), controls)).toBeNull();
  });

  it("refuses prose and broken JSON", () => {
    expect(parseChoice(reply("Press the seat button."), controls)).toBeNull();
    expect(parseChoice("not json", controls)).toBeNull();
  });

  it("reads past a thinking block", () => {
    expect(parseChoice(reply('<think>{"id": "a9"}</think>{"action": "press", "id": "a3"}'), controls)?.id).toBe("a3");
  });
});

describe("chooseControl", () => {
  it("is off and calls nothing without a River key", async () => {
    vi.stubEnv("RIVER_API_KEY", "");
    const runner = vi.fn();
    expect(guideConfigured()).toBe(false);
    expect(await chooseControl("Seat us together", controls, runner)).toBeNull();
    expect(runner).not.toHaveBeenCalled();
  });

  it("sends the question and the controls and returns the checked choice", async () => {
    vi.stubEnv("RIVER_API_KEY", "test-key");
    const runner = vi.fn(async (input: string) => (input ? reply('{"action": "press", "id": "a1"}') : ""));
    expect((await chooseControl("Seat us together", controls, runner))?.id).toBe("a1");
    expect(JSON.parse(runner.mock.calls[0]![0])).toEqual({ question: "Seat us together", controls });
  });

  it("answers null when the River call fails", async () => {
    vi.stubEnv("RIVER_API_KEY", "test-key");
    const runner = vi.fn(async () => {
      throw new Error("unavailable");
    });
    expect(await chooseControl("Seat us together", controls, runner)).toBeNull();
  });
});
