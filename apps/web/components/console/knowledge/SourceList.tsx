"use client";

import { useRef, useState } from "react";
import { formatRelativeTime } from "@/lib/console/format";
import type { ConsoleDocument } from "@/lib/ingest/types";
import { SOURCE_MODE_LABEL } from "./AddSource";

/** How the stored kind reads in the list. */
const KIND_LABEL: Record<string, string> = {
  text: SOURCE_MODE_LABEL.text,
  url: SOURCE_MODE_LABEL.url,
  upload: SOURCE_MODE_LABEL.file,
};

const STATUS_TONE: Record<string, string> = {
  ready: "is-good",
  processing: "is-run",
  pending: "is-wait",
  failed: "is-bad",
};

type Props = {
  documents: ConsoleDocument[];
  busyId: string | null;
  onPreview: (document: ConsoleDocument) => void;
  onReindex: (document: ConsoleDocument) => void;
  onReplace: (document: ConsoleDocument, file: File) => void;
  onDelete: (document: ConsoleDocument) => void;
};

export function SourceList({ documents, busyId, onPreview, onReindex, onReplace, onDelete }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (documents.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">No sources yet</p>
        <p className="empty-state__text">
          Add a handbook, a documentation site or a note on the left. It shows up here with what was
          read out of it.
        </p>
      </div>
    );
  }

  return (
    <ul className="record-list">
      {documents.map((document) => {
        const busy = busyId === document.id;
        // A file was never kept, only what was read out of it, so only these two can be read again.
        const rereadable = document.sourceKind === "url" || document.sourceKind === "text";

        return (
          <li key={document.id}>
            <article className="source-row">
              <div className="source-row__top">
                <p className="source-row__title">{document.title}</p>
                <span className="outcome-badge is-muted">
                  {KIND_LABEL[document.sourceKind] ?? document.sourceKind}
                </span>
                <span className="source-row__time" suppressHydrationWarning>
                  {formatRelativeTime(document.createdAt)}
                </span>
              </div>

              {document.sourceRef ? (
                <p className="record-card__line is-clipped" title={document.sourceRef}>
                  <span className="record-card__label">Source</span>
                  {document.sourceRef}
                </p>
              ) : null}

              {document.error ? (
                <p className="record-card__line">
                  <span className="record-card__label">Error</span>
                  {document.error}
                </p>
              ) : null}

              <div className="source-row__meta">
                <span className={`outcome-badge ${STATUS_TONE[document.status] ?? "is-muted"}`}>
                  {document.status}
                </span>
                {document.pageCount === null ? null : (
                  <span>{document.pageCount} pages</span>
                )}
                <span>{document.chunkCount} chunks</span>
                {document.meanConfidence === null ? null : (
                  <span>read at {document.meanConfidence.toFixed(2)}</span>
                )}
              </div>

              <div className="source-row__actions">
                <button
                  type="button"
                  className="row-action"
                  onClick={() => onPreview(document)}
                  disabled={busy}
                >
                  Preview
                </button>
                {rereadable ? (
                  <button
                    type="button"
                    className="row-action"
                    onClick={() => onReindex(document)}
                    disabled={busy}
                  >
                    {busy ? "Working..." : "Re-index"}
                  </button>
                ) : null}
                {document.sourceKind === "upload" ? (
                  <ReplaceFile
                    document={document}
                    busy={busy}
                    onReplace={onReplace}
                  />
                ) : null}
                {confirming === document.id ? (
                  <>
                    <button
                      type="button"
                      className="row-action is-danger"
                      onClick={() => {
                        setConfirming(null);
                        onDelete(document);
                      }}
                      disabled={busy}
                    >
                      Delete it
                    </button>
                    <button
                      type="button"
                      className="row-action"
                      onClick={() => setConfirming(null)}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="row-action is-danger"
                    onClick={() => setConfirming(document.id)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Attaching the file behind an upload.
 *
 * A source added before originals were kept has only the text that was read out of it. Handing
 * the file back stores it and reads it again, without losing the row or anything pointing at it.
 */
function ReplaceFile({
  document,
  busy,
  onReplace,
}: {
  document: ConsoleDocument;
  busy: boolean;
  onReplace: (document: ConsoleDocument, file: File) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.txt,.html"
        aria-label={`Replace the file behind ${document.title}`}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (chosen) onReplace(document, chosen);
        }}
      />
      <button
        type="button"
        className="row-action"
        onClick={() => input.current?.click()}
        disabled={busy}
      >
        {document.storagePath ? "Replace file" : "Attach file"}
      </button>
    </>
  );
}
