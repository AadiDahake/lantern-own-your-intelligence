"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConsoleDocument, IngestPage } from "@/lib/ingest/types";
import { OriginalPane } from "./OriginalPane";

/** Anything read less confidently than this is tinted, so a bad scan is obvious. */
const LOW_CONFIDENCE = 0.6;
/** Shading fades in from here down, so a page of good text stays plain. */
const SHADE_FROM = 0.95;

type Props = {
  document: ConsoleDocument;
  onClose: () => void;
};

/** The file as it was uploaded, next to what the reader made of it, page by page. */
export function PreviewDrawer({ document, onClose }: Props) {
  const [pages, setPages] = useState<IngestPage[] | null>(null);
  const [error, setError] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [hasOriginal, setHasOriginal] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // One drawer belongs to one source: the parent remounts it rather than resetting it.
  useEffect(() => {
    let live = true;
    fetch(`/api/documents/${document.id}`)
      .then(async (response) => {
        const result = (await response.json()) as {
          document?: ConsoleDocument & { pages: IngestPage[] };
          error?: string;
        };
        if (!response.ok || !result.document) throw new Error(result.error ?? "Nothing to show.");
        if (live) setPages(result.document.pages);
      })
      .catch((failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : "Nothing to show.");
      });
    return () => {
      live = false;
    };
  }, [document.id]);

  const fileUrl = `/api/documents/${document.id}/file`;

  // Only offer the download when there is something behind it: sources added before originals
  // were kept have nothing to hand over.
  useEffect(() => {
    let live = true;
    fetch(fileUrl, { method: "HEAD" })
      .then((response) => {
        if (live) setHasOriginal(response.ok);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fileUrl]);

  const page = pages?.[Math.min(pageIndex, Math.max((pages?.length ?? 1) - 1, 0))] ?? null;
  const meta = useMemo(() => describe(document, pages), [document, pages]);

  return (
    <div
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-label={`${document.title}, the original next to what was read`}
    >
      <button type="button" className="drawer__scrim" aria-label="Close the preview" onClick={onClose} />
      <div className="drawer__panel">
        <div className="drawer__head">
          <div className="min-w-0">
            <h2 className="drawer__title">{document.title}</h2>
            <p className="drawer__meta">{meta}</p>
          </div>
          <div className="drawer__actions">
            {hasOriginal ? (
              <a className="secondary-action" href={`${fileUrl}?download=1`} download>
                Download original
              </a>
            ) : null}
            <button type="button" className="ghost-action" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {error ? (
          <div className="drawer__body">
            <div className="notice is-error">{error}</div>
          </div>
        ) : (
          <div className="drawer__panes">
            <section className="pane" aria-label="The original source">
              <header className="pane__head">
                <span>Original</span>
                {document.sourceRef ? <span className="pane__ref">{document.sourceRef}</span> : null}
              </header>
              <div className="pane__body">
                <OriginalPane
                  document={document}
                  fileUrl={fileUrl}
                  page={page?.page ?? 1}
                />
              </div>
            </section>

            <section className="pane" aria-label="What the reader extracted">
              <header className="pane__head">
                <span>What the reader saw</span>
                {pages && pages.length > 1 ? (
                  <PageSelector
                    count={pages.length}
                    index={pageIndex}
                    labels={pages.map((entry) => entry.page)}
                    onChange={setPageIndex}
                  />
                ) : null}
              </header>
              <div className="pane__body">
                {pages === null ? <p className="field-hint m-0">Loading...</p> : null}
                {pages?.length === 0 ? (
                  <p className="field-hint m-0">Nothing was stored for this source.</p>
                ) : null}
                {page ? <PageBlocks page={page} /> : null}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** "handbook.pdf - 9 pages - read at 0.97 - 42 chunks", with whatever is actually known. */
function describe(document: ConsoleDocument, pages: IngestPage[] | null): string {
  const parts = [
    document.sourceRef?.split("/").filter(Boolean).pop() ?? null,
    pages && pages.length > 0 ? `${pages.length} page${pages.length === 1 ? "" : "s"}` : null,
    document.meanConfidence === null ? null : `read at ${document.meanConfidence.toFixed(2)}`,
    `${document.chunkCount} chunk${document.chunkCount === 1 ? "" : "s"}`,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function PageSelector({
  count,
  index,
  labels,
  onChange,
}: {
  count: number;
  index: number;
  labels: number[];
  onChange: (next: number) => void;
}) {
  return (
    <span className="page-nav">
      <button
        type="button"
        className="page-nav__step"
        aria-label="Previous page"
        disabled={index === 0}
        onClick={() => onChange(index - 1)}
      >
        &larr;
      </button>
      <select
        className="page-nav__select"
        aria-label="Page"
        value={index}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {labels.map((label, position) => (
          <option key={label} value={position}>
            Page {label} of {count}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="page-nav__step"
        aria-label="Next page"
        disabled={index >= count - 1}
        onClick={() => onChange(index + 1)}
      >
        &rarr;
      </button>
    </span>
  );
}

function PageBlocks({ page }: { page: IngestPage }) {
  // A page from a crawl has no blocks of its own worth splitting apart; show it whole.
  const blocks =
    page.blocks.length > 0
      ? page.blocks
      : [{ type: "text", content: page.markdown, confidence: page.confidence }];

  return (
    <>
      {page.sourceRef ? <p className="pane__ref mb-2">{page.sourceRef}</p> : null}
      {blocks.map((block, index) => {
        const low = block.confidence !== null && block.confidence < LOW_CONFIDENCE;
        // The tint deepens as confidence falls, so a page reads as a heat map of what to check.
        const tint =
          block.confidence === null
            ? 0
            : Math.min(Math.max((SHADE_FROM - block.confidence) / 0.45, 0), 1);
        return (
          <p
            key={index}
            className={`page-block${low ? " is-low" : ""}`}
            style={{ "--tint": tint } as React.CSSProperties}
          >
            {block.confidence === null ? null : (
              <span className="page-block__score">{block.confidence.toFixed(2)}</span>
            )}
            {block.content}
          </p>
        );
      })}
    </>
  );
}
