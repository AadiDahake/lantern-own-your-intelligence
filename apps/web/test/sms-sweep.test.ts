/**
 * The sweep for owed texts, as a rule: when it reads, when it asks the provider, which gap gets a
 * pass, how long a gap and the whole sweep wait, and what the trace and the runner's log say.
 *
 * `packages/shared/test/fixtures/sms-sweep.json` holds the scenarios, and the worker's suite runs
 * the same file against its own copy of the rule (`services/worker/tests/test_sms_sweep.py`). The
 * list of gaps, the provider and the pass are functions here, so nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { NoticeOutcome, NoticeTrace } from "@/lib/sms/notice";
import {
  FIRST_WAIT_MS,
  laterPassTrace,
  longerWait,
  MAX_WAIT_MS,
  providerWaitTrace,
  startSweeps,
  SWEEP_EVERY_MS,
  SWEEP_GAPS,
  Sweeper,
  sweepLine,
  sweepTicker,
  type OwedGap,
  type SweepDeps,
  type SweepResult,
} from "@/lib/sms/sweep";

type Said = [gap: string, title: string, status: string];

type Step = {
  at: number;
  owed?: string[] | { error: string };
  provider?: string;
  passes?: Record<string, string>;
  refusedForAll?: string[];
  sayFails?: string[];
  expect: {
    result: SweepResult;
    read: boolean;
    checked: boolean;
    passed: string[];
    said: Said[];
    sayFailed?: Said[];
    line: string | null;
  };
};

type Fixture = {
  titles: Record<string, string>;
  outcomes: Record<string, NoticeOutcome>;
  scenarios: { name: string; steps: Step[] }[];
};

const fixture = JSON.parse(
  readFileSync(new URL("../../../packages/shared/test/fixtures/sms-sweep.json", import.meta.url), "utf8"),
) as Fixture;

const MINUTE_MS = 60_000;
const gapOf = (id: string): OwedGap => ({ projectId: "p1", groupId: id, escalationId: `run-${id}` });

const DONE: NoticeOutcome = { state: "done", asked: 1, sent: 1, unconfirmed: 0, taken: 0, reasons: [] };
const REFUSED: NoticeOutcome = { state: "done", asked: 1, sent: 0, unconfirmed: 0, taken: 0, reasons: ["http_400"] };

/** One sweep with what the step gives, and a record of each thing the sweep did. */
async function runStep(sweeper: Sweeper, step: Step) {
  const seen = { read: false, checked: false, passed: [] as string[], said: [] as Said[], sayFailed: [] as Said[] };
  const rows: { gap: string; row: NoticeTrace }[] = [];
  const deps: SweepDeps = {
    now: () => step.at * MINUTE_MS,
    owedGaps: async () => {
      seen.read = true;
      if (step.owed === undefined) throw new Error("the step gives no list of gaps");
      if (!Array.isArray(step.owed)) throw new Error(step.owed.error);
      return step.owed.map(gapOf);
    },
    providerAnswers: async () => {
      seen.checked = true;
      const answer = step.provider ?? "ok";
      return answer === "ok" ? { ok: true } : { ok: false, reason: answer };
    },
    pass: async (gap) => {
      seen.passed.push(gap.groupId);
      const name = step.passes?.[gap.groupId];
      if (!name) throw new Error(`the step gives no pass for ${gap.groupId}`);
      return {
        outcome: fixture.outcomes[name] as NoticeOutcome,
        refusedForAll: step.refusedForAll?.includes(gap.groupId) ?? false,
      };
    },
    say: async (gap, row) => {
      const entry: Said = [gap.groupId, row.title, row.status];
      if (step.sayFails?.includes(gap.groupId)) {
        seen.sayFailed.push(entry);
        throw new Error("the trace row could not be written");
      }
      seen.said.push(entry);
      rows.push({ gap: gap.groupId, row });
    },
  };
  const result = await sweeper.run(deps);
  return { result, seen, rows };
}

/** A fixture names the two long titles by a key. */
const titled = (said: Said[] | undefined): Said[] =>
  (said ?? []).map(([gap, title, status]) => [gap, fixture.titles[title] ?? title, status]);

