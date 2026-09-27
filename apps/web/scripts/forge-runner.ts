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
import { claimQueuedExploration, runClaimedExploration } from "../lib/graph/jobs";

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

async function main(): Promise<void> {
  say("forge runner polling for queued runs, decisions and explorations");
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
