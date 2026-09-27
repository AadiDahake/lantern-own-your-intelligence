"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Where the widget is installed.
 *
 * The agent quotes it back to the user and the worker links to it after a deploy, so it is worth
 * editing in place rather than hiding behind a settings page.
 */
export function SiteUrlField({ initialSiteUrl }: { initialSiteUrl: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initialSiteUrl ?? "");
  const [saved, setSaved] = useState(initialSiteUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dirty = value.trim() !== saved.trim();

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/project", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteUrl: value.trim() }),
      });
      const result = (await response.json()) as {
        project?: { siteUrl: string | null };
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "That could not be saved.");
      const stored = result.project?.siteUrl ?? "";
      setValue(stored);
      setSaved(stored);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="site-field" onSubmit={save}>
      <label className="field-label" htmlFor="project-site-url">
        Where is the widget installed?
      </label>
      <div className="site-field__row">
        <input
          id="project-site-url"
          className="field-input"
          type="url"
          value={value}
          placeholder="https://app.yourcompany.com"
          autoComplete="url"
          inputMode="url"
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className="secondary-action" disabled={!dirty || busy}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      {error ? (
        <p className="field-hint is-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
