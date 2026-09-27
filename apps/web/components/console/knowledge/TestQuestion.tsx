"use client";

import { useState } from "react";
import type { SearchMatch } from "@/lib/ingest/types";

/**
 * The passages the agent would be handed for a question, in the order it would see them.
 *
 * With nothing indexed there is nothing to rank, so the form is closed rather than left open
 * to return an empty result that looks like a failure.
 */
export function TestQuestion({ hasSources }: { hasSources: boolean }) {
  const [question, setQuestion] = useState("How do I change my username?");
  const [matches, setMatches] = useState<SearchMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/documents/search?q=${encodeURIComponent(question)}`);
      const result = (await response.json()) as { matches?: SearchMatch[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "The search failed.");
      setMatches(result.matches ?? []);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The search failed.");
      setMatches(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Test a question</h2>
        {matches ? <span className="count-pill">top {matches.length}</span> : null}
      </div>
      <p className="field-hint mt-0 mb-4">
        {hasSources
          ? "This runs the same search the agent runs before it answers. What comes back here is exactly what would ground the reply."
          : "Add a source first. This runs the same search the agent runs before it answers, so it needs something to read."}
      </p>

      <form className="flex flex-wrap items-center gap-3" onSubmit={ask}>
        <label className="sr-only" htmlFor="test-question">
          A question to try
        </label>
        <input
          id="test-question"
          className="field-input flex-1 min-w-[240px]"
          value={question}
          placeholder="Ask what a customer would ask"
          disabled={!hasSources}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          type="submit"
          className="secondary-action"
          disabled={!hasSources || busy || question.trim() === ""}
        >
          {busy ? "Searching..." : "Search the knowledge base"}
        </button>
      </form>

      {error ? (
        <div className="notice is-error mt-4" role="alert">
          {error}
        </div>
      ) : null}

      {matches?.length === 0 ? (
        <p className="field-hint">Nothing in the knowledge base is close to that question.</p>
      ) : null}

      {matches && matches.length > 0 ? (
        <ul className="record-list mt-4">
          {matches.map((match) => (
            <li key={match.chunkId}>
              <article className="match-row">
                <div className="match-row__top">
                  <span className="match-row__score">{match.similarity.toFixed(3)}</span>
                  <span className="match-row__title">{match.documentTitle}</span>
                  {match.heading ? (
                    <span className="match-row__heading">{match.heading}</span>
                  ) : null}
                  <span className="match-row__where">
                    {match.page === null ? "" : `page ${match.page}`}
                    {match.confidence === null ? "" : ` · read at ${match.confidence.toFixed(2)}`}
                  </span>
                </div>
                <p className="match-row__text">{snippet(match.content)}</p>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Enough of a passage to recognise it, without turning the list into a wall of text. */
function snippet(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= 320 ? flat : `${flat.slice(0, 320)}...`;
}
