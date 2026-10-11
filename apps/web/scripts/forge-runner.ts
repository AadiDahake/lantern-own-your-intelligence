/**
 * The forge runner: the long-lived process that carries forge work.
 *
 * A forge run is minutes of sandbox work and a decision waits on a merge and a Vercel deployment.
 * Neither fits inside a serverless function, so the console's routes only write the `escalation`
 * row and answer. This process polls those rows and does the work, exactly as
 * `services/worker/local_runner.py` does for the `local` engine. The console and the widget read
 * the same `trace_event` rows either way, so nothing else changes.
 *
 *   npm run forge:runner
 *
 * Each claimed row runs on its own promise, because a run that is waiting on a deployment must
 * not hold up the next one. Stop it with Ctrl-C; a row it was carrying is left where it got to,
 * and `npm run forge:sweep` shuts down any devbox it left behind.
 */
import {
  claimDecidedApproval,
  claimQueuedRun,
  runClaimedApproval,
  runClaimedRun,
  type ForgeQueueRow,
} from "../lib/forge/queue";
import { smsSender } from "../lib/env";
import { beatOnce, HEARTBEAT_MS } from "../lib/forge/heartbeat";
import { claimQueuedExploration } from "../lib/graph/jobs";
import { runClaimedExploration } from "../lib/graph/run-exploration";
import { runDraftSweeps } from "../lib/sms/subscribers";

const POLL_MS = 2_000;

const stamp = (): string => new Date().toISOString().slice(11, 19);
const say = (line: string): void => console.log(`${stamp()} ${line}`);
const loggerFor = (row: ForgeQueueRow) => (line: string): void => say(`[${row.id.slice(0, 8)}] ${line}`);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Every row this process is still carrying, so shutdown can say what is in flight. */
const inFlight = new Set<string>();

function carry(row: ForgeQueueRow, work: Promise<unknown>): void {
  inFlight.add(row.id);
  void work
    .catch((error: Error) => say(`[${row.id.slice(0, 8)}] unhandled: ${error.message}`))
    .finally(() => inFlight.delete(row.id));
}

/** One poll of both queues. Answers whether it found anything, so the loop knows to sleep. */
async function tick(): Promise<boolean> {
  let found = false;

  const decided = await claimDecidedApproval();
  if (decided) {
    found = true;
    say(`[${decided.id.slice(0, 8)}] carrying the ${decided.status} decision`);
    carry(decided, runClaimedApproval(decided, loggerFor(decided)));
  }

  // Exploring a site needs a browser too, so this process carries those jobs as well.
  const exploration = await claimQueuedExploration();
  if (exploration) {
    found = true;
    const tag = `[explore ${exploration.id.slice(0, 8)}]`;
    say(`${tag} exploring ${exploration.siteUrl}`);
    inFlight.add(exploration.id);
    void runClaimedExploration(exploration, (line) => say(`${tag} ${line}`))
      .then((result) => say(`${tag} ${result.status}${result.error ? `: ${result.error}` : ""}`))
      .finally(() => inFlight.delete(exploration.id));
  }

  const queued = await claimQueuedRun();
  if (queued) {
    found = true;
    say(`[${queued.id.slice(0, 8)}] building "${queued.title}"`);
    carry(
      queued,
      runClaimedRun(queued, loggerFor(queued)).then((result) =>
        say(`[${queued.id.slice(0, 8)}] ${result.status}${result.error ? `: ${result.error}` : ""}`),
      ),
    );
  }

  return found;
}

/**
 * Says that this runner is live, and if it can send a text. The variables are read on each beat,
 * so what the heartbeat says is what a notice of this moment would do. A failed beat is logged
 * and the next one is tried: no heartbeat only means that the text is not offered.
 */
async function beat(): Promise<void> {
  try {
    await beatOnce({ sms: smsSender().configured });
  } catch (error) {
    say(`heartbeat failed: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  say("forge runner polling for queued runs, decisions, explorations and owed texts");
  void beat();
  setInterval(() => void beat(), HEARTBEAT_MS).unref();
  // A later pass for each person who is still owed a text while a draft is open (`lib/sms/sweep.ts`).
  runDraftSweeps(say);
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    say(inFlight.size ? `stopping, ${inFlight.size} still in flight` : "stopping");
    process.exit(0);
  });

  while (!stopping) {
    let found = false;
    try {
      found = await tick();
    } catch (error) {
      // A failed poll is the database being unreachable, not a failed run. Keep polling.
      say(`poll failed: ${(error as Error).message}`);
    }
    if (!found) await sleep(POLL_MS);
  }
}

void main();
