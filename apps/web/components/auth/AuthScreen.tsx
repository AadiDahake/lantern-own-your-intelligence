"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mark } from "@/components/landing/Mark";
import { browserSupabase } from "@/lib/auth/browser";

type Mode = "signin" | "signup";

/**
 * Sign in, or create an account and sign straight in.
 *
 * Creating the account goes through `POST /api/auth/signup` rather than the client SDK, because
 * this Supabase project confirms addresses by email and nobody would ever get the mail. The route
 * creates the user already confirmed; the password sign-in below is what sets the session cookie.
 */
export function AuthScreen({ next, initialMode = "signin" }: { next: string; initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isSignup = mode === "signup";

  function switchMode(to: Mode) {
    setMode(to);
    setError("");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isSignup) {
        if (company.trim().length < 2) throw new Error("Enter your company name.");
        const response = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password, company: company.trim() }),
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "The account could not be created.");
      }

      const { error: signInError } = await browserSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw new Error(signInError.message);

      // The session lives in a cookie now, so the server has to re-render for the console to see it.
      router.replace(next);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <Link href="/" className="auth-brand__brand">
          <Mark className="h-[30px] w-[30px]" tone="light" />
          <span className="auth-brand__wordmark">Lantern</span>
        </Link>

        <div>
          <h2 className="auth-brand__headline">Support that fixes the product.</h2>
          <p className="auth-brand__lede">
            Lantern answers from your documentation, shows the user the real control on their own
            screen, and turns a missing feature into a pull request.
          </p>
          <ul className="auth-brand__list">
            <li>Answers grounded in the documentation you upload</li>
            <li>Step-by-step guidance on the customer&rsquo;s own page</li>
            <li>Missing features filed, drafted, and opened as a pull request</li>
          </ul>
        </div>

        <p className="auth-brand__footnote">One console. Every fix, from question to deploy.</p>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <Link href="/" className="auth-card__mobile-brand">
            <Mark className="h-[28px] w-[28px]" />
            <span className="auth-brand__wordmark">Lantern</span>
          </Link>

          <p className="eyebrow">{isSignup ? "Get started" : "Welcome back"}</p>
          <h1 className="auth-card__title">
            {isSignup ? "Create your console" : "Sign in to Lantern"}
          </h1>
          <p className="auth-card__subtitle">
            {isSignup
              ? "Set up the console that teaches your support agent and ships its fixes."
              : "Pick up where you left off with your support agent."}
          </p>

          <div className="auth-toggle" role="group" aria-label="Sign in or create an account">
            <button
              type="button"
              className={mode === "signin" ? "is-active" : undefined}
              aria-pressed={mode === "signin"}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === "signup" ? "is-active" : undefined}
              aria-pressed={mode === "signup"}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </div>

          <form className="auth-form" onSubmit={onSubmit}>
            {isSignup ? (
              <div>
                <label className="field-label" htmlFor="auth-company">
                  Company
                </label>
                <input
                  id="auth-company"
                  className="field-input"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  placeholder="Acme"
                  autoComplete="organization"
                  required
                />
              </div>
            ) : null}

            <div>
              <label className="field-label" htmlFor="auth-email">
                Email
              </label>
              <input
                id="auth-email"
                className="field-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="auth-password">
                Password
              </label>
              <input
                id="auth-password"
                className="field-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={8}
                required
              />
            </div>

            <button type="submit" className="primary-action" disabled={busy}>
              {busy ? "Working..." : isSignup ? "Create account" : "Sign in"}
            </button>

            {error ? (
              <p className="auth-message is-error" role="alert">
                {error}
              </p>
            ) : null}
          </form>

          <p className="auth-switch">
            {isSignup ? "Already have a console?" : "New to Lantern?"}{" "}
            <button
              type="button"
              className="link-button"
              onClick={() => switchMode(isSignup ? "signin" : "signup")}
            >
              {isSignup ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
