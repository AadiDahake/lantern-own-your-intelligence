import { describe, expect, it } from "vitest";
import {
  BATCH_SIZE,
  ModelOutputError,
  NO_GOAL,
  NOVAAIR_CONTEXT,
  inferGoals,
  reverseTaskSynthesis,
  scoreTrajectories,
  type JsonSchema,
  type ModelClient,
  type ModelPrompt,
} from "../src";
import { FakeModelClient } from "./fake-model";
import { cleanSuccess, loadFixtures, wanderingThenSuccess } from "./helpers";

const rows = loadFixtures();
const headings = (user: string): number => (user.match(/^Session \S+ \(/gm) ?? []).length;

describe("reverse task synthesis", () => {
  it("sends eight sessions per call to both prompts", async () => {
    const model = new FakeModelClient();
    const goals = await inferGoals(rows, NOVAAIR_CONTEXT, model);
    await scoreTrajectories(rows, goals, NOVAAIR_CONTEXT, model);
    const fHigh = model.calls.filter((c) => c.purpose === "f_high");
    const trm = model.calls.filter((c) => c.purpose === "trm");
    expect(fHigh).toHaveLength(Math.ceil(rows.length / BATCH_SIZE));
    expect(trm).toHaveLength(Math.ceil(rows.length / BATCH_SIZE));
    for (const call of [...fHigh, ...trm]) expect(headings(call.user)).toBeLessThanOrEqual(BATCH_SIZE);
    expect(headings((fHigh[0] as ModelPrompt).user)).toBe(BATCH_SIZE);
    expect(goals.size).toBe(rows.length);
  });

  it("carries the goal names already in use into the next batch", async () => {
    const model = new FakeModelClient();
    await inferGoals(rows, NOVAAIR_CONTEXT, model);
    const second = model.calls[1] as ModelPrompt;
    expect(model.calls[0]?.user).not.toContain("Goal names already in use");
    expect(second.user).toMatch(/Goal names already in use: .*seat_party_together/);
  });

  it("keeps trajectories with a total of at least 2 and drops the rest", async () => {
    const { kept, dropped } = await reverseTaskSynthesis(rows, NOVAAIR_CONTEXT, new FakeModelClient(), 2);
    expect(kept.length + dropped.length).toBe(rows.length);
    expect(dropped.length).toBeGreaterThan(0);
    for (const t of kept) expect(t.reward.total).toBeGreaterThanOrEqual(2);
    for (const t of dropped) expect(t.reward.total).toBeLessThan(2);
    const partial = kept.filter((t) => t.reward.completion === 2);
    expect(partial.length).toBeGreaterThan(0);
  });

  it("grades a session that wandered and then succeeded high on completion and low on coherence", async () => {
    const model = new FakeModelClient();
    const { kept } = await reverseTaskSynthesis([wanderingThenSuccess(), cleanSuccess()], NOVAAIR_CONTEXT, model, 2);
    const wander = kept.find((t) => t.trajectory.session_id === "wander-1");
    const clean = kept.find((t) => t.trajectory.session_id === "clean-1");
    expect(wander?.reward.completion).toBe(5);
    expect(wander?.reward.coherence).toBeLessThanOrEqual(2);
    expect(wander?.reward.total).toBe(5);
    expect(clean?.reward.completion).toBe(5);
    expect(clean?.reward.coherence).toBe(5);
    const trm = model.calls.find((c) => c.purpose === "trm") as ModelPrompt;
    expect(trm.user).toContain("Final three states:");
    expect(trm.user).toContain("Inferred goal: Seat the traveling party together");
    expect(trm.system).toContain("Do not average them yourself.");
  });

  it("records a session the model left out as having no coherent goal and the lowest grade", async () => {
    const silent: ModelClient = {
      name: "silent",
      structured: async (prompt: ModelPrompt) => (prompt.purpose === "f_high" ? { sessions: [] } : { grades: [] }),
    };
    const { kept, dropped } = await reverseTaskSynthesis([cleanSuccess()], NOVAAIR_CONTEXT, silent, 2);
    expect(kept).toHaveLength(0);
    expect(dropped[0]?.goal.goal_name).toBe(NO_GOAL);
    expect(dropped[0]?.reward).toMatchObject({ completion: 1, coherence: 1, total: 1 });
  });

  it("refuses model output that does not match the output schema", async () => {
    const broken: ModelClient = {
      name: "broken",
      structured: async (_prompt: ModelPrompt, _schema: JsonSchema) => ({ sessions: [{ session_id: "clean-1", goal_name: "ClickSeat" }] }),
    };
    await expect(inferGoals([cleanSuccess()], NOVAAIR_CONTEXT, broken)).rejects.toBeInstanceOf(ModelOutputError);
  });
});
