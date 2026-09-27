"use client";

import { useEffect, useState } from "react";

type Props = {
  title: string;
  /** What is about to happen, in the words a person would use to explain it afterwards. */
  body: React.ReactNode;
  confirmLabel: string;
  /** When set, the action stays disabled until this exact word is typed. */
  typeToConfirm?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** One modal for every action that cannot be taken back. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  typeToConfirm,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  const ready = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase();

  return (
    <div className="confirm" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="confirm__scrim"
        aria-label="Cancel"
        disabled={busy}
        onClick={onCancel}
      />
      <div className="confirm__panel">
        <h2 className="confirm__title">{title}</h2>
        <div className="confirm__body">{body}</div>

        {typeToConfirm ? (
          <div>
            <label className="field-label" htmlFor="confirm-word">
              Type <strong>{typeToConfirm}</strong> to continue
            </label>
            <input
              id="confirm-word"
              className="field-input"
              value={typed}
              autoComplete="off"
              autoFocus
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        ) : null}

        <div className="confirm__actions">
          <button type="button" className="ghost-action" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action is-danger"
            onClick={onConfirm}
            disabled={busy || !ready}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
