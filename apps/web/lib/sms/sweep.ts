/**
 * The sweep: a later pass for each person who is still owed a text while the draft is open.
 *
 * The pass at the draft runs one time. A person who is still owed after that pass had no way to
 * the text: the provider refused the number at that moment, the pass stopped at a failure, or its
 * time ran out. So each runner that can send a text runs this sweep in its loop. It reads the
 * gaps that have an open draft, which no person has decided, and a person who is owed, and it
 * runs the same pass (`sendDraftNotice`) for each one. The claim and the one-text rule are those
 * of the first pass, so a sweep and a run, or two runners, cannot text one person two times for
 * one consent. The worker has the same rule for the `local` engine
 * (`services/worker/steps/sms_sweep.py`); change them together.
 *
 * A later try must not cost more people than it helps. Four rules hold that:
 *
 * - The provider is asked one read-only question first. When it does not answer as itself, the
 *   sweep claims no one and sends nothing. An outage, a wrong address and a key that stopped
 *   working then cost no person their text, however many sweeps run in that time.
 * - A text with no confirmed answer costs one person their text, and the next send is expected to
 *   end the same way. It stops the whole sweep, and the next send waits: 10 minutes, then 2 times
 *   as long each time, up to 6 hours. One confirmed text ends that wait. A refusal that is not
 *   about one person (no credit, a key that the provider does not take) stops the sweep in the
 *   same way; it costs no person a text, and one try for each wait is enough to see it end.
 * - A gap whose pass left people and confirmed no text waits in the same way, by itself. A number
 *   that the provider refuses each time (a region that it does not serve) is then tried a few
 *   times a day and not each 5 minutes, and it holds back no other gap that the sweep reads.
 * - The gap with the least trouble goes first, and the gap of a text with no confirmed answer
 *   waits by itself too. So the gap that caused a stop is not the first try after the wait.
 *
 * The waits are in the memory of the process, so a runner that starts again starts with no wait.
 * A runner therefore makes its first sweep one interval after it starts, not at the start: a
 * runner that stops within that interval of each start sweeps nothing. The waits are measured on
 * a clock that only goes forward.
 *
 * A phone number is never in a result, a trace row, or a log line.
 */
import { thrownMessage, type NoticeOutcome, type NoticeTrace } from "./notice";

/** How often a runner starts a sweep, and how long after its start the first one comes. */
export const SWEEP_EVERY_MS = 5 * 60_000;

/** The first wait after a pass that must not be repeated at once. Each next wait is 2 times as long. */
export const FIRST_WAIT_MS = 10 * 60_000;

/**
 * The longest wait. A number that is refused each time is then tried 4 times a day. It is also
 * how long a gap that is not in the list is remembered, with its wait and its last row.
 */
export const MAX_WAIT_MS = 6 * 60 * 60_000;

/**
 * The most gaps one sweep reads. The list has the gaps that wait in it too, so a deployment with
 * more owed gaps than this, where each one waits, gives the gaps past the end no pass.
 */
export const SWEEP_GAPS = 1000;

/** A gap with an open draft that no person has decided, and at least one person who is owed a text. */
export type OwedGap = {
  projectId: string;
  groupId: string;
  /** The run whose draft is open, so the sweep's row is in that run's trace. */
  escalationId: string | null;
};

/** What the provider said to the read-only question. `reason` is a short code. */
export type ProviderCheck = { ok: true } | { ok: false; reason: string };

/**
 * How one pass ended. `refusedForAll` is true when a send of the pass was refused for a cause
 * that is not the person (the key, the credit, the provider's address): the pass stopped there,
 * and the next send is expected to end the same way.
 */
export type PassResult = { outcome: NoticeOutcome; refusedForAll: boolean };

export interface SweepDeps {
  /** The gaps with an open draft and a person who is owed a text, at most `limit`. */
  owedGaps(limit: number): Promise<OwedGap[]>;
  /** Asks the provider one read-only question. Sends nothing. */
  providerAnswers(): Promise<ProviderCheck>;
  /** The same pass that runs at the draft, for one gap. */
  pass(gap: OwedGap): Promise<PassResult>;
  /** Writes one trace row for the gap. */
  say(gap: OwedGap, row: NoticeTrace): Promise<void>;
  /** Milliseconds on a clock that only goes forward. The wall clock can be set back. */
  now?: () => number;
}

/** Why a sweep ended before each due gap had its pass. */
export type SweepStop =
  /** A text had no confirmed answer. */
  | "unconfirmed"
  /** A send was refused for a cause that is not the person. */
  | "refused";