describe("the sweep, on the scenarios that the worker runs too", () => {
  for (const scenario of fixture.scenarios) {
    it(scenario.name, async () => {
      const sweeper = new Sweeper();
      for (const step of scenario.steps) {
        const { result, seen, rows } = await runStep(sweeper, step);
        const where = `at minute ${step.at}`;
        expect(result, where).toEqual(step.expect.result);
        expect(seen.read, `${where}: the list of gaps was read`).toBe(step.expect.read);
        expect(seen.checked, `${where}: the provider was asked`).toBe(step.expect.checked);
        expect(seen.passed, `${where}: the gaps that got a pass`).toEqual(step.expect.passed);
        expect(seen.said, `${where}: the rows that were written`).toEqual(titled(step.expect.said));
        expect(seen.sayFailed, `${where}: the rows that could not be written`).toEqual(titled(step.expect.sayFailed));
        expect(sweepLine(result), `${where}: the runner's line`).toBe(step.expect.line);
        for (const { gap, row } of rows) {
          // A row is a status row of the notice, and its detail is the outcome that it reports.
          const name = step.passes?.[gap];
          const outcome = name ? fixture.outcomes[name] : { state: "waiting", reason: step.provider };
          expect(row.kind).toBe("status");
          expect(row.detail, `${where}: the detail of the row for ${gap}`).toEqual({
            notice: "draft_sms",
            pass: "later",
            ...outcome,
          });
        }
      }
    });
  }

  it("has a step that proves each rule, so an empty fixture cannot pass", () => {
    const states = new Set(fixture.scenarios.flatMap((scenario) => scenario.steps.map((step) => step.expect.result.state)));
    expect([...states].sort()).toEqual(["failed", "idle", "provider", "swept", "waiting"]);
    expect(fixture.scenarios.length).toBeGreaterThanOrEqual(20);
    const stops = new Set(
      fixture.scenarios.flatMap((scenario) =>
        scenario.steps.map((step) => (step.expect.result.state === "swept" ? step.expect.result.stop : null)),
      ),
    );
    expect([...stops].map(String).sort()).toEqual(["null", "refused", "unconfirmed"]);
  });
});

