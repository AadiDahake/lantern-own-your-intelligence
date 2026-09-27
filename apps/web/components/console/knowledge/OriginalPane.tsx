"use client";

import { useEffect, useState } from "react";
import type { ConsoleDocument } from "@/lib/ingest/types";

type Props = {
  document: ConsoleDocument;
  fileUrl: string;
  /** The page shown on the right, so a scanned document follows along. */
  page: number;
};

/** The source as it arrived: the document itself, the picture, or the text it was written as. */
export function OriginalPane({ document, fileUrl, page }: Props) {
  const kept = Boolean(document.storagePath);
  const mime = document.mime ?? "";

  if (!kept && document.sourceKind === "upload") {
    return (
      <div className="pane__empty">
        <p className="empty-state__title">The file itself was not kept</p>
        <p className="empty-state__text">
          This source was added before originals were stored. Use Attach file on its row to hand it
          over, and the reader runs across it again.
        </p>
      </div>
    );
  }

  if (!kept && document.sourceKind === "text") {
    // The note's own text is only on the row when it came through this console.
    return (
      <div className="pane__empty">
        <p className="empty-state__title">This note has no stored original</p>
        <p className="empty-state__text">
          It was written straight into the index, so the passages on the right are everything
          Lantern has of it.
        </p>
      </div>
    );
  }

  if (mime === "application/pdf") {
    return (
      // The viewer takes the page from the fragment, so the two panes stay on the same page.
      <iframe
        key={page}
        className="pane__frame"
        src={`${fileUrl}#page=${page}&view=FitH`}
        title={`${document.title}, page ${page}`}
      />
    );
  }

  if (mime.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- the bytes are streamed by our own route
    return <img className="pane__image" src={fileUrl} alt={`${document.title}, as uploaded`} />;
  }

  return <PlainText fileUrl={fileUrl} />;
}

/** Written notes, crawled pages and text uploads: the characters, exactly as stored. */
function PlainText({ fileUrl }: { fileUrl: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(fileUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error("No original was kept for this source.");
        const body = await response.text();
        if (live) setText(body);
      })
      .catch((failure: unknown) => {
        if (live) setError(failure instanceof Error ? failure.message : "Nothing to show.");
      });
    return () => {
      live = false;
    };
  }, [fileUrl]);

  if (error) return <p className="field-hint m-0">{error}</p>;
  if (text === null) return <p className="field-hint m-0">Loading...</p>;
  return <pre className="pane__text">{text}</pre>;
}
