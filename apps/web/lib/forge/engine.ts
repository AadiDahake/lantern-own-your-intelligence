/**
 * The forge engine: steps 8 to 18 of the evidence loop.
 *
 * Two candidates build the capability in parallel, each in its own sandbox with the three
 * personas in sequence. The verification result selects the winner. The winner serves the
 * preview, pushes its branch and opens a draft pull request. Then the run pauses for a person.
 * Approval merges, watches the deployment and tears the last sandbox down.
 *
 * Nothing in here touches the target repository's default branch. Every sandbox that is not the
 * winner is torn down before the pull request opens; the winner is torn down on the decision.
 */
import { GithubClient } from "../github";
import { CANDIDATE_PLANS, runCandidate, type CandidateOutcome } from "./candidate";
import { waitForDeployment } from "./deploy";
import type { CapabilityIr } from "./ir";
import type { Personas } from "./personas";
import { prBody, prTitle } from "./pr";
import { selectWinner } from "./select";
import type { CandidateRow, ForgeStore } from "./store";
import type { SandboxStrategy, TargetRepo } from "./strategy";

export const PAUSE_LABEL = "Approve & merge?";

export type ForgeRunInput = {
  escalationId: string;
  ir: CapabilityIr;
  capabilitySpecId: string | null;
  repo: TargetRepo;
  /** Link back to the opportunity in the console, for the pull request body. */
  opportunityUrl: string | null;
  /**
   * False stops before the push and reports what would have been pushed. For development runs
   * against a repository nobody has agreed to receive a branch from.
   */
  push: boolean;
};

export type ForgeDeps = {
  strategy: SandboxStrategy;
  store: ForgeStore;
  personas: Personas;
  codexApiKeyEnvVar: string | null;
  log?: (line: string) => void;
};

export type ForgeRunResult = {
  status: "awaiting_approval" | "ready_to_push" | "failed";
  winner: CandidateOutcome | null;
  candidates: CandidateOutcome[];
  previewUrl: string | null;
  pr: { url: string; number: number } | null;
  /** What the push step would have done, when `push` was false. */
  wouldPush: { branch: string; title: string; body: string; files: string[] } | null;
  error: string | null;
};

const commitMessage = (title: string): string => `feat: ${title.charAt(0).toLowerCase()}${title.slice(1)}`;