describe("Sweeper", () => {
  const step = (at: number, owed: string[], passes: Record<string, NoticeOutcome>, more: Partial<SweepDeps> = {}) => {
    const passed: string[] = [];
    const deps: SweepDeps = {
      now: () => at * MINUTE_MS,
      owedGaps: async () => owed.map(gapOf),
      providerAnswers: async () => ({ ok: true }),
      pass: async (gap) => {
        passed.push(gap.groupId);
        return { outcome: passes[gap.groupId] ?? DONE, refusedForAll: false };
      },
      say: async () => undefined,
      ...more,
    };
    return { deps, passed };
  };

  it("claims no one when the question to the provider throws", async () => {
    const sweeper = new Sweeper();
    const { deps, passed } = step(0, ["g1"], {}, {
      providerAnswers: async () => {
        throw new Error("socket hang up");
      },
    });
    expect(await sweeper.run(deps)).toEqual({ state: "provider", reason: "check_failed", gaps: 1 });
    expect(passed).toEqual([]);
  });

  it("reads a pass that throws as a list that could not be read, and goes on to the next gap", async () => {
    const sweeper = new Sweeper();
    const said: string[] = [];
    const { deps } = step(0, ["g1", "g2"], {}, {
      pass: async (gap) => {
        if (gap.groupId === "g1") throw new Error("PostgREST is unreachable");
        return { outcome: DONE, refusedForAll: false };
      },
      say: async (gap, row) => {
        said.push(`${gap.groupId}: ${row.title}`);
      },
    });
    expect(await sweeper.run(deps)).toEqual({ state: "swept", gaps: 2, sent: 1, left: 1, stop: null });
    expect(said).toEqual([
      "g1: Text notice, later pass: could not read who is owed a text",
      "g2: Text notice, later pass: 1 of 1 sent",
    ]);
  });

  it("asks for at most one sweep of gaps", async () => {
    const sweeper = new Sweeper();
    let asked = 0;
    const { deps } = step(0, [], {}, {
      owedGaps: async (limit) => {
        asked = limit;
        return [];
      },
    });
    await sweeper.run(deps);
    expect(asked).toBe(SWEEP_GAPS);
  });

  it("keeps the wait of a gap that a full list did not show", async () => {
    // With more gaps than one sweep reads, a gap that waits can be past the end of the list. It
    // is still owed, so its wait is not forgotten: a gap is forgotten by time only.
    const sweeper = new Sweeper();
    const first = step(0, ["g1"], { g1: REFUSED });
    await sweeper.run(first.deps);

    const others = Array.from({ length: SWEEP_GAPS }, (_, index) => `other-${index}`);
    await sweeper.run(step(1, others, {}).deps);

    const again = step(2, ["g1"], { g1: REFUSED });
    expect(await sweeper.run(again.deps)).toEqual({ state: "idle", owed: 1 });
    expect(again.passed).toEqual([]);
  });

  it("starts a gap from nothing after each person of it was texted, also while the list is full", async () => {
    // A gap is not forgotten while the list has it, so a confirmed text must end its wait.
    const sweeper = new Sweeper();
    const others = Array.from({ length: SWEEP_GAPS - 1 }, (_, index) => `other-${index}`);
    const full = ["g1", ...others];
    await sweeper.run(step(0, full, { g1: REFUSED }).deps);
    await sweeper.run(step(10, full, { g1: DONE }).deps);
    // A person of the same gap is owed again. The first wait is 10 minutes again, not 20.
    await sweeper.run(step(11, full, { g1: REFUSED }).deps);
    const early = step(20, full, { g1: REFUSED });
    await sweeper.run(early.deps);
    expect(early.passed).not.toContain("g1");
    const due = step(21, full, { g1: REFUSED });
    await sweeper.run(due.deps);
    expect(due.passed).toContain("g1");
  });

  it("writes no row and starts no wait for a pass that says that texts are off", async () => {
    const sweeper = new Sweeper();
    const said: string[] = [];
    const first = step(0, ["g1"], {}, {
      pass: async () => ({ outcome: { state: "off", reason: "DIAL_API_KEY is not set" }, refusedForAll: false }),
      say: async (_gap, row) => {
        said.push(row.title);
      },
    });
    expect(await sweeper.run(first.deps)).toEqual({ state: "swept", gaps: 1, sent: 0, left: 0, stop: null });
    expect(said).toEqual([]);
    const next = step(1, ["g1"], {});
    await sweeper.run(next.deps);
    expect(next.passed).toEqual(["g1"]);
  });

  it("reads the clock again after each pass, so a wait starts when the pass ends", async () => {
    // One pass can take a minute. A wait that started at the start of the sweep would be short
    // by the time of each pass before it.
    const sweeper = new Sweeper();
    let clock = 0;
    const first = step(0, ["g1"], {}, {
      now: () => clock,
      pass: async () => {
        clock += 5 * MINUTE_MS;
        return { outcome: REFUSED, refusedForAll: false };
      },
    });
    await sweeper.run(first.deps);
    const early = step(14, ["g1"], { g1: REFUSED });
    await sweeper.run(early.deps);
    expect(early.passed).toEqual([]);
    const due = step(15, ["g1"], { g1: REFUSED });
    await sweeper.run(due.deps);
    expect(due.passed).toEqual(["g1"]);
  });

  it("starts the wait after a text with no confirmed answer when the pass ends, not when the sweep starts", async () => {
    const sweeper = new Sweeper();
    let clock = 0;
    const first = step(0, ["g1"], {}, {
      now: () => clock,
      pass: async () => {
        clock += 5 * MINUTE_MS;
        return { outcome: { state: "done", asked: 1, sent: 0, unconfirmed: 1, taken: 0, reasons: ["timeout"] }, refusedForAll: false };
      },
    });
    expect(await sweeper.run(first.deps)).toMatchObject({ stop: "unconfirmed" });
    expect(await sweeper.run(step(14, [], {}).deps)).toEqual({ state: "waiting" });
    expect(await sweeper.run(step(15, [], {}).deps)).toEqual({ state: "idle", owed: 0 });
  });

  it("gives each gap its own trace, in the run that carries the gap", async () => {
    const sweeper = new Sweeper();
    const told: OwedGap[] = [];
    const { deps } = step(0, ["g1"], { g1: REFUSED }, {
      say: async (gap) => {
        told.push(gap);
      },
    });
    await sweeper.run(deps);
    expect(told).toEqual([{ projectId: "p1", groupId: "g1", escalationId: "run-g1" }]);
  });

  it("keeps the waits of two runners apart", async () => {
    const one = new Sweeper();
    const two = new Sweeper();
    await one.run(step(0, ["g1"], { g1: REFUSED }).deps);
    const other = step(1, ["g1"], { g1: REFUSED });
    await two.run(other.deps);
    expect(other.passed).toEqual(["g1"]);
  });
});

