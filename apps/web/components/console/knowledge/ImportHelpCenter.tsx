"use client";

import { useEffect, useState } from "react";
import type { ConsoleDocument } from "@/lib/ingest/types";

type Props = {
  /** The site the help center lives on. Without one there is nothing to import from. */
  siteUrl: string | null;
  onImported: (documents: ConsoleDocument[]) => void;
  onError: (message: string) => void;
};

/**
 * Reads the help center off the site itself: every help page the product map knows, or the
 * site map lists, becomes one source with its own address. Elapsed seconds show while it runs,
 * because a crawl plus embedding is long enough that silence reads as a hang.
 */
export function ImportHelpCenter({ siteUrl, onImported, onError }: Props) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState("");

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const busy = startedAt !== null;

  async function run(): Promise<void> {
    setStartedAt(Date.now());
    setElapsed(0);
    setResult("");
    try {
      const response = await fetch("/api/documents/import-help", { method: "POST" });
      const body = (await response.json()) as { documents?: ConsoleDocument[]; pages?: number; error?: string };
      if (!response.ok || !body.documents) throw new Error(body.error ?? "The help center could not be imported.");
      onImported(body.documents);
      setResult(
        `Imported ${count(body.documents.length, "article")} from ${count(body.pages ?? body.documents.length, "help page")}.`,
      );
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "The help center could not be imported.");
    } finally {
      setStartedAt(null);
    }
  }

  return (
    <>
      <button
        type="button"
        className="secondary-action"
        disabled={busy || !siteUrl}
        title={siteUrl ? undefined : "Set the site address on the Overview page first."}
        onClick={() => void run()}
      >
        {busy ? "Importing help center..." : "Import help center from the site"}
      </button>
      {busy ? (
        <span className="field-hint m-0" aria-live="polite">
          {elapsed}s elapsed
        </span>
      ) : null}
      {!siteUrl ? <span className="field-hint m-0">Set the site address on the Overview page first.</span> : null}
      {result ? (
        <span className="field-hint m-0" role="status">
          {result}
        </span>
      ) : null}
    </>
  );
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
