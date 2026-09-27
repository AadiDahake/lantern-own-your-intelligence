/**
 * The capability compiler from a terminal.
 *
 *   npm run compile -- --fixtures            the fixtures through the fake model, no network
 *   npm run compile -- --codex               the same fixtures through the machine's `codex exec`
 *
 * Options:
 *   --model <id>        model for --codex (default: the CLI's own default)
 *   --concurrency <n>   reward batches in flight at once (default 3)
 *   --out <file>        write the full IR, trajectories included, to a file
 *   --full              print the full IR instead of abbreviating the trajectories
 *   --unrelated         run only the unrelated sessions, to see the "none" decision
 *
 * Every compiler event prints as it happens, then the decision trail and the IR.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compile,
  NOVAAIR_CONTEXT,
  STAGES,
  STAGE_ORDER,
  type CompilerEvent,
  type CompilerStage,
  type ModelClient,
  type Trajectory,
} from "@lantern/capability";
import { FakeModelClient } from "@lantern/capability/fake-model";
import { CodexModelClient } from "./lib/codex-model";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, "..", "packages", "capability", "test", "fixtures", "sessions.json");

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string): string => (color ? `\x1b[2m${s}\x1b[0m` : s);
const accent = (s: string): string => (color ? `\x1b[38;5;202m${s}\x1b[0m` : s);
const bold = (s: string): string => (color ? `\x1b[1m${s}\x1b[0m` : s);

function usage(): never {
  console.error("usage: npm run compile -- (--fixtures | --codex) [--model id] [--concurrency n] [--out file] [--full] [--unrelated]");
  process.exit(2);
}

function clock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19);
}

let currentStage: CompilerStage | null = null;

/** One header per story stage, with the research that powers it, then its events indented. */
function printEvent(e: CompilerEvent): void {
  if (e.stage !== currentStage) {
    currentStage = e.stage;
    const n = STAGE_ORDER.indexOf(e.stage) + 1;
    const label = `${n}. ${STAGES[e.stage].title}`;
    console.log(`\n${accent(label.padEnd(28, " "))} ${dim(STAGES[e.stage].powered_by)}`);
  }
  console.log(`   ${dim(clock(e.at))}  ${e.title}`);
  const detailed = e.title.startsWith("Chosen:") || e.title.startsWith("Named:") || e.title.startsWith("No capability") || e.title.startsWith("Capability specification");
  if (!detailed) return;
  const detail = { ...e.detail };
  delete detail.chosen;
  delete detail.rejected;
  for (const [k, v] of Object.entries(detail)) {
    const text = typeof v === "string" ? v : JSON.stringify(v);
    console.log(`             ${dim(`${k}: ${text.length > 150 ? `${text.slice(0, 147)}...` : text}`)}`);
  }
}

function abbreviate(ir: Record<string, unknown>): Record<string, unknown> {
  const evidence = ir.evidence as { trajectories: Array<{ session_id: string; reward?: unknown; steps: unknown[] }> } & Record<string, unknown>;
  return {
    ...ir,
    evidence: {
      ...evidence,
      trajectories: evidence.trajectories.slice(0, 3).map((t) => ({ ...t, steps: `${t.steps.length} steps` })),
      trajectories_omitted: Math.max(0, evidence.trajectories.length - 3),
    },
  };
}

async function main(): Promise<void> {
  if (flag("fixtures") === flag("codex")) usage();
  const rows = JSON.parse(readFileSync(FIXTURES, "utf8")) as Trajectory[];
  const trajectories = flag("unrelated")
    ? rows.filter(
        (r) =>
          r.steps.every((s) => s.event === "help_article_viewed") ||
          r.steps.some((s) => s.event === "seat_map_opened" && s.props.party_size === 1),
      )
    : rows;

  let model: ModelClient;
  if (flag("codex")) {
    const workdir = join(tmpdir(), `lantern-compile-${process.pid}`);
    mkdirSync(workdir, { recursive: true });
    model = new CodexModelClient({
      workdir,
      model: value("model"),
      onCall: (call) =>
        console.log(
          `${dim("         ")} ${dim("codex        ")} ${call.purpose} ${call.model ?? ""} ${(call.duration_ms / 1000).toFixed(1)}s${call.tokens ? `, ${call.tokens} tokens` : ""}${call.exit === 0 ? "" : `, exit ${call.exit}`}`,
        ),
    });
    console.log(`${bold("lantern")} capability compiler, ${trajectories.length} trajectories, model: codex exec (${workdir})\n`);
  } else {
    model = new FakeModelClient();
    console.log(`${bold("lantern")} capability compiler, ${trajectories.length} trajectories, model: fake (offline)\n`);
  }

  const started = Date.now();
  const result = await compile(trajectories, NOVAAIR_CONTEXT, model, {
    onEvent: printEvent,
    concurrency: Number(value("concurrency") ?? 3),
  });
  console.log(`\n${dim(`${result.events.length} events in ${((Date.now() - started) / 1000).toFixed(1)}s, model ${model.name}`)}`);

  if (result.decision === "none") {
    console.log(`\n${bold("decision: none")}`);
    for (const reason of result.reasons) console.log(`  - ${reason}`);
    console.log(`\n${bold("candidates considered")}`);
    for (const r of result.rejected) {
      console.log(`  ${r.name.padEnd(22)} ${dim(`goal ${r.goal}`.padEnd(28))} level ${r.level}  support ${Math.round(r.support * 100)}%  replaces ${r.replaces}  ${r.reason}`);
    }
    return;
  }

  const ir = result.ir as unknown as Record<string, unknown>;
  const out = value("out");
  if (out) {
    writeFileSync(out, `${JSON.stringify(result.ir, null, 2)}\n`);
    console.log(dim(`full IR written to ${out}`));
  }
  console.log(`\n${bold(`decision: capability ${result.ir.intent}`)}\n`);
  console.log(JSON.stringify(flag("full") ? ir : abbreviate(ir), null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
