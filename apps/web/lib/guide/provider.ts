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

/** The guide's answer, or why there is none, so a caller can say which path it took. */
export type GuideAnswer = { choice: GuideChoice; reason?: undefined } | { choice: null; reason: string };

export type AskGuideOptions = {
  /** The names of the controls already pressed on this walk, oldest first, as in training. */
  walked?: string[];
  timeoutMs?: number;
  runner?: GuideRunner;
};

/**
 * Ask the trained guide which control comes next, and say why when it gives no usable answer:
 * River is not configured, the call failed or ran past `timeoutMs`, or the answer names a control
 * that is not in `controls`.
 */
export async function askGuide(
  question: string,
  controls: GuideControl[],
  options: AskGuideOptions = {},
): Promise<GuideAnswer> {
  const config = riverGuide();
  if (!config) return { choice: null, reason: "River guide model is not configured" };
  if (controls.length === 0) return { choice: null, reason: "no controls on the page" };
  const run = options.runner ?? spawnRunner(config.uv, config.script);
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const walked = options.walked ?? [];
  const input = JSON.stringify(walked.length > 0 ? { question, walked, controls } : { question, controls });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const stdout = await Promise.race([run(input, timeoutMs), timedOut]);
    if (stdout === "timeout") return { choice: null, reason: `no answer within ${timeoutMs / 1000} s` };
    const choice = parseChoice(stdout, controls);
    return choice ? { choice } : { choice: null, reason: "the answer named no control on the page" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { choice: null, reason: `the River call failed: ${message.slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
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
  return (await askGuide(question, controls, { runner })).choice;
}
