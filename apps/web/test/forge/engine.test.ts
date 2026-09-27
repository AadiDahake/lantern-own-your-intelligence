/**
 * The forge engine end to end, offline: two candidates in a fake strategy replaying recorded
 * Codex output, a memory store instead of the database, and the same selection, preview, push
 * and pull request steps a real run performs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveForge, PAUSE_LABEL, runForge, type ForgeDeps } from "@/lib/forge/engine";
import { parseCapabilityIr } from "@/lib/forge/ir";
import { loadPersonas } from "@/lib/forge/personas";
import { MemoryForgeStore } from "@/lib/forge/store";
import { FakeStrategy, REPO, type FakeBehaviour } from "./fake-strategy";

const IR = parseCapabilityIr(
  JSON.parse(readFileSync(join(__dirname, "..", "..", "lib", "forge", "fixtures", "seat-party-together.ir.json"), "utf8")),
);

function setup(behaviour: FakeBehaviour = {}): { strategy: FakeStrategy; store: MemoryForgeStore; deps: ForgeDeps } {
  const strategy = new FakeStrategy(behaviour);
  const store = new MemoryForgeStore();
  const deps: ForgeDeps = {
    strategy,
    store,
    personas: loadPersonas(),
    codexApiKeyEnvVar: "LANTERN_OPENAI_KEY",
  };
  return { strategy, store, deps };
}

const run = (deps: ForgeDeps, push = true) =>
  runForge(
    {
      escalationId: "esc-0001",
      ir: IR,
      capabilitySpecId: "spec-0001",
      repo: REPO,
      opportunityUrl: "http://localhost:3000/console/activity?escalation=esc-0001",
      push,
    },
    deps,
  );

describe("runForge", () => {
  it("builds two candidates, selects the one that passed every scenario, and pauses on a draft pull request", async () => {
    const { strategy, store, deps } = setup();
    const result = await run(deps);

    expect(result.status).toBe("awaiting_approval");
    expect(result.winner?.label).toBe("B");
    expect(result.pr).toEqual({ url: "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/182", number: 182 });
    expect(result.previewUrl).toBe("https://3000-tkb.tunnel.runloop.ai");

    const a = strategy.sandboxes.get("A")!;
    const b = strategy.sandboxes.get("B")!;
    // The loser goes away before the pull request opens; the winner stays up as the preview.
    expect(a.tornDown).toBe(true);
    expect(b.tornDown).toBe(false);
    expect(b.served).toBe(3000);
    expect(b.pushed).toEqual({ branch: "lantern/seat-party-together-b", message: "feat: add automatic family seat selection" });
    expect(a.pushed).toBeNull();
    expect(b.pr?.title).toBe("Add automatic family seat selection");
    expect(b.pr?.base).toBe("main");

    const titles = store.titles();
    expect(titles[0]).toBe("Forge started");
    expect(titles).toContain("Candidate A provisioning");
    expect(titles).toContain("Candidate B provisioning");
    expect(titles).toContain("Candidate A: 18/21");
    expect(titles).toContain("Candidate B: 21/21");
    expect(titles).toContain("Selected candidate B, 21/21");
    expect(titles).toContain("Preview live");
    expect(titles).toContain("Candidate A torn down");
    expect(titles).toContain("Draft PR #182");
    expect(titles[titles.length - 1]).toBe(PAUSE_LABEL);
    for (const event of store.events) expect(event.source).toBe("forge");

    const verdictA = store.events.find((event) => event.title === "Candidate A: 18/21");
    expect(verdictA?.kind).toBe("candidate");
    expect((verdictA?.detail as { failing: string[] }).failing).toEqual([
      "aisle_separated_not_adjacent",
      "blocked_accessibility_seat_excluded",
      "child_never_alone",
    ]);
    const preview = store.events.find((event) => event.title === "Preview live");
    expect(preview?.kind).toBe("preview");
    expect(preview?.detail).toMatchObject({ url: "https://3000-tkb.tunnel.runloop.ai", candidate: "B" });

    expect(store.escalation).toMatchObject({
      status: "awaiting_approval",
      prUrl: "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/182",
      prNumber: 182,
      branch: "lantern/seat-party-together-b",
    });
    expect(store.group).toEqual({ status: "awaiting_approval", prUrl: "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/182" });

    const rows = [...store.candidates.values()];
    expect(rows.map((row) => [row.label, row.status, row.scenariosPassed, row.scenariosTotal])).toEqual([
      ["A", "torn_down", 18, 21],
      ["B", "ready", 21, 21],
    ]);
    expect(rows[1]?.previewPort).toBe(3000);
    expect(rows[1]?.codexThreadId).toBe("0199a2c1-4f10-7a3b-9c11-000000000b01");
    expect(store.escalation.winningCandidateId).toBe(rows[1]?.id);
  });

  it("runs the three personas in order in each sandbox, resuming the builder's thread for the UX builder", async () => {
    const { strategy, deps } = setup();
    await run(deps);
    const b = strategy.sandboxes.get("B")!;
    const codex = b.commands.filter((command) => command.includes("codex exec"));
    expect(codex).toHaveLength(3);
    expect(codex[0]).toContain("prompt-capability_builder.md");
    expect(codex[0]).toContain("--sandbox workspace-write");
    expect(codex[0]).toContain("-c sandbox_workspace_write.network_access=true");
    expect(codex[0]).toContain("-m gpt-5.6-sol");
    expect(codex[0]).toContain(`CODEX_API_KEY="$LANTERN_OPENAI_KEY"`);
    expect(codex[1]).toContain("exec resume 0199a2c1-4f10-7a3b-9c11-000000000b01");
    expect(codex[1]).toContain("prompt-ux_builder.md");
    expect(codex[2]).toContain("prompt-capability_verifier.md");
    expect(codex[2]).toContain("--output-schema");
    expect(b.commands.some((command) => command.startsWith("npm test -- --reporter=json"))).toBe(true);

    expect(b.files.has(".lantern/spec.json")).toBe(true);
    expect(b.files.has(".lantern/trajectories.json")).toBe(true);
    expect(b.files.get(".lantern/acceptance.md")).toContain("three_contiguous_available");
    expect(b.files.get(".lantern/prompt-capability_builder.md")).toContain("# Capability Builder");
    expect(b.files.get(".lantern/prompt-capability_builder.md")).toContain("Candidate B");
    expect(JSON.parse(b.files.get(".lantern/verifier.schema.json") ?? "{}")).toMatchObject({ required: ["scenarios", "test_command", "test_file", "summary"] });
  });

  it("writes the pull request body with the evidence, the validation and the changed files", async () => {
    const { strategy, deps } = setup();
    await run(deps);
    const body = strategy.sandboxes.get("B")!.pr!.body;
    expect(body).toContain("## Why");
    expect(body).toContain("PostHog found 63 successful sessions");
    expect(body).toContain("median session took 14.2 manual actions");
    expect(body).toContain('Adds "Find seats together" in the seat map toolbar.');
    expect(body).toContain("## Safety");
    expect(body).toContain("A child is never placed in an exit row.");
    expect(body).toContain("21 / 21 sandbox scenarios passed (candidate B, fake sandbox).");
    expect(body).toContain("59 passed, 0 failed");
    expect(body).toContain("`components/seats/FindSeatsTogether.tsx` (add)");
    expect(body).toContain("`tests/no-group-seating.test.ts` (delete)");
    expect(body).toContain("https://3000-tkb.tunnel.runloop.ai");
    expect(body).toContain("Opportunity: http://localhost:3000/console/activity?escalation=esc-0001");
    expect(body).not.toContain(".lantern/");
  });

  it("stops before the push when asked, and reports what it would have pushed", async () => {
    const { strategy, store, deps } = setup();
    const result = await run(deps, false);
    expect(result.status).toBe("ready_to_push");
    expect(result.wouldPush?.branch).toBe("lantern/seat-party-together-b");
    expect(result.wouldPush?.title).toBe("Add automatic family seat selection");
    expect(result.wouldPush?.files).toContain("lib/seats/together.ts");
    expect(strategy.sandboxes.get("B")!.pushed).toBeNull();
    expect(strategy.sandboxes.get("B")!.pr).toBeNull();
    expect(result.winner?.sandbox?.handle.previewPort).toBe(3000);
    expect(store.titles().at(-1)).toContain("Stopped before the push");
    expect(store.escalation.status).toBe("drafting");
  });

  it("keeps going when one candidate cannot be provisioned", async () => {
    const { strategy, store, deps } = setup({ failProvision: ["A"] });
    const result = await run(deps);
    expect(result.status).toBe("awaiting_approval");
    expect(result.winner?.label).toBe("B");
    expect(strategy.sandboxes.has("A")).toBe(false);
    expect(store.titles("error")).toEqual(["Candidate A failed"]);
    const decision = store.events.find((event) => event.kind === "decision");
    expect((decision?.detail as { reason: string }).reason).toContain("did not finish");
    expect([...store.candidates.values()].find((row) => row.label === "A")?.status).toBe("failed");
  });

  it("tears a candidate's sandbox down when its builder fails, and the other still wins", async () => {
    const { strategy, store, deps } = setup({ failBuilder: ["B"] });
    const result = await run(deps);
    expect(result.winner?.label).toBe("A");
    expect(strategy.sandboxes.get("B")!.tornDown).toBe(true);
    expect(store.titles()).toContain("Candidate B failed");
    expect(result.pr?.number).toBe(182);
    expect(strategy.sandboxes.get("A")!.pr!.body).toContain("18 / 21 sandbox scenarios passed");
    expect(strategy.sandboxes.get("A")!.pr!.body).toContain("`aisle_separated_not_adjacent`: seats C and D");
  });

  it("fails the run and tears every sandbox down when no candidate finishes", async () => {
    const { strategy, store, deps } = setup({ failBuilder: ["A", "B"] });
    const result = await run(deps);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("No candidate finished");
    expect(strategy.sandboxes.get("A")!.tornDown).toBe(true);
    expect(strategy.sandboxes.get("B")!.tornDown).toBe(true);
    expect(store.escalation.status).toBe("failed");
    const errors = store.titles("error");
    expect(errors).toContain("Capability Builder (A): the model provider closed the stream");
    expect(errors.slice(-3)).toEqual(["Candidate A failed", "Candidate B failed", "Forge failed"]);
  });

  it("tears every sandbox down when the winner's preview cannot be built", async () => {
    const { strategy, store, deps } = setup({ failBuild: ["B"] });
    const result = await run(deps);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("The build failed for candidate B");
    expect(strategy.sandboxes.get("A")!.tornDown).toBe(true);
    expect(strategy.sandboxes.get("B")!.tornDown).toBe(true);
    expect(strategy.sandboxes.get("B")!.pushed).toBeNull();
    expect(store.escalation.status).toBe("failed");
  });

  it("falls back to running Codex without its own sandbox when Landlock cannot start, and says so", async () => {
    const { strategy, store, deps } = setup({ sandboxFailsOnce: ["B"] });
    const result = await run(deps);
    expect(result.winner?.label).toBe("B");
    const codex = strategy.sandboxes.get("B")!.commands.filter((command) => command.includes("codex exec"));
    expect(codex[0]).toContain("--sandbox workspace-write");
    expect(codex[1]).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(codex[1]).not.toContain("--sandbox workspace-write");
    const notice = store.events.find((event) => event.title.includes("could not start its own sandbox"));
    expect(notice?.kind).toBe("status");
    expect(notice?.detail).toMatchObject({ candidate: "B", flag: "--dangerously-bypass-approvals-and-sandbox" });
  });

  it("hands the target repository's AGENTS.md to every persona", async () => {
    const { strategy, deps } = setup({ seedFiles: { "AGENTS.md": "# NovaAir\n\nUse single quotes." } });
    await run(deps);
    const prompt = strategy.sandboxes.get("B")!.files.get(".lantern/prompt-ux_builder.md") ?? "";
    expect(prompt).toContain("# The repository's AGENTS.md");
    expect(prompt).toContain("Use single quotes.");
  });
});

describe("approveForge", () => {
  const winner = () => ({
    id: "candidate-2",
    label: "B",
    persona: "capability_verifier",
    strategy: "fake",
    status: "ready" as const,
    devboxId: "dbx_fake_b",
    blueprintName: null,
    tunnelKey: "tkb",
    localPath: null,
    previewPort: 3000,
    codexThreadId: null,
    codexExitCode: 0,
    branch: "lantern/seat-party-together-b",
    scenariosPassed: 21,
    scenariosTotal: 21,
    failingScenarios: [],
    testReport: null,
    changedFiles: [],
    error: null,
    startedAt: "2026-08-29T20:00:00Z",
    finishedAt: null,
    tornDownAt: null,
  });

  function github() {
    const calls: string[] = [];
    return {
      calls,
      client: {
        getPullRequest: async () => {
          calls.push("get");
          return { number: 182, url: "u", nodeId: "PR_1", draft: true, state: "open", mergeable: true, mergeableState: "clean", headSha: "abc" };
        },
        markReadyForReview: async (id: string) => {
          calls.push(`ready:${id}`);
          return true;
        },
        waitUntilMergeable: async () => {
          calls.push("mergeable");
          return { number: 182, url: "u", nodeId: "PR_1", draft: false, state: "open", mergeable: true, mergeableState: "clean", headSha: "abc" };
        },
        mergeSquash: async (_repo: string, number: number, title: string) => {
          calls.push(`merge:${number}:${title}`);
          return "9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c";
        },
        closePullRequest: async (_repo: string, number: number, comment?: string) => {
          calls.push(`close:${number}:${comment ?? ""}`);
        },
      },
    };
  }

  it("marks the pull request ready, merges it, watches the deployment and tears the winner down", async () => {
    const strategy = new FakeStrategy();
    const store = new MemoryForgeStore();
    const gh = github();
    const result = await approveForge(
      {
        approved: true,
        note: "Ship it",
        escalation: { id: "esc-0001", prNumber: 182, prUrl: "u", title: "Add automatic family seat selection" },
        winner: winner(),
        repo: { fullName: "AadiDahake/novaair-own-your-intelligence", token: "test-token" },
        vercel: { token: "vercel-test", projectName: "novaair" },
      },
      {
        store,
        strategy,
        github: gh.client as never,
        waitForDeploymentImpl: async (sha, options) => {
          options.report?.("Waiting for the Vercel deployment", "BUILDING");
          return `https://novaair.example.com?sha=${sha.slice(0, 7)}`;
        },
      },
    );
    expect(result).toEqual({ status: "shipped", deploymentUrl: "https://novaair.example.com?sha=9b1c2d3" });
    expect(gh.calls).toEqual(["get", "ready:PR_1", "mergeable", "merge:182:feat: add automatic family seat selection (#182)"]);
    expect(store.escalation).toMatchObject({ status: "shipped", deploymentUrl: "https://novaair.example.com?sha=9b1c2d3" });
    expect(store.group.status).toBe("shipped");
    expect(strategy.tornDownHandles.map((handle) => handle.devboxId)).toEqual(["dbx_fake_b"]);
    const titles = store.titles();
    expect(titles).toEqual([
      "Approved in the console",
      "Status: merging",
      "Marked PR #182 ready for review",
      "Merged PR #182 (squash)",
      "Waiting for the Vercel deployment of 9b1c2d3",
      "Waiting for the Vercel deployment",
      "Deployment is live",
      "Status: shipped",
      "Candidate B torn down",
    ]);
    expect(store.events.find((event) => event.title === "Deployment is live")?.detail).toEqual({
      artifact: "deployment",
      url: "https://novaair.example.com?sha=9b1c2d3",
    });
  });

  it("closes the pull request and tears the winner down on rejection", async () => {
    const strategy = new FakeStrategy();
    const store = new MemoryForgeStore();
    const gh = github();
    const result = await approveForge(
      {
        approved: false,
        note: "Not this week",
        escalation: { id: "esc-0001", prNumber: 182, prUrl: "u", title: "Add automatic family seat selection" },
        winner: winner(),
        repo: { fullName: "AadiDahake/novaair-own-your-intelligence", token: "test-token" },
        vercel: null,
      },
      { store, strategy, github: gh.client as never },
    );
    expect(result.status).toBe("rejected");
    expect(gh.calls).toEqual(["close:182:Rejected from the Lantern console: Not this week"]);
    expect(store.escalation.status).toBe("rejected");
    expect(store.group.status).toBe("rejected");
    expect(strategy.tornDownHandles).toHaveLength(1);
    expect(store.titles()).toEqual(["Closed PR #182", "Status: rejected", "Candidate B torn down"]);
  });

  it("records a failed merge, still tears the winner down, and rethrows", async () => {
    const strategy = new FakeStrategy();
    const store = new MemoryForgeStore();
    const gh = github();
    gh.client.mergeSquash = async () => {
      throw new Error("Pull request #182 is not mergeable (dirty).");
    };
    await expect(
      approveForge(
        {
          approved: true,
          note: "",
          escalation: { id: "esc-0001", prNumber: 182, prUrl: "u", title: "Add automatic family seat selection" },
          winner: winner(),
          repo: { fullName: "AadiDahake/novaair-own-your-intelligence", token: "test-token" },
          vercel: null,
        },
        { store, strategy, github: gh.client as never },
      ),
    ).rejects.toThrow(/not mergeable/);
    expect(store.escalation.status).toBe("failed");
    expect(strategy.tornDownHandles).toHaveLength(1);
    expect(store.titles("error")).toEqual(["Approval failed"]);
  });
});