/** Runs the whole pipeline for one escalation. Resolves when it pauses for approval, or fails. */
export async function runForge(input: ForgeRunInput, deps: ForgeDeps): Promise<ForgeRunResult> {
  const { store, strategy } = deps;
  const { ir, repo } = input;
  const log = deps.log ?? (() => undefined);

  await store.updateEscalation({ status: "drafting" });
  await store.trace({
    kind: "status",
    status: "running",
    title: "Forge started",
    detail: {
      intent: ir.intent,
      strategy: strategy.name,
      candidates: CANDIDATE_PLANS.map((plan) => plan.label),
      repo: repo.fullName,
      base: repo.defaultBranch,
      scenarios: ir.success.scenarios.length,
    },
  });

  const settled = await Promise.all(
    CANDIDATE_PLANS.map((plan) =>
      runCandidate(plan, {
        ir,
        repo,
        escalationId: input.escalationId,
        capabilitySpecId: input.capabilitySpecId,
        personas: deps.personas,
        strategy,
        store,
        codexApiKeyEnvVar: deps.codexApiKeyEnvVar,
        log,
      }),
    ),
  );

  const result: ForgeRunResult = {
    status: "failed",
    winner: null,
    candidates: settled,
    previewUrl: null,
    pr: null,
    wouldPush: null,
    error: null,
  };

  try {
    const selection = selectWinner(
      settled.map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        status: candidate.status,
        scenariosPassed: candidate.verification?.scenariosPassed ?? 0,
        scenariosTotal: candidate.verification?.scenariosTotal ?? 0,
        changedFiles: candidate.changedFiles.length,
      })),
    );
    if (!selection) {
      throw new Error(
        `No candidate finished. ${settled.map((candidate) => `${candidate.label}: ${candidate.error ?? "unknown"}`).join("; ")}`,
      );
    }
    const winner = settled.find((candidate) => candidate.id === selection.winner.id) as CandidateOutcome;
    const verification = winner.verification;
    if (!winner.sandbox || !verification) throw new Error("The winning candidate has no sandbox.");
    result.winner = winner;

    await store.updateEscalation({ winningCandidateId: winner.id });
    await store.trace({
      kind: "decision",
      status: "ok",
      title: `Selected candidate ${winner.label}, ${verification.scenariosPassed}/${verification.scenariosTotal}`,
      detail: {
        candidate: winner.label,
        reason: selection.reason,
        scenarios_passed: verification.scenariosPassed,
        scenarios_total: verification.scenariosTotal,
        failing: verification.failingScenarios,
        files_changed: winner.changedFiles.length,
      },
    });

    // The preview: build, serve, and only then announce a URL that has answered.
    const port = await strategy.previewPort();
    await store.trace({
      kind: "preview",
      status: "running",
      title: `Building the preview of candidate ${winner.label}`,
      detail: { candidate: winner.label, port },
    });
    result.previewUrl = await winner.sandbox.serve(port);
    await store.updateCandidate(winner.id, {
      previewPort: port,
      tunnelKey: winner.sandbox.handle.tunnelKey ?? null,
    });
    await store.trace({
      kind: "preview",
      status: "ok",
      title: "Preview live",
      detail: { url: result.previewUrl, candidate: winner.label, port, sandbox: winner.sandbox.handle },
    });

    // The losers go first, so a failure past this point cannot leave two boxes behind.
    for (const candidate of settled) {
      if (candidate.id === winner.id || !candidate.sandbox) continue;
      await candidate.sandbox.teardown();
      candidate.sandbox = null;
      await store.updateCandidate(candidate.id, { status: "torn_down", tornDownAt: new Date().toISOString() });
      await store.trace({
        kind: "status",
        status: "ok",
        title: `Candidate ${candidate.label} torn down`,
        detail: { candidate: candidate.label },
      });
    }

    const title = prTitle(ir);
    const body = prBody({
      ir,
      candidateLabel: winner.label,
      verification,
      changedFiles: winner.changedFiles,
      previewUrl: result.previewUrl,
      opportunityUrl: input.opportunityUrl,
      strategy: strategy.name,
    });

    if (!input.push) {
      result.wouldPush = { branch: winner.branch, title, body, files: winner.changedFiles.map((file) => file.path) };
      result.status = "ready_to_push";
      await store.trace({
        kind: "status",
        status: "ok",
        title: `Stopped before the push: ${winner.branch} would open "${title}"`,
        detail: { branch: winner.branch, title, files: result.wouldPush.files, body },
      });
      return result;
    }

    const pushed = await winner.sandbox.pushBranch(winner.branch, commitMessage(title));
    await store.trace({
      kind: "tool",
      status: "ok",
      title: `Pushed ${winner.branch}`,
      detail: {
        tool: "git",
        transport: "git",
        args_summary: `push origin ${winner.branch}`,
        result_summary: `commit ${pushed.sha.slice(0, 7)}`,
      },
    });

    const pr = await winner.sandbox.openDraftPr({
      branch: winner.branch,
      base: repo.defaultBranch,
      title,
      body,
    });
    result.pr = { url: pr.url, number: pr.number };
    await store.updateEscalation({
      status: "pr_open",
      prUrl: pr.url,
      prNumber: pr.number,
      branch: winner.branch,
    });
    await store.updateGroup({ status: "pr_open", prUrl: pr.url });
    await store.trace({
      kind: "artifact",
      status: "ok",
      title: `Draft PR #${pr.number}`,
      detail: {
        artifact: "pr",
        url: pr.url,
        number: pr.number,
        branch: winner.branch,
        title,
        files: winner.changedFiles.map((file) => file.path),
        body,
      },
    });

    await store.updateEscalation({ status: "awaiting_approval" });
    await store.updateGroup({ status: "awaiting_approval" });
    await store.trace({
      kind: "pause",
      status: "running",
      title: PAUSE_LABEL,
      detail: { label: PAUSE_LABEL, prUrl: pr.url, previewUrl: result.previewUrl, candidate: winner.label },
    });
    result.status = "awaiting_approval";
    return result;
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    result.error = message;
    result.status = "failed";
    await store.trace({
      kind: "error",
      status: "failed",
      title: "Forge failed",
      detail: { message: message.slice(0, 4000) },
    });
    await store.updateEscalation({ status: "failed", error: message.slice(0, 2000) });
    await store.updateGroup({ status: "drafting" });
    return result;
  } finally {
    // On any failure every sandbox goes away. On success only the winner stays, on purpose:
    // it is the preview and the branch until a person decides.
    if (result.status === "failed") {
      for (const candidate of settled) {
        if (!candidate.sandbox) continue;
        await candidate.sandbox.teardown().catch((teardownError: Error) => log(`teardown failed: ${teardownError.message}`));
        candidate.sandbox = null;
        await store.updateCandidate(candidate.id, { status: "torn_down", tornDownAt: new Date().toISOString() });
      }
    }
  }
}

export type ApprovalInput = {
  approved: boolean;
  note: string;
  escalation: { id: string; prNumber: number | null; prUrl: string | null; title: string };
  winner: CandidateRow | null;
  repo: { fullName: string; token: string };
  vercel: { token: string; projectName: string; productionUrl?: string | null } | null;
};

export type ApprovalDeps = {
  store: ForgeStore;
  strategy: SandboxStrategy;
  github?: GithubClient;
  waitForDeploymentImpl?: typeof waitForDeployment;
  log?: (line: string) => void;
};

/**
 * The decision. Rejection closes the pull request. Approval marks it ready, merges it, watches
 * the deployment and reports it live. Both end by tearing the winner's sandbox down.
 */
