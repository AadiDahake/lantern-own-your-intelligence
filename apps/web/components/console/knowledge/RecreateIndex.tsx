"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/console/ConfirmDialog";
import type { ConsoleDocument } from "@/lib/ingest/types";

type Props = {
  documents: ConsoleDocument[];
  onDocument: (document: ConsoleDocument) => void;
};

type Progress = { done: number; total: number; rebuilt: number; skipped: number };

/**
 * Reads every source again from scratch.
 *
 * Each source is rebuilt on its own so the index is never empty for long and the count moves
 * while it runs. Anything that has no file, address or text left to read is skipped and counted,
 * rather than quietly leaving the reader with a smaller index than the list claims.
 */
export function RecreateIndex({ documents, onDocument }: Props) {
  const [asking, setAsking] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState("");

  const run = useCallback(async () => {
    setAsking(false);
    setResult("");
    let rebuilt = 0;
    let skipped = 0;

    for (const [index, document] of documents.entries()) {
      setProgress({ done: index, total: documents.length, rebuilt, skipped });
      try {
        const response = await fetch(`/api/documents/${document.id}/reindex`, { method: "POST" });
        const body = (await response.json()) as { document?: ConsoleDocument };
        if (!response.ok || !body.document) throw new Error("skipped");
        onDocument(body.document);
        rebuilt += 1;
      } catch {
        skipped += 1;
      }
    }

    setProgress(null);
    setResult(
      skipped === 0
        ? `Read ${count(rebuilt, "source")} again.`
        : `Read ${count(rebuilt, "source")} again. ${count(skipped, "source")} had nothing left to read from.`,
    );
  }, [documents, onDocument]);

  return (
    <>
      <button
        type="button"
        className="ghost-action"
        disabled={progress !== null || documents.length === 0}
        onClick={() => setAsking(true)}
      >
        {progress
          ? `Rebuilding ${progress.done + 1} of ${progress.total}...`
          : "Recreate index"}
      </button>

      {result ? (
        <span className="field-hint m-0" role="status">
          {result}
        </span>
      ) : null}

      {asking ? (
        <ConfirmDialog
          title="Recreate the whole index?"
          body={
            <>
              <p>
                Every source is read again from its file, its address or its text, and the passages
                behind it are replaced. {count(documents.length, "source")} will be rebuilt.
              </p>
              <p>
                The agent keeps answering while this runs, from whichever sources have already been
                rebuilt.
              </p>
            </>
          }
          confirmLabel="Recreate index"
          onConfirm={() => void run()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </>
  );
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
