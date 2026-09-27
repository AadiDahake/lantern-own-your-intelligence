/**
 * The trained guide model: a LoRA on a River base model that picks the next control to light.
 *
 * River serves a checkpoint through its gRPC chat call, which only its Python client speaks, so
 * this runs `services/guide/choose.py` with the question and the controls on stdin. The model's
 * answer is untrusted: it counts only when it names a control the caller passed in.
 */
import { spawn } from "node:child_process";
import { riverGuide } from "@/lib/env";

export type GuideControl = { id: string; role: string; name: string; state?: string };

export type GuideChoice = { id: string; checkpoint: string; baseModel: string };

/** Runs the River call and returns its stdout. Injected by tests; the default spawns `uv`. */
export type GuideRunner = (input: string, timeoutMs: number) => Promise<string>;

const TIMEOUT_MS = 30_000;

/** True when the guide model can be asked. With no River key the product behaves as before. */
export const guideConfigured = (): boolean => riverGuide() !== null;

function spawnRunner(uv: string, script: string): GuideRunner {
  return (input, timeoutMs) =>
    new Promise((resolve, reject) => {
      const child = spawn(uv, ["run", "--no-project", script], { stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(stdout) : reject(new Error(`guide model exited ${code}: ${stderr.slice(-300)}`)),
      );
      child.stdin.end(input);
    });
}

/**
 * Read the runner's output into a choice, or null when the model named nothing on the page.
 * The last line is the JSON: `uv` may print its own lines first.
 */
export function parseChoice(stdout: string, controls: GuideControl[]): GuideChoice | null {
  const line = stdout.trim().split("\n").at(-1) ?? "";
  let outer: unknown;
  try {
    outer = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof outer !== "object" || outer === null) return null;
  const { answer, checkpoint, base_model: baseModel } = outer as Record<string, unknown>;
  if (typeof answer !== "string" || typeof checkpoint !== "string" || typeof baseModel !== "string") return null;
  const json = /\{[\s\S]*\}/.exec(answer.replace(/<think>[\s\S]*?<\/think>/g, ""));
  if (!json) return null;
  let inner: unknown;
  try {
    inner = JSON.parse(json[0]);
  } catch {
    return null;
  }
  const id = typeof inner === "object" && inner !== null ? (inner as Record<string, unknown>).id : undefined;
  if (typeof id !== "string" || !controls.some((c) => c.id === id)) return null;
  return { id, checkpoint, baseModel };
}

/**
 * Ask the trained guide which control answers `question`. Null when River is not configured, the
 * call fails, or the answer names a control that is not in `controls`.
 */
export async function chooseControl(
  question: string,
  controls: GuideControl[],
  runner?: GuideRunner,
): Promise<GuideChoice | null> {
  const config = riverGuide();
  if (!config || controls.length === 0) return null;
  const run = runner ?? spawnRunner(config.uv, config.script);
  try {
    return parseChoice(await run(JSON.stringify({ question, controls }), TIMEOUT_MS), controls);
  } catch {
    return null;
  }
}
