"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { AgentLive } from "@/components/console/AgentLive";
import type { ConsoleDocument } from "@/lib/ingest/types";
import { AddSource } from "./AddSource";
import { ImportHelpCenter } from "./ImportHelpCenter";
import { PreviewDrawer } from "./PreviewDrawer";
import { RecreateIndex } from "./RecreateIndex";
import { SourceList } from "./SourceList";
import { TestQuestion } from "./TestQuestion";

type Props = {
  initialDocuments: ConsoleDocument[];
  siteUrl: string | null;
  /** Without a repository the agent can read, but it cannot file anything it finds missing. */
  repoBound: boolean;
};

/** Adding sources, seeing what came out of them, and proving what the agent would retrieve. */
export function KnowledgeConsole({ initialDocuments, siteUrl, repoBound }: Props) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [previewing, setPreviewing] = useState<ConsoleDocument | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Sources are permanent; "this session" is what the person in front of the screen just added.
  const [addedHere, setAddedHere] = useState(0);

  const stats = useMemo(() => summarise(documents), [documents]);

  const upsert = useCallback((document: ConsoleDocument) => {
    setDocuments((current) => {
      const rest = current.filter((row) => row.id !== document.id);
      return [document, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  const reindex = useCallback(
    async (document: ConsoleDocument) => {
      setBusyId(document.id);
      setError("");
      try {
        const response = await fetch(`/api/documents/${document.id}/reindex`, { method: "POST" });
        const result = (await response.json()) as { document?: ConsoleDocument; error?: string };
        if (!response.ok || !result.document) {
          throw new Error(result.error ?? "That source could not be read again.");
        }
        upsert(result.document);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "That source could not be read again.");
      } finally {
        setBusyId(null);
      }
    },
    [upsert],
  );

  const replace = useCallback(
    async (document: ConsoleDocument, file: File) => {
      setBusyId(document.id);
      setError("");
      try {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch(`/api/documents/${document.id}/reindex`, {
          method: "POST",
          body: form,
        });
        const result = (await response.json()) as { document?: ConsoleDocument; error?: string };
        if (!response.ok || !result.document) {
          throw new Error(result.error ?? "That file could not be read.");
        }
        upsert(result.document);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "That file could not be read.");
      } finally {
        setBusyId(null);
      }
    },
    [upsert],
  );

  const remove = useCallback(async (document: ConsoleDocument) => {
    setBusyId(document.id);
    setError("");
    try {
      const response = await fetch(`/api/documents/${document.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? "That source could not be removed.");
      }
      setDocuments((current) => current.filter((row) => row.id !== document.id));
      setPreviewing((current) => (current?.id === document.id ? null : current));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That source could not be removed.");
    } finally {
      setBusyId(null);
    }
  }, []);

  const added = useCallback(
    (document: ConsoleDocument) => {
      setAddedHere((value) => value + 1);
      upsert(document);
    },
    [upsert],
  );

  const imported = useCallback(
    (imports: ConsoleDocument[]) => {
      setError("");
      setAddedHere((value) => value + imports.length);
      for (const document of imports) upsert(document);
    },
    [upsert],
  );

  return (
    <>
      <div className="kb-bar mb-6">
        <AgentLive />
        <ImportHelpCenter siteUrl={siteUrl} onImported={imported} onError={setError} />
        <RecreateIndex documents={documents} onDocument={upsert} />
      </div>

      {repoBound ? null : (
        // Answering only needs these sources, so this says what is still missing and nothing
        // on this page waits for it.
        <div className="gate-banner mb-6" role="status">
          <strong>Connect a repository so the agent can file requests it cannot answer</strong>
          <span>
            Everything here already works. A repository is what lets Lantern open the issue and
            the draft pull request when a question turns out to be a missing feature.
          </span>
          <Link href="/console/repository" className="link-button">
            Repository
          </Link>
        </div>
      )}

      <div className="stat-grid mb-6">
        <Stat value={String(stats.sources)} label="Sources" />
        <Stat value={String(stats.chunks)} label="Chunks" />
        <Stat value={String(stats.scannedPages)} label="Scanned pages" />
        <Stat
          value={stats.meanConfidence === null ? "-" : stats.meanConfidence.toFixed(2)}
          label="Mean confidence"
        />
        <Stat value={String(addedHere)} label="Added this session" />
      </div>

      {error ? (
        <div className="notice is-error mb-6" role="alert">
          {error}
        </div>
      ) : null}

      <div className="kb-grid mb-6">
        <AddSource siteUrl={siteUrl} onAdded={added} />

        <section className="panel">
          <div className="panel__head">
            <h2>Your sources</h2>
            {documents.length > 0 ? <span className="count-pill">{documents.length}</span> : null}
          </div>
          <div className="sources-scroll">
            <SourceList
              documents={documents}
              busyId={busyId}
              onPreview={setPreviewing}
              onReindex={reindex}
              onReplace={replace}
              onDelete={remove}
            />
          </div>
        </section>
      </div>

      <TestQuestion hasSources={documents.length > 0} />

      {previewing ? (
        <PreviewDrawer key={previewing.id} document={previewing} onClose={() => setPreviewing(null)} />
      ) : null}
    </>
  );
}

function summarise(documents: ConsoleDocument[]): {
  sources: number;
  chunks: number;
  scannedPages: number;
  meanConfidence: number | null;
} {
  const scanned = documents.filter((row) => row.meanConfidence !== null);
  const scannedPages = scanned.reduce((total, row) => total + (row.pageCount ?? 0), 0);
  return {
    sources: documents.length,
    chunks: documents.reduce((total, row) => total + row.chunkCount, 0),
    scannedPages,
    // Weighted by pages, so one clean page cannot hide a hundred bad ones.
    meanConfidence:
      scannedPages === 0
        ? null
        : scanned.reduce(
            (total, row) => total + (row.meanConfidence ?? 0) * (row.pageCount ?? 0),
            0,
          ) / scannedPages,
  };
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat__num">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
