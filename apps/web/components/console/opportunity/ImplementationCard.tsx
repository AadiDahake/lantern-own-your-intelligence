"use client";

import { useState } from "react";
import type { CandidateRow } from "@/lib/forge/store";
import { candidateStatusLabel, candidateStatusTone, escalationLabel, escalationTone } from "@/lib/console/format";
import type { ForgeRun } from "@/lib/opportunity/read";

type CheckState = "ok" | "run" | "bad" | "todo";

const PERSONA_ORDER = ["capability_builder", "ux_builder", "capability_verifier"];

function personaIndex(candidate: CandidateRow): number {
  return PERSONA_ORDER.indexOf(candidate.persona);
}

/** What the five checklist lines say, read off the winner (or the best candidate so far). */
export function checklist(run: ForgeRun | null, candidates: CandidateRow[], previewUrl: string | null) {
  const winner = run ? (candidates.find((c) => c.id === run.winningCandidateId) ?? null) : null;
  const best = winner ?? [...candidates].sort((a, b) => (b.scenariosPassed ?? -1) - (a.scenariosPassed ?? -1) || personaIndex(b) - personaIndex(a))[0] ?? null;
  const active = best !== null && !["failed", "torn_down"].includes(best.status);
  const done = best !== null && (best.status === "ready" || best.status === "testing" || best.status === "torn_down");
  const past = (persona: string): boolean => best !== null && (personaIndex(best) > PERSONA_ORDER.indexOf(persona) || done);
  const state = (ok: boolean, running: boolean): CheckState => (ok ? "ok" : best?.status === "failed" ? "bad" : running ? "run" : "todo");
  const pushed = Boolean(run?.prUrl || run?.branch);
  const tests = best && best.scenariosPassed !== null && best.scenariosTotal !== null ? `${best.scenariosPassed}/${best.scenariosTotal}` : null;
  return {
    winner: best,
    rows: [
      { label: "Capability", state: state(past("capability_builder"), active && best?.persona === "capability_builder"), text: null },
      { label: "UI", state: state(past("ux_builder"), active && best?.persona === "ux_builder"), text: null },
      { label: "Integration", state: state(pushed, active && best?.persona === "capability_verifier" && !pushed), text: run?.branch ? run.branch : null },
      {
        label: "Tests",
        state: tests ? (best?.scenariosPassed === best?.scenariosTotal ? "ok" : "bad") : state(false, active && best?.persona === "capability_verifier"),
        text: tests,
      },
      { label: "Sandbox preview", state: previewUrl ? "ok" : state(false, Boolean(run && !previewUrl && run.status !== "failed" && !run.prUrl)), text: null },
    ],
  };
}

const MARK: Record<CheckState, string> = { ok: "ok", run: "running", bad: "failed", todo: "-" };

/**
 * Stage 4: the generated implementation, from the forge tables. Five lines that read as the plan's
 * checklist, the candidates with their scores, and the four actions, every one a forge route.
 */
