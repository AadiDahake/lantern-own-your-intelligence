/**
 * A `ModelClient` backed by the machine's own `codex exec`.
 *
 * `codex exec --output-schema <schema> -o <file>` writes one JSON object that matches the schema,
 * and it reuses the CLI's saved sign-in, so it runs with no API key. Each call gets its own empty
 * working directory and a read-only sandbox: the prompt is the only thing Codex sees.
 *
 * Development only. The server uses the OpenAI client in `apps/web/lib/openai.ts`.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonSchema, ModelClient, ModelPrompt } from "@lantern/capability";

export type CodexCall = {
  purpose: ModelPrompt["purpose"];
  duration_ms: number;
  tokens: number | null;
  model: string | null;
  exit: number;
};

export type CodexModelOptions = {
  /** Root under which every call gets its own directory. */
  workdir: string;
  /** Passed as `-m`. Omitted, the CLI's default model runs. */
  model?: string;
  onCall?: (call: CodexCall) => void;
  /** The executable, for tests. */
  bin?: string;
};

export class CodexModelClient implements ModelClient {
  readonly name: string;
  private counter = 0;

  constructor(private readonly options: CodexModelOptions) {
    this.name = options.model ? `codex:${options.model}` : "codex";
  }

  async structured(prompt: ModelPrompt, schema: JsonSchema): Promise<unknown> {
    const dir = mkdtempSync(join(this.options.workdir, `${prompt.purpose}-${++this.counter}-`));
    const schemaPath = join(dir, "schema.json");
    const outPath = join(dir, "out.json");
    writeFileSync(schemaPath, JSON.stringify(schema));
    writeFileSync(join(dir, "prompt.txt"), `${prompt.system}\n\n${prompt.user}`);
    const args = [
      "exec",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--color",
      "never",
      "-C",
      dir,
      "--output-schema",
      schemaPath,
      "-o",
      outPath,
      ...(this.options.model ? ["-m", this.options.model] : []),
      "-",
    ];
    const started = Date.now();
    const { code, stdout, stderr } = await run(this.options.bin ?? "codex", args, `SYSTEM\n${prompt.system}\n\nUSER\n${prompt.user}\n`);
    // Codex writes its header and the token count to stderr when stdout is not a terminal.
    const log = `${stdout}\n${stderr}`;
    const tokens = /tokens used\s*\n\s*([\d,]+)/.exec(log)?.[1];
    this.options.onCall?.({
      purpose: prompt.purpose,
      duration_ms: Date.now() - started,
      tokens: tokens ? Number(tokens.replace(/,/g, "")) : null,
      model: /^model: (.+?)\s*$/m.exec(log)?.[1] ?? null,
      exit: code,
    });
    if (code !== 0) {
      const tail = `${stderr}\n${stdout}`.trim().split("\n").slice(-12).join("\n");
      throw new Error(`codex exec exited with ${code} for ${prompt.purpose}:\n${tail}`);
    }
    return JSON.parse(readFileSync(outPath, "utf8"));
  }
}

function run(bin: string, args: string[], stdin: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(stdin);
  });
}
