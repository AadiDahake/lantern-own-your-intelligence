import { describe, expect, it } from "vitest";
import { codexArgs, codexCommand, codexStream, looksLikeSandboxFailure, parseCodexLine, traceForEvent } from "@/lib/forge/codex";
import type { ThreadEvent } from "@/lib/forge/codex-events";
import { fixture } from "./fake-strategy";

describe("codexArgs", () => {
  it("builds the exact headless invocation", () => {
    expect(
      codexArgs({
        repoDir: "/home/user/novaair",
        promptFile: "/home/user/novaair/.lantern/prompt-capability_builder.md",
        lastMessageFile: "/home/user/novaair/.lantern/last-capability_builder.md",
      }),
    ).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.network_access=true",
      "--skip-git-repo-check",
      "--json",
      "-m",
      "gpt-5.6-sol",
      "-C",
      "/home/user/novaair",
      "-o",
      "/home/user/novaair/.lantern/last-capability_builder.md",
      "-",
    ]);
  });

  it("resumes a thread through config overrides, because resume takes no sandbox flag", () => {
    const args = codexArgs({
      repoDir: "/r",
      promptFile: "/r/.lantern/prompt-ux_builder.md",
      lastMessageFile: "/r/.lantern/last-ux_builder.md",
      resumeThreadId: "0199-thread",
    });
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "0199-thread"]);
    expect(args).toContain('sandbox_mode="workspace-write"');
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("-C");
  });

  it("adds the output schema, the writable roots and the bypass flag when asked", () => {
    const args = codexArgs({
      repoDir: "/r",
      promptFile: "/r/p.md",
      lastMessageFile: "/r/o.json",
      outputSchemaFile: "/r/schema.json",
      extraWritableDirs: ["/cache/node_modules"],
    });
    expect(args).toContain("--output-schema");
    expect(args).toContain('sandbox_workspace_write.writable_roots=["/cache/node_modules"]');
    const bypass = codexArgs({ repoDir: "/r", promptFile: "/r/p.md", lastMessageFile: "/r/o", bypassSandbox: true, extraWritableDirs: ["/x"] });
    expect(bypass).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(bypass).not.toContain("--sandbox");
    expect(bypass.join(" ")).not.toContain("writable_roots");
  });
});

describe("codexCommand", () => {
  it("hands the key to the Codex process only and reads the prompt from a file", () => {
    const command = codexCommand({
      repoDir: "/home/user/nova air",
      promptFile: "/home/user/nova air/.lantern/prompt.md",
      lastMessageFile: "/tmp/last.md",
      apiKeyEnvVar: "LANTERN_OPENAI_KEY",
    });
    expect(command.startsWith(`cd '/home/user/nova air' && CODEX_API_KEY="$LANTERN_OPENAI_KEY" codex exec`)).toBe(true);
    expect(command.endsWith(`- < '/home/user/nova air/.lantern/prompt.md'`)).toBe(true);
    expect(command).not.toMatch(/sk-/);
  });

  it("runs on the saved login when no key variable is named", () => {
    const command = codexCommand({ repoDir: "/r", promptFile: "/r/p", lastMessageFile: "/r/o", apiKeyEnvVar: null });
    expect(command).not.toContain("CODEX_API_KEY");
  });
});

describe("parseCodexLine", () => {
  it("reads an event and ignores the banner", () => {
    expect(parseCodexLine("OpenAI Codex v0.151.0")).toBeNull();
    expect(parseCodexLine('{"type":"thread.started","thread_id":"t1"}')).toEqual({ type: "thread.started", thread_id: "t1" });
    expect(parseCodexLine('{"type":"item.completed","item":{"id":"i","type":"mystery"}}')).toBeNull();
    expect(parseCodexLine("{not json")).toBeNull();
  });
});