export function ImplementationCard({
  groupId,
  run,
  candidates,
  previewUrl,
  repoFullName,
  onChanged,
}: {
  groupId: string;
  run: ForgeRun | null;
  candidates: CandidateRow[];
  previewUrl: string | null;
  repoFullName: string | null;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const { winner, rows } = checklist(run, candidates, previewUrl);

  const active = run !== null && ["queued", "drafting", "filing", "inspecting"].includes(run.status);
  const awaiting = run?.status === "awaiting_approval";
  const codeUrl = run?.prUrl
    ? `${run.prUrl}/files`
    : winner?.branch && repoFullName
      ? `https://github.com/${repoFullName}/tree/${winner.branch}`
      : null;

  async function post(url: string, body: unknown, label: string): Promise<void> {
    setPending(label);
    setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `${label} failed (${response.status}).`);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `${label} failed.`);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Generated implementation</h2>
        {run ? <span className={`outcome-badge ${escalationTone(run.status)}`}>{escalationLabel(run.status)}</span> : null}
      </div>

      {!run ? (
        <p className="opp-quiet">
          Nothing has been built yet. Create Draft PR sends the specification, the sessions and the acceptance
          scenarios into two isolated sandboxes; Codex builds and verifies a candidate in each, the winner serves
          a preview, and a draft pull request opens for a person to approve.
        </p>
      ) : null}

      <ul className="opp-check">
        {rows.map((row) => (
          <li key={row.label}>
            <span>{row.label}</span>
            <span className={`opp-check__state is-${row.state}`}>{row.text ?? MARK[row.state]}</span>
          </li>
        ))}
      </ul>

      {candidates.length > 0 ? (
        <div className="opp-candidates">
          {candidates.map((candidate) => {
            const isWinner = run?.winningCandidateId === candidate.id;
            return (
              <article className={`opp-candidate${isWinner ? " is-winner" : ""}`} key={candidate.id}>
                <div className="opp-candidate__head">
                  <span className="opp-candidate__label">Candidate {candidate.label}</span>
                  <span className={`outcome-badge ${candidateStatusTone(candidate.status)}`}>{candidateStatusLabel(candidate.status)}</span>
                </div>
                <span>
                  {candidate.scenariosPassed !== null && candidate.scenariosTotal !== null
                    ? `${candidate.scenariosPassed} / ${candidate.scenariosTotal} scenarios`
                    : `${candidate.persona.replace(/_/g, " ")} at work`}
                  {candidate.changedFiles ? `, ${candidate.changedFiles.length} files changed` : ""}
                  {isWinner ? ", selected" : ""}
                </span>
                {candidate.failingScenarios && candidate.failingScenarios.length > 0 ? (
                  <ul className="opp-candidate__fails">
                    {candidate.failingScenarios.slice(0, 5).map((id) => (
                      <li key={id}>{id.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                ) : null}
                {candidate.error ? <span className="opp-fact__note">{candidate.error.slice(0, 160)}</span> : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {run?.prUrl ? (
        <p className="trace-row__text">
          Draft PR{run.prNumber !== null ? ` #${run.prNumber}` : ""}:{" "}
          <a className="ext-link" href={run.prUrl} target="_blank" rel="noreferrer">
            {run.prUrl}
          </a>
        </p>
      ) : null}
      {run?.deploymentUrl ? (
        <p className="trace-row__text">
          Deployed:{" "}
          <a className="ext-link" href={run.deploymentUrl} target="_blank" rel="noreferrer">
            {run.deploymentUrl}
          </a>
        </p>
      ) : null}
      {run?.error ? <p className="form-error">{run.error}</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {awaiting ? (
        <>
          <label className="sr-only" htmlFor={`approval-note-${groupId}`}>
            Note for the developer
          </label>
          <input
            id={`approval-note-${groupId}`}
            className="field-input"
            type="text"
            value={note}
            placeholder="Note for the developer, optional"
            onChange={(event) => setNote(event.target.value)}
            style={{ marginTop: 12 }}
          />
        </>
      ) : null}

      <div className="opp-actions">
        <a
          className="secondary-action"
          href={previewUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={previewUrl ? undefined : true}
          onClick={(event) => {
            if (!previewUrl) event.preventDefault();
          }}
          title={previewUrl ? "Opens the winning candidate's sandbox" : "The preview is served once a candidate wins"}
        >
          Open Preview
        </a>
        <a
          className="secondary-action"
          href={codeUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={codeUrl ? undefined : true}
          onClick={(event) => {
            if (!codeUrl) event.preventDefault();
          }}
          title={codeUrl ? "The changed files on GitHub" : "The code appears once a branch is pushed"}
        >
          View Code
        </a>
        {awaiting && run ? (
          <>
            <button
              type="button"
              className="primary-action"
              disabled={pending !== null}
              onClick={() => void post(`/api/escalations/${run.id}/approve`, { approved: true, note }, "Approve & Merge")}
            >
              {pending === "Approve & Merge" ? "Merging..." : "Approve & Merge"}
            </button>
            <button
              type="button"
              className="danger-action"
              disabled={pending !== null}
              onClick={() => void post(`/api/escalations/${run.id}/approve`, { approved: false, note }, "Reject")}
            >
              {pending === "Reject" ? "Rejecting..." : "Reject"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary-action"
            disabled={pending !== null || active || Boolean(run?.prUrl)}
            onClick={() => void post(`/api/opportunities/${groupId}/forge`, {}, "Create Draft PR")}
            title={
              run?.prUrl
                ? "A draft pull request is already open"
                : active
                  ? "The candidates are building"
                  : "Build and verify in two sandboxes, then open a draft pull request"
            }
          >
            {pending === "Create Draft PR" ? "Starting..." : active ? "Building..." : "Create Draft PR"}
          </button>
        )}
      </div>
    </section>
  );
}