export type SweepResult =
  /** Text messages are not configured. Nothing was read. */
  | { state: "off"; reason: string }
  /** The provider did not take a send a short time ago, so nothing is sent yet. Nothing was read. */
  | { state: "waiting" }
  /** The sweep could not run. `reason` is the words of the error, most often of the list of gaps. */
  | { state: "failed"; reason: string }
  /** No gap is due. `owed` gaps have people left and wait for their next try. */
  | { state: "idle"; owed: number }
  /** The provider did not answer the read-only question, so no one was claimed. */
  | { state: "provider"; reason: string; gaps: number }
  /**
   * `gaps` passes ran and `sent` texts were confirmed. `left` gaps still have a person who is
   * owed. `stop` says why the sweep ended before each due gap had its pass, or is null.
   */
  | { state: "swept"; gaps: number; sent: number; left: number; stop: SweepStop | null };

/** The next wait after `waitMs`: 10 minutes first, then 2 times as long, at most 6 hours. */
export function longerWait(waitMs: number): number {
  return Math.min(Math.max(waitMs * 2, FIRST_WAIT_MS), MAX_WAIT_MS);
}

const count = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const STOPPED: Record<SweepStop, string> = {
  unconfirmed: ", stopped at a text with no confirmed answer",
  refused: ", stopped at a refusal that is not about one person",
};

/**
 * What a runner prints about a sweep, or null when there is nothing to say: no gap was due, or
 * the sweep waits. The reasons are short codes and the words of a database error.
 */
export function sweepLine(result: SweepResult): string | null {
  switch (result.state) {
    case "off":
      return `text sweep: off, ${result.reason}`;
    case "failed":
      return `text sweep: failed (${result.reason})`;
    case "provider":
      return `text sweep: nothing sent for ${count(result.gaps, "gap")}, the text message provider did not answer (${result.reason})`;
    case "swept":
      return `text sweep: ${count(result.sent, "text")} sent in ${count(result.gaps, "pass", "passes")}, ${count(result.left, "gap")} still with a person who is owed${result.stop ? STOPPED[result.stop] : ""}`;
    default:
      return null;
  }
}

type Wait = { waitMs: number; notBefore: number };

/**
 * A gap's own wait, the last row that the sweep wrote for it, and the time of the first list
 * that did not have it (null while the list has it).
 */
type GapState = Wait & { said: string; missing: number | null };

const detailOf = (outcome: object): Record<string, unknown> => ({ notice: "draft_sms", pass: "later", ...outcome });

/**
 * The row for a later pass, or null when the pass has nothing to say: no one was left for it, or
 * a different run took each person and reports them itself.
 */
export function laterPassTrace(outcome: NoticeOutcome): NoticeTrace | null {
  if (outcome.state === "off") return null;
  if (outcome.state === "failed") {
    return {
      kind: "status",
      status: "failed",
      title: "Text notice, later pass: could not read who is owed a text",
      detail: detailOf(outcome),
    };
  }
  if (outcome.asked === 0) return null;
  return {
    kind: "status",
    status: outcome.sent === outcome.asked ? "ok" : "failed",
    title: `Text notice, later pass: ${outcome.sent} of ${outcome.asked} sent`,
    detail: detailOf(outcome),
  };
}

/** The row for a sweep that sent nothing because the provider did not answer the question. */
export function providerWaitTrace(reason: string): NoticeTrace {
  return {
    kind: "status",
    status: "failed",
    title: "Text notice, later pass: not sent yet, the text message provider did not answer",
    detail: detailOf({ state: "waiting", reason }),
  };
}

/** One runner's sweep. It keeps the waits, so a runner makes one and calls `run` on a timer. */
export class Sweeper {
  /** The wait after a send that the provider did not take. It holds back each gap. */
  private provider: Wait = { waitMs: 0, notBefore: 0 };
  /** Only the gaps that the sweep has something to remember about. */
  private readonly gaps = new Map<string, GapState>();

  private state(gap: OwedGap): GapState {
    let state = this.gaps.get(gap.groupId);
    if (!state) {
      state = { waitMs: 0, notBefore: 0, said: "", missing: null };
      this.gaps.set(gap.groupId, state);
    }
    return state;
  }

  /**
   * Writes a row only when it differs from the last row that this sweeper wrote for the gap. A
   * number that is refused on each try then gives one row, not one row for each try. `words` is
   * what makes two rows the same. A row that could not be written is tried again with the next
   * pass.
   */
  private async tell(deps: SweepDeps, gap: OwedGap, row: NoticeTrace, words: string): Promise<void> {
    const state = this.state(gap);
    if (state.said === words) return;
    try {
      await deps.say(gap, row);
      state.said = words;
    } catch {
      // The texts count, not the row about them.
    }
  }