describe("codexStream", () => {
  it("collects the thread id, the changed files, the commands and the last message from a recorded run", () => {
    const events: ThreadEvent[] = [];
    const stream = codexStream((event) => events.push(event));
    stream.push("OpenAI Codex v0.151.0");
    for (const line of fixture("candidate-b.builder.jsonl").trim().split("\n")) stream.push(line);

    expect(stream.summary.threadId).toBe("0199a2c1-4f10-7a3b-9c11-000000000b01");
    expect(stream.summary.commands).toBe(5);
    expect(stream.summary.failedCommands).toBe(0);
    expect(stream.summary.changedFiles).toEqual([
      { path: "lib/seats/together.ts", kind: "add" },
      { path: "lib/seats/index.ts", kind: "update" },
      { path: "app/api/seats/[flightId]/together/route.ts", kind: "add" },
      { path: "tests/no-group-seating.test.ts", kind: "delete" },
    ]);
    expect(stream.summary.usage?.output_tokens).toBe(7212);
    expect(stream.summary.lastMessage).toContain("Deleted tests/no-group-seating.test.ts");
    expect(stream.summary.noise).toEqual(["OpenAI Codex v0.151.0"]);
    expect(stream.summary.failure).toBeNull();
    expect(events.filter((event) => event.type === "item.completed")).toHaveLength(10);
  });

  it("keeps an added file as an addition when it is edited later in the same run", () => {
    const stream = codexStream(() => undefined);
    stream.push(JSON.stringify({ type: "item.completed", item: { id: "1", type: "file_change", status: "completed", changes: [{ path: "a.ts", kind: "add" }] } }));
    stream.push(JSON.stringify({ type: "item.completed", item: { id: "2", type: "file_change", status: "completed", changes: [{ path: "a.ts", kind: "update" }] } }));
    expect(stream.summary.changedFiles).toEqual([{ path: "a.ts", kind: "add" }]);
  });

  it("makes file paths relative to the repository", () => {
    const stream = codexStream(() => undefined, { repoDir: "/home/user/novaair" });
    stream.push(JSON.stringify({ type: "item.completed", item: { id: "1", type: "file_change", status: "completed", changes: [{ path: "/home/user/novaair/lib/a.ts", kind: "add" }, { path: "lib/b.ts", kind: "update" }] } }));
    expect(stream.summary.changedFiles).toEqual([{ path: "lib/a.ts", kind: "add" }, { path: "lib/b.ts", kind: "update" }]);
  });

  it("records a failed turn", () => {
    const stream = codexStream(() => undefined);
    stream.push(JSON.stringify({ type: "turn.failed", error: { message: "context window exceeded" } }));
    expect(stream.summary.failure).toBe("context window exceeded");
  });
});

describe("traceForEvent", () => {
  const context = { persona: "Capability Builder", candidate: "A" };

  it("turns a completed command into a tool row", () => {
    const row = traceForEvent(
      { type: "item.completed", item: { id: "i", type: "command_execution", command: "bash -lc 'npm test'", aggregated_output: "a\nb\nc", exit_code: 0, status: "completed" } },
      context,
    );
    expect(row).toMatchObject({ kind: "tool", status: "ok", title: "Capability Builder (A): bash -lc 'npm test'" });
    expect(row?.detail).toMatchObject({ tool: "codex", transport: "shell", args_summary: "bash -lc 'npm test'", exit_code: 0 });
  });

  it("marks a command that exited non-zero as failed", () => {
    const row = traceForEvent(
      { type: "item.completed", item: { id: "i", type: "command_execution", command: "npm test", aggregated_output: "", exit_code: 1, status: "failed" } },
      context,
    );
    expect(row?.status).toBe("failed");
  });

  it("turns a file change into an artifact row with the files", () => {
    const row = traceForEvent(
      { type: "item.completed", item: { id: "i", type: "file_change", status: "completed", changes: [{ path: "lib/x.ts", kind: "add" }, { path: "lib/y.ts", kind: "update" }] } },
      context,
    );
    expect(row?.kind).toBe("artifact");
    expect(row?.title).toBe("Capability Builder (A): changed 2 files");
    expect(row?.detail).toMatchObject({ artifact: "file_change", files: [{ path: "lib/x.ts", kind: "add" }, { path: "lib/y.ts", kind: "update" }] });
  });

  it("keeps reasoning and in-progress items out of the trace", () => {
    expect(traceForEvent({ type: "item.completed", item: { id: "i", type: "reasoning", text: "thinking" } }, context)).toBeNull();
    expect(traceForEvent({ type: "item.started", item: { id: "i", type: "command_execution", command: "ls", aggregated_output: "", status: "in_progress" } }, context)).toBeNull();
    expect(traceForEvent({ type: "turn.started" }, context)).toBeNull();
  });

  it("turns a fatal error into an error row", () => {
    expect(traceForEvent({ type: "error", message: "boom" }, context)).toMatchObject({ kind: "error", status: "failed" });
    expect(traceForEvent({ type: "turn.failed", error: { message: "x" } }, context)).toMatchObject({ kind: "error", title: "Capability Builder (A): turn failed" });
  });
});

describe("looksLikeSandboxFailure", () => {
  it("recognises a run that died on Landlock before its first turn", () => {
    const stream = codexStream(() => undefined);
    stream.push("ERROR: failed to create sandbox: Landlock is not supported by this kernel");
    expect(looksLikeSandboxFailure(1, stream.summary)).toBe(true);
  });

  it("does not blame the sandbox for a run that completed a turn or exited cleanly", () => {
    const completed = codexStream(() => undefined);
    completed.push("Landlock mentioned in passing");
    completed.push(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }));
    expect(looksLikeSandboxFailure(1, completed.summary)).toBe(false);
    const clean = codexStream(() => undefined);
    clean.push("sandbox: workspace-write");
    expect(looksLikeSandboxFailure(0, clean.summary)).toBe(false);
  });
});
