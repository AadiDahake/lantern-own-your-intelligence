"use client";

import { useState } from "react";

/**
 * The pause. This is the one place in the console that changes what happens next, so it says what
 * it is about to do, takes an optional note, and reports the outcome in place.
 */
export function ApprovalCard({
  label,
  escalationId,
  onDecision,
}: {
  label: string;
  escalationId: string | null;
  onDecision: () => void;
}) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [decided, setDecided] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState("");

  async function decide(approved: boolean) {
    if (!escalationId) {
      setError("This pause is not attached to an escalation.");
      return;
    }
    setPending(approved ? "approve" : "reject");
    setError("");
    try {
      const response = await fetch(`/api/escalations/${escalationId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved, note }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The decision did not go through.");
      setDecided(approved ? "approved" : "rejected");
      onDecision();
    } catch (decisionError) {
      setError(
        decisionError instanceof Error ? decisionError.message : "The decision did not go through.",
      );
    } finally {
      setPending(null);
    }
  }

  if (decided) {
    return (
      <p className="approval-card__decided">
        {decided === "approved" ? "Approved. The change is merging." : "Rejected. The pull request stays closed."}
      </p>
    );
  }

  return (
    <div className="approval-card">
      <p className="trace-row__text">{label}</p>
      <label className="sr-only" htmlFor={`approval-note-${escalationId ?? "none"}`}>
        Note for the developer
      </label>
      <input
        id={`approval-note-${escalationId ?? "none"}`}
        name="note"
        className="field-input"
        type="text"
        value={note}
        placeholder="Note for the developer, optional"
        onChange={(event) => setNote(event.target.value)}
      />
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="approval-card__actions">
        <button
          type="button"
          className="primary-action"
          disabled={pending !== null}
          onClick={() => void decide(true)}
        >
          {pending === "approve" ? "Approving..." : "Approve"}
        </button>
        <button
          type="button"
          className="danger-action"
          disabled={pending !== null}
          onClick={() => void decide(false)}
        >
          {pending === "reject" ? "Rejecting..." : "Reject"}
        </button>
      </div>
    </div>
  );
}