  /** One sweep. Never throws. */
  async run(deps: SweepDeps): Promise<SweepResult> {
    const now = deps.now ?? (() => performance.now());
    if (now() < this.provider.notBefore) return { state: "waiting" };

    let owed: OwedGap[];
    try {
      owed = await deps.owedGaps(SWEEP_GAPS);
    } catch (error) {
      return { state: "failed", reason: thrownMessage(error) };
    }
    // A gap can be out of one list and owed again in the next: a different runner holds its one
    // person for the moment of a send. So a gap is forgotten only when no list had it for the
    // longest wait, counted from the first list without it. A sweep that read nothing for hours
    // then forgets nothing at its first list.
    const read = now();
    const listed = new Set(owed.map((gap) => gap.groupId));
    for (const [id, state] of [...this.gaps]) {
      if (listed.has(id)) state.missing = null;
      else if (state.missing === null) state.missing = read;
      else if (read - state.missing > MAX_WAIT_MS) this.gaps.delete(id);
    }

    const waitOf = (gap: OwedGap): number => this.gaps.get(gap.groupId)?.waitMs ?? 0;
    const due = owed
      .filter((gap) => now() >= (this.gaps.get(gap.groupId)?.notBefore ?? 0))
      // The gap with the least trouble first; the order of the list for the rest.
      .sort((a, b) => waitOf(a) - waitOf(b));
    if (due.length === 0) return { state: "idle", owed: owed.length };

    const check = await deps.providerAnswers().catch((): ProviderCheck => ({ ok: false, reason: "check_failed" }));
    if (!check.ok) {
      // One row for as long as the provider does not answer, whatever the reason of each try is:
      // a reason that changes from sweep to sweep must not write a row for each gap each time.
      const row = providerWaitTrace(check.reason);
      for (const gap of due) await this.tell(deps, gap, row, row.title);
      return { state: "provider", reason: check.reason, gaps: due.length };
    }

    let passes = 0;
    let sent = 0;
    // The gaps that wait for their own next try still have their people.
    let left = owed.length - due.length;
    let stop: SweepStop | null = null;
    for (const gap of due) {
      const { outcome, refusedForAll } = await deps.pass(gap).catch(
        (error): PassResult => ({ outcome: { state: "failed", reason: thrownMessage(error) }, refusedForAll: false }),
      );
      passes += 1;
      // The caller reads the configuration before the sweep, so this is a pass that did nothing.
      if (outcome.state === "off") continue;
      const row = laterPassTrace(outcome);
      if (row) await this.tell(deps, gap, row, JSON.stringify([row.title, row.detail]));

      const confirmed = outcome.state === "done" ? outcome.sent : 0;
      const unconfirmed = outcome.state === "done" ? outcome.unconfirmed : 0;
      const peopleLeft = outcome.state === "failed" || outcome.asked > confirmed + unconfirmed;
      sent += confirmed;
      if (peopleLeft) left += 1;
      if (confirmed > 0) {
        // A confirmed text is the one proof that the provider takes a text now, and the gap made
        // progress: each wait starts from nothing.
        this.provider = { waitMs: 0, notBefore: 0 };
        const state = this.gaps.get(gap.groupId);
        if (state) Object.assign(state, { waitMs: 0, notBefore: 0 });
      }

      const grow = (): void => {
        const state = this.state(gap);
        state.waitMs = longerWait(state.waitMs);
        state.notBefore = now() + state.waitMs;
      };
      if (unconfirmed > 0 || refusedForAll) {
        // The provider did not take a send, and the next send is expected to end the same way.
        // After a text with no confirmed answer each such send costs a person, so no gap is
        // tried before the wait ends.
        const waitMs = longerWait(this.provider.waitMs);
        this.provider = { waitMs, notBefore: now() + waitMs };
        // The cause can be this gap alone. It waits too, so a different gap is the next try.
        if (unconfirmed > 0) grow();
        left += due.length - passes;
        stop = unconfirmed > 0 ? "unconfirmed" : "refused";
        break;
      }
      if (peopleLeft && confirmed === 0) grow();
    }
    return { state: "swept", gaps: passes, sent, left, stop };
  }
}

/**
 * One tick of a runner's timer: a sweep, and a line about it. The function that comes back never
 * rejects, and it starts no sweep while the last one runs, because a sweep sends one text after
 * the other and can take longer than the timer. A line is printed when it differs from the last
 * line, and always when a text was sent. So a sweep that is off, or that meets the same refusal
 * at each try, says it one time, and no text goes out with no line.
 */
export function sweepTicker(run: () => Promise<SweepResult>, say: (line: string) => void): () => Promise<void> {
  let running = false;
  let last = "";
  return async () => {
    if (running) return;
    running = true;
    try {
      const result = await run();
      const line = sweepLine(result);
      if (line && (line !== last || (result.state === "swept" && result.sent > 0))) say(line);
      if (line) last = line;
    } catch (error) {
      // The kind of failure only: the words of an error are not printed where a person's number
      // was just handled.
      say(`text sweep failed (${error instanceof Error ? error.name : typeof error})`);
    } finally {
      running = false;
    }
  };
}

/**
 * Starts a runner's sweeps: one each `SWEEP_EVERY_MS`, and the first one after one interval, not
 * at the start. `every` is the timer, so a test can hold it.
 */
export function startSweeps(
  tick: () => Promise<void>,
  every: (run: () => void, ms: number) => void = (run, ms) => void setInterval(run, ms).unref(),
): void {
  every(() => void tick(), SWEEP_EVERY_MS);
}
