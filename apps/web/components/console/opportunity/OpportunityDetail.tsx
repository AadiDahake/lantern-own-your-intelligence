"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { opportunityStatusLabel, opportunityStatusTone, reportCountLabel } from "@/lib/console/format";
import type { OpportunityDetail as Detail } from "@/lib/opportunity/read";
import { EvidenceCard } from "./EvidenceCard";
import { ImplementationCard } from "./ImplementationCard";
import { IntentCard } from "./IntentCard";
import { OutcomeCard } from "./OutcomeCard";
import { SpecificationCard } from "./SpecificationCard";
import { Stage } from "./Stage";

const POLL_ACTIVE_MS = 3_000;
const POLL_IDLE_MS = 20_000;

function isActive(detail: Detail): boolean {
  const discovering = detail.discovery?.status === "queued" || detail.discovery?.status === "running";
  const building = detail.forge.run !== null && ["queued", "drafting", "merging", "deploying", "approved"].includes(detail.forge.run.status);
  return discovering || building;
}

/**
 * One opportunity, in the order the story runs: user workflows, inferred intent, semantic
 * capability, verified implementation, then the outcome. The page polls its own route while a
 * discovery or a forge run is going, so the cards fill in as the trace does.
 */
export function OpportunityDetail({ initial, repoFullName }: { initial: Detail; repoFullName: string | null }) {
  const [detail, setDetail] = useState<Detail>(initial);
  // The preview, keyed by the run it was read for, so a stale URL never shows for a new run.
  const [preview, setPreview] = useState<{ runId: string; url: string | null } | null>(null);
  const [error, setError] = useState("");
  const [rerunPending, setRerunPending] = useState(false);
  const groupId = detail.group.id;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/opportunities/${groupId}`);
      const body = (await response.json()) as { opportunity?: Detail; error?: string };
      if (body.opportunity) setDetail(body.opportunity);
      else if (body.error) setError(body.error);
    } catch {
      setError("Could not refresh the opportunity.");
    }
  }, [groupId]);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), isActive(detail) ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => clearInterval(timer);
  }, [detail, refresh]);

  // The preview URL is never stored: the forge route rebuilds and health-checks it on every read.
  const runId = detail.forge.run?.id ?? null;
  const winnerId = detail.forge.run?.winningCandidateId ?? null;
  const runStatus = detail.forge.run?.status ?? null;
  useEffect(() => {
    if (!runId || !winnerId) return;
    let live = true;
    void fetch(`/api/forge/${runId}/preview`)
      .then((response) => response.json() as Promise<{ url?: string | null }>)
      .then((body) => {
        if (live) setPreview({ runId, url: body.url ?? null });
      })
      .catch(() => {
        if (live) setPreview({ runId, url: null });
      });
    return () => {
      live = false;
    };
  }, [runId, winnerId, runStatus]);
  const previewUrl = runId && winnerId && preview?.runId === runId ? preview.url : null;

  async function rerun(): Promise<void> {
    setRerunPending(true);
    setError("");
    try {
      const response = await fetch(`/api/opportunities/${groupId}/discover`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Discovery failed to start (${response.status}).`);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Discovery failed to start.");
    } finally {
      setRerunPending(false);
    }
  }

  const discovering = detail.discovery?.status === "queued" || detail.discovery?.status === "running";

  return (
    <>
      <PageHeader
        eyebrow="Opportunity"
        title={detail.group.title}
        description={detail.spec?.summary ?? detail.group.description}
        actions={
          <>
            <span className={`outcome-badge ${opportunityStatusTone(detail.status)}`}>{opportunityStatusLabel(detail.status)}</span>
            <Link href={`/console/activity?request=${groupId}`} className="ghost-action">
              Open the trace
            </Link>
            <button type="button" className="ghost-action" disabled={rerunPending || discovering} onClick={() => void rerun()}>
              {discovering ? "Discovering..." : rerunPending ? "Starting..." : detail.spec ? "Discover again" : "Discover"}
            </button>
          </>
        }
      />
      <p className="detail-meta" style={{ marginTop: -16, marginBottom: 20 }}>
        <span>{reportCountLabel(detail.group.reportCount, detail.group.userReportCount)}</span>
        {detail.group.area ? <span>Area: {detail.group.area}</span> : null}
        {detail.group.issueUrl ? (
          <a className="ext-link" href={detail.group.issueUrl} target="_blank" rel="noreferrer">
            Issue #{detail.group.issueNumber ?? ""}
          </a>
        ) : null}
      </p>
      {error ? (
        <div className="notice is-error mb-4" role="alert">
          {error}
        </div>
      ) : null}

      <Stage number="1" title="User workflows" hint="PostHog sessions, read as demonstrations of what customers were trying to do." />
      <EvidenceCard evidence={detail.evidence} intent={detail.intent} discovery={detail.discovery} status={detail.status} />

      <Stage number="2" title="Inferred intent" hint="Reverse task synthesis: every session's steps yield the goal behind them, graded on two axes." />
      <IntentCard intent={detail.intent} />

      <Stage number="3" title="Semantic capability" hint="One capability at the right granularity, shaped as structured state and semantic actions." />
      <SpecificationCard spec={detail.spec} />

      <Stage number="4" title="Verified implementation" hint="Two sandboxes, three personas, the scenarios the compiler derived. A person merges." />
      <ImplementationCard
        groupId={groupId}
        run={detail.forge.run}
        candidates={detail.forge.candidates}
        previewUrl={previewUrl}
        repoFullName={repoFullName}
        onChanged={() => void refresh()}
      />

      <Stage number="+" title="Outcome" hint="PostHog's second job: did the change help?" />
      <OutcomeCard
        groupId={groupId}
        outcome={detail.outcome}
        before={{ sessions: detail.evidence.sessionCount, medianInteractions: detail.evidence.medianInteractions }}
        hasSpec={detail.spec !== null}
        onChanged={() => void refresh()}
      />
    </>
  );
}