export async function approveForge(input: ApprovalInput, deps: ApprovalDeps): Promise<{ status: string; deploymentUrl: string | null }> {
  const { store } = deps;
  const github = deps.github ?? new GithubClient(input.repo.token);
  const { escalation } = input;
  const teardownWinner = async (): Promise<void> => {
    if (!input.winner || input.winner.status === "torn_down") return;
    const handle = {
      strategy: input.winner.strategy as "runloop" | "local",
      devboxId: input.winner.devboxId,
      tunnelKey: input.winner.tunnelKey,
      localPath: input.winner.localPath,
      previewPort: input.winner.previewPort,
    };
    await deps.strategy.teardown(handle).catch((error: Error) => deps.log?.(`teardown failed: ${error.message}`));
    await store.updateCandidate(input.winner.id, { status: "torn_down", tornDownAt: new Date().toISOString() });
    await store.trace({
      kind: "status",
      status: "ok",
      title: `Candidate ${input.winner.label} torn down`,
      detail: { candidate: input.winner.label },
    });
  };

  try {
    if (!input.approved) {
      const note = input.note.trim() || "Closed without merging.";
      if (escalation.prNumber !== null) {
        await github.closePullRequest(input.repo.fullName, escalation.prNumber, `Rejected from the Lantern console: ${note}`);
        await store.trace({
          kind: "tool",
          status: "ok",
          title: `Closed PR #${escalation.prNumber}`,
          detail: { tool: "close_pull_request", transport: "rest", args_summary: `PATCH /pulls/${escalation.prNumber} state=closed`, result_summary: note },
        });
      }
      await store.updateEscalation({ status: "rejected" });
      await store.updateGroup({ status: "rejected" });
      await store.trace({ kind: "status", status: "ok", title: "Status: rejected", detail: { status: "rejected", note } });
      await teardownWinner();
      return { status: "rejected", deploymentUrl: null };
    }

    if (escalation.prNumber === null) throw new Error("There is no pull request to merge.");
    await store.trace({
      kind: "status",
      status: "ok",
      title: "Approved in the console",
      detail: { status: "approved", note: input.note },
    });
    await store.updateEscalation({ status: "merging" });
    await store.trace({ kind: "status", status: "running", title: "Status: merging", detail: { status: "merging" } });

    const pull = await github.getPullRequest(input.repo.fullName, escalation.prNumber);
    if (pull.draft) {
      await github.markReadyForReview(pull.nodeId);
      await store.trace({
        kind: "tool",
        status: "ok",
        title: `Marked PR #${escalation.prNumber} ready for review`,
        detail: { tool: "markPullRequestReadyForReview", transport: "rest", args_summary: `pullRequestId=${pull.nodeId}`, result_summary: "isDraft=false" },
      });
    }
    await github.waitUntilMergeable(input.repo.fullName, escalation.prNumber);
    const mergeSha = await github.mergeSquash(
      input.repo.fullName,
      escalation.prNumber,
      `${commitMessage(escalation.title)} (#${escalation.prNumber})`,
      "Built and verified by Lantern in an isolated sandbox. Approved in the Lantern console.",
    );
    await store.trace({
      kind: "tool",
      status: "ok",
      title: `Merged PR #${escalation.prNumber} (squash)`,
      detail: { tool: "merge_pull_request", transport: "rest", args_summary: `PUT /pulls/${escalation.prNumber}/merge squash`, result_summary: `merge commit ${mergeSha.slice(0, 7)}` },
    });

    let deploymentUrl: string | null = null;
    if (input.vercel) {
      await store.updateEscalation({ status: "deploying" });
      await store.trace({
        kind: "status",
        status: "running",
        title: `Waiting for the Vercel deployment of ${mergeSha.slice(0, 7)}`,
        detail: { status: "deploying", sha: mergeSha },
      });
      const wait = deps.waitForDeploymentImpl ?? waitForDeployment;
      deploymentUrl = await wait(mergeSha, {
        token: input.vercel.token,
        projectName: input.vercel.projectName,
        productionUrl: input.vercel.productionUrl,
        report: (title, state) => {
          void store.trace({ kind: "status", status: "running", title, detail: { sha: mergeSha, readyState: state } });
        },
      });
      await store.trace({
        kind: "artifact",
        status: "ok",
        title: "Deployment is live",
        detail: { artifact: "deployment", url: deploymentUrl },
      });
    } else {
      await store.trace({
        kind: "status",
        status: "ok",
        title: "No Vercel token is set, so the deployment was not watched",
        detail: { sha: mergeSha },
      });
    }

    await store.updateEscalation({ status: "shipped", deploymentUrl });
    await store.updateGroup({ status: "shipped" });
    await store.trace({
      kind: "status",
      status: "ok",
      title: "Status: shipped",
      detail: { status: "shipped", url: deploymentUrl, sha: mergeSha },
    });
    await teardownWinner();
    return { status: "shipped", deploymentUrl };
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    await store.trace({ kind: "error", status: "failed", title: "Approval failed", detail: { message: message.slice(0, 4000) } });
    await store.updateEscalation({ status: "failed", error: message.slice(0, 2000) });
    await teardownWinner();
    throw error;
  }
}