describe("the waits", () => {
  it("start at 10 minutes, are 2 times as long each time, and stop at 6 hours", () => {
    const waits: number[] = [];
    let wait = 0;
    for (let index = 0; index < 8; index += 1) {
      wait = longerWait(wait);
      waits.push(wait / MINUTE_MS);
    }
    expect(waits).toEqual([10, 20, 40, 80, 160, 320, 360, 360]);
    expect(FIRST_WAIT_MS).toBe(10 * MINUTE_MS);
    expect(MAX_WAIT_MS).toBe(360 * MINUTE_MS);
  });

  it("are never shorter than the time between two sweeps", () => {
    expect(FIRST_WAIT_MS).toBeGreaterThanOrEqual(SWEEP_EVERY_MS);
  });

  it("go with a sweep each 5 minutes that reads at most 1000 gaps", () => {
    // The docs and the worker's copy give these two numbers.
    expect(SWEEP_EVERY_MS).toBe(5 * MINUTE_MS);
    expect(SWEEP_GAPS).toBe(1000);
  });
});

describe("laterPassTrace", () => {
  it("says nothing when the pass had no one to text", () => {
    expect(laterPassTrace({ state: "done", asked: 0, sent: 0, unconfirmed: 0, taken: 0, reasons: [] })).toBeNull();
    expect(laterPassTrace({ state: "done", asked: 0, sent: 0, unconfirmed: 0, taken: 3, reasons: [] })).toBeNull();
    expect(laterPassTrace({ state: "off", reason: "DIAL_API_KEY is not set" })).toBeNull();
  });

  it("counts the texts, names the pass, and is failed when one was not sent", () => {
    expect(laterPassTrace({ state: "done", asked: 2, sent: 2, unconfirmed: 0, taken: 0, reasons: [] })).toEqual({
      kind: "status",
      status: "ok",
      title: "Text notice, later pass: 2 of 2 sent",
      detail: { notice: "draft_sms", pass: "later", state: "done", asked: 2, sent: 2, unconfirmed: 0, taken: 0, reasons: [] },
    });
    expect(laterPassTrace(REFUSED)?.status).toBe("failed");
  });

  it("says that the list could not be read", () => {
    expect(laterPassTrace({ state: "failed", reason: "PostgREST 503" })).toEqual({
      kind: "status",
      status: "failed",
      title: "Text notice, later pass: could not read who is owed a text",
      detail: { notice: "draft_sms", pass: "later", state: "failed", reason: "PostgREST 503" },
    });
  });
});

describe("providerWaitTrace", () => {
  it("says that nothing was sent yet, with the reason as a code", () => {
    expect(providerWaitTrace("http_503")).toEqual({
      kind: "status",
      status: "failed",
      title: "Text notice, later pass: not sent yet, the text message provider did not answer",
      detail: { notice: "draft_sms", pass: "later", state: "waiting", reason: "http_503" },
    });
  });
});

describe("sweepLine", () => {
  it("says off with the variable that is missing", () => {
    expect(sweepLine({ state: "off", reason: "DIAL_API_KEY is not set" })).toBe(
      "text sweep: off, DIAL_API_KEY is not set",
    );
  });

  it("says nothing for a sweep that waits or has no gap that is due", () => {
    expect(sweepLine({ state: "waiting" })).toBeNull();
    expect(sweepLine({ state: "idle", owed: 4 })).toBeNull();
  });
});

