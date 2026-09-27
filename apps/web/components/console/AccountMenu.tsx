"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/console/ConfirmDialog";
import { browserSupabase } from "@/lib/auth/browser";
import type { ResetSummary } from "@/lib/demo/reset";

type Props = {
  email: string;
  /** The company the account signed up as. The project slug is never shown to a person. */
  company: string | null;
  /** The linked GitHub login, when the project has one. */
  githubLogin: string | null;
};

/** Two letters from the company name, else the first two of the address. */
function initials(email: string, company: string | null): string {
  const source = company?.trim() || email;
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/** Who is signed in, what GitHub account is linked, and the way out. */
export function AccountMenu({ email, company, githubLogin }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [askingReset, setAskingReset] = useState(false);
  const [resetDone, setResetDone] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function disconnectGithub() {
    setUnlinking(true);
    setError("");
    try {
      const response = await fetch("/api/github/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("GitHub could not be disconnected.");
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "GitHub could not be disconnected.");
    } finally {
      setUnlinking(false);
    }
  }

  async function resetDemo() {
    setResetting(true);
    setError("");
    try {
      const response = await fetch("/api/demo/reset", { method: "POST" });
      const body = (await response.json()) as { summary?: ResetSummary; error?: string };
      if (!response.ok || !body.summary) throw new Error(body.error ?? "The demo could not be reset.");
      setResetDone(describeReset(body.summary));
      setAskingReset(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The demo could not be reset.");
      setAskingReset(false);
    } finally {
      setResetting(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    await browserSupabase().auth.signOut();
    router.replace("/signin");
    router.refresh();
  }

  return (
    <div className="account" ref={root}>
      {githubLogin ? (
        <span className="account-github" title={`Connected as @${githubLogin}`}>
          <GithubGlyph />
          <span className="sr-only">GitHub connected as @{githubLogin}</span>
        </span>
      ) : null}

      <button
        type="button"
        className={`account-trigger${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-trigger__avatar" aria-hidden="true">
          {initials(email, company)}
        </span>
        <span className="account-trigger__label">
          {company ? <span className="account-trigger__company">{company}</span> : null}
          <span className="account-trigger__email">{email}</span>
        </span>
        <svg className="account-trigger__chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div className="account-menu" role="menu">
          <div className="account-menu__header">
            {company ? <span className="account-menu__company">{company}</span> : null}
            <span className="account-menu__email">{email}</span>
          </div>
          <div className="account-menu__divider" />
          {githubLogin ? (
            <div className="account-menu__row">
              <span className="account-menu__github">
                <GithubGlyph />@{githubLogin}
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() => void disconnectGithub()}
                disabled={unlinking}
              >
                {unlinking ? "Disconnecting..." : "Disconnect"}
              </button>
            </div>
          ) : (
            <a className="account-menu__item" role="menuitem" href="/api/github/connect">
              Link GitHub
            </a>
          )}
          {error ? <p className="account-menu__error">{error}</p> : null}
          {resetDone ? <p className="account-menu__note">{resetDone}</p> : null}
          <button
            type="button"
            role="menuitem"
            className="account-menu__item"
            onClick={() => setAskingReset(true)}
            disabled={resetting}
          >
            {resetting ? "Resetting the demo..." : "Reset demo"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-menu__item account-menu__item--danger"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      ) : null}

      {askingReset ? (
        <ConfirmDialog
          title="Reset the demo?"
          body={
            <>
              <p>
                Every conversation, every reported request and the whole trace are deleted. On the
                connected repository, the issues and pull requests Lantern opened are closed and
                its branches are removed.
              </p>
              <p>The knowledge base is left exactly as it is.</p>
            </>
          }
          confirmLabel="Reset demo"
          typeToConfirm="reset"
          busy={resetting}
          onConfirm={() => void resetDemo()}
          onCancel={() => setAskingReset(false)}
        />
      ) : null}
    </div>
  );
}

/** What the reset actually did, in one line. */
function describeReset(summary: ResetSummary): string {
  const parts = [
    `${summary.conversations} conversation${summary.conversations === 1 ? "" : "s"}`,
    `${summary.escalations} request${summary.escalations === 1 ? "" : "s"}`,
    `${summary.issuesClosed + summary.pullRequestsClosed} closed on GitHub`,
  ];
  return `Cleared ${parts.join(", ")}.`;
}

function GithubGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38l-.01-1.34c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
