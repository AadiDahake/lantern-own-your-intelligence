"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/console/format";
import type { ConsoleDocument } from "@/lib/ingest/types";

export type SourceMode = "text" | "url" | "file";

export const SOURCE_MODE_LABEL: Record<SourceMode, string> = {
  text: "Written",
  url: "Web page",
  file: "File",
};

/** What the file picker and the drop zone accept, in the order a person would think of them. */
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.md,.txt,.html";

/** A note that shows the shape of a useful source rather than an empty box. */
const EXAMPLE_TITLE = "Support escalation notes";
const EXAMPLE_TEXT = `When someone asks for a feature that does not exist, say so plainly and offer to report it. Never invent a setting.

Billing questions belong to the workspace owner. Everyone else can open the Billing page but cannot change the payment method, so point them at their owner rather than at a support ticket.`;

type Props = {
  /** Prefills the address field, because the site being supported is the obvious first source. */
  siteUrl: string | null;
  onAdded: (document: ConsoleDocument) => void;
};

export function AddSource({ siteUrl, onAdded }: Props) {
  const [mode, setMode] = useState<SourceMode>("text");
  const [title, setTitle] = useState(EXAMPLE_TITLE);
  const [text, setText] = useState(EXAMPLE_TEXT);
  const [url, setUrl] = useState(siteUrl ?? "https://");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Reading a scanned handbook takes long enough that silence reads as a hang.
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const busy = startedAt !== null;

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStartedAt(Date.now());
    setElapsed(0);
    setFeedback(null);

    try {
      const response = await fetch("/api/documents", requestFor(mode, { title, text, url, file }));
      const result = (await response.json()) as { document?: ConsoleDocument; error?: string };
      if (!response.ok || !result.document) {
        throw new Error(result.error ?? "That source could not be added.");
      }
      setFeedback({ tone: "success", message: addedMessage(result.document) });
      onAdded(result.document);
      if (mode === "file") {
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
      }
    } catch (failure) {
      setFeedback({
        tone: "error",
        message: failure instanceof Error ? failure.message : "That source could not be added.",
      });
    } finally {
      setStartedAt(null);
    }
  }

  const ready =
    mode === "text" ? text.trim() !== "" : mode === "url" ? isAddress(url) : file !== null;

  return (
    <form className="panel grid gap-4" onSubmit={submit}>
      <div className="panel__head">
        <h2>Add a source</h2>
        <div className="segmented" role="tablist" aria-label="Kind of source">
          {(["text", "url", "file"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              className={mode === option ? "is-active" : ""}
              onClick={() => setMode(option)}
            >
              {SOURCE_MODE_LABEL[option]}
            </button>
          ))}
        </div>
      </div>

      {mode === "text" ? (
        <>
          <div>
            <label className="field-label" htmlFor="source-title">
              Title
            </label>
            <input
              id="source-title"
              className="field-input"
              value={title}
              placeholder="What this note is about"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="source-text">
              What the agent should know
            </label>
            <textarea
              id="source-text"
              className="field-input field-textarea"
              value={text}
              placeholder="Paste a policy, an answer, or the part of a handbook that keeps coming up."
              onChange={(event) => setText(event.target.value)}
            />
            <p className="field-hint">
              Headings split the note into passages, so keep one topic under each.
            </p>
          </div>
        </>
      ) : null}

      {mode === "url" ? (
        <div>
          <label className="field-label" htmlFor="source-url">
            Page address
          </label>
          <input
            id="source-url"
            className="field-input"
            type="url"
            value={url}
            placeholder="https://docs.yourcompany.com"
            autoComplete="off"
            onChange={(event) => setUrl(event.target.value)}
          />
          <p className="field-hint">
            The page is read, and so are up to twelve pages linked from it on the same site. One
            address is usually a whole documentation section.
          </p>
        </div>
      ) : null}

      {mode === "file" ? (
        <div>
          <span className="field-label">Document</span>
          <div
            className={`dropzone${dragging ? " is-drag" : ""}${file ? " has-file" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const dropped = event.dataTransfer.files?.[0];
              if (dropped) setFile(dropped);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              aria-label="Choose a document"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <svg className="dropzone__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V4m0 0L8 8m4-4 4 4" />
              <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
            </svg>
            <span className="dropzone__primary">
              {file ? file.name : "Drop a file here, or click to choose one"}
            </span>
            <span className="dropzone__hint">
              {file ? formatBytes(file.size) : "PDF, PNG, JPG, WEBP, Markdown, text or HTML."}
            </span>
          </div>
          <p className="field-hint">
            A PDF or an image is read page by page, and every passage keeps the confidence it was
            read at.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="primary-action" disabled={busy || !ready}>
          {busy ? "Reading the source..." : "Add to knowledge base"}
        </button>
        {busy ? (
          <span className="field-hint m-0" aria-live="polite">
            {elapsed}s elapsed
          </span>
        ) : null}
      </div>

      {feedback ? (
        <p className={`ingest-feedback is-${feedback.tone}`} role="status">
          {feedback.message}
        </p>
      ) : null}
    </form>
  );
}

function isAddress(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

function requestFor(
  mode: SourceMode,
  fields: { title: string; text: string; url: string; file: File | null },
): RequestInit {
  if (mode === "file") {
    const form = new FormData();
    form.set("file", fields.file as File);
    return { method: "POST", body: form };
  }
  const body = mode === "url" ? { url: fields.url.trim() } : { title: fields.title, text: fields.text };
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/** What was added, in the words a person would use. */
export function addedMessage(document: ConsoleDocument): string {
  const from = document.pageCount === null ? "" : ` from ${count(document.pageCount, "page")}`;
  const scanned =
    document.meanConfidence === null
      ? ""
      : ` Scanned text read at ${document.meanConfidence.toFixed(2)} confidence.`;
  return `Added “${document.title}” as ${count(document.chunkCount, "chunk")}${from}.${scanned}`;
}