describe("sweepTicker", () => {
  const SENT: SweepResult = { state: "swept", gaps: 1, sent: 1, left: 0, stop: null };
  const REFUSED_AGAIN: SweepResult = { state: "swept", gaps: 1, sent: 0, left: 1, stop: null };
  const IDLE: SweepResult = { state: "idle", owed: 1 };

  /** A ticker over a list of results, one for each sweep, and the lines that it printed. */
  function ticker(results: (SweepResult | Error)[]) {
    const lines: string[] = [];
    let runs = 0;
    const tick = sweepTicker(async () => {
      const result = results[runs] as SweepResult | Error;
      runs += 1;
      if (result instanceof Error) throw result;
      return result;
    }, (line) => lines.push(line));
    return { tick, lines, runs: () => runs };
  }

  it("prints a line one time while each sweep says the same thing", async () => {
    const off: SweepResult = { state: "off", reason: "DIAL_API_KEY is not set" };
    const { tick, lines } = ticker([off, off, off]);
    await tick();
    await tick();
    await tick();
    expect(lines).toEqual(["text sweep: off, DIAL_API_KEY is not set"]);
  });

  it("does not print the same refusal again after sweeps that had nothing to say", async () => {
    // The gap waits between its tries, and the sweeps in between are idle.
    const { tick, lines } = ticker([REFUSED_AGAIN, IDLE, IDLE, REFUSED_AGAIN, { state: "waiting" }, REFUSED_AGAIN]);
    for (let index = 0; index < 6; index += 1) await tick();
    expect(lines).toEqual(["text sweep: 0 texts sent in 1 pass, 1 gap still with a person who is owed"]);
  });

  it("prints a line for each sweep that sent a text, also when the line is the same", async () => {
    const { tick, lines } = ticker([SENT, SENT]);
    await tick();
    await tick();
    expect(lines).toEqual([
      "text sweep: 1 text sent in 1 pass, 0 gaps still with a person who is owed",
      "text sweep: 1 text sent in 1 pass, 0 gaps still with a person who is owed",
    ]);
  });

  it("starts no sweep while the last one runs", async () => {
    let release: (result: SweepResult) => void = () => undefined;
    let runs = 0;
    const tick = sweepTicker(
      () => {
        runs += 1;
        return new Promise<SweepResult>((resolve) => {
          release = resolve;
        });
      },
      () => undefined,
    );
    const first = tick();
    await tick();
    await tick();
    expect(runs).toBe(1);
    release(IDLE);
    await first;
    void tick();
    expect(runs).toBe(2);
  });

  it("never rejects, prints the kind of a failure only, and sweeps again at the next tick", async () => {
    const { tick, lines, runs } = ticker([new TypeError("the number +14155550101 could not be read"), SENT]);
    await expect(tick()).resolves.toBeUndefined();
    await tick();
    expect(lines).toEqual([
      "text sweep failed (TypeError)",
      "text sweep: 1 text sent in 1 pass, 0 gaps still with a person who is owed",
    ]);
    expect(lines.join(" ")).not.toContain("4155550101");
    expect(runs()).toBe(2);
  });

  it("names a failure that is not an error by its type", async () => {
    const lines: string[] = [];
    const tick = sweepTicker(
      () => Promise.reject(null),
      (line) => lines.push(line),
    );
    await expect(tick()).resolves.toBeUndefined();
    expect(lines).toEqual(["text sweep failed (object)"]);
  });
});

describe("startSweeps", () => {
  it("has a timer of its own that goes on after the first sweep", async () => {
    vi.useFakeTimers();
    try {
      let ticks = 0;
      startSweeps(async () => {
        ticks += 1;
      });
      await vi.advanceTimersByTimeAsync(SWEEP_EVERY_MS - 1);
      expect(ticks).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(ticks).toBe(1);
      await vi.advanceTimersByTimeAsync(2 * SWEEP_EVERY_MS);
      expect(ticks).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts one sweep each 5 minutes, and none at the start", async () => {
    let ticks = 0;
    const timers: { run: () => void; ms: number }[] = [];
    startSweeps(
      async () => {
        ticks += 1;
      },
      (run, ms) => timers.push({ run, ms }),
    );
    // The waits of a sweep are in memory, so a runner that just started must not sweep.
    expect(ticks).toBe(0);
    expect(timers.map((timer) => timer.ms)).toEqual([SWEEP_EVERY_MS]);
    timers[0]?.run();
    timers[0]?.run();
    expect(ticks).toBe(2);
  });
});
