import Link from "next/link";

/**
 * What installing Lantern looks like.
 *
 * The snippet here is an illustration with a placeholder key: a visitor has no project yet, so
 * there is nothing real to copy. The real one, with the real key, is on the console's overview.
 */
export function Embed({ snippet }: { snippet: string }) {
  return (
    <section id="embed" className="border-t border-line/60 py-24 lg:py-32">
      <div className="mx-auto max-w-5xl px-6 lg:px-10">
        <div className="rounded-[2.25rem] bg-accent-deep px-6 py-16 text-panel sm:px-8 lg:px-16 lg:py-20">
          <h2 className="max-w-2xl font-display text-4xl leading-[1.02] tracking-tight sm:text-5xl">
            Add it to your app in <span className="italic">one line</span>.
          </h2>
          <p className="mt-6 max-w-md text-panel/75">
            The key names your project and nothing else, so it is safe to leave in your page
            source. Everything with a secret in it stays on our side.
          </p>

          <div className="mt-10 overflow-hidden rounded-[14px] border border-panel/15 bg-panel/10">
            <div className="flex items-center justify-between gap-4 border-b border-panel/15 px-4 py-2.5 text-sm text-panel/60">
              <span className="font-semibold">index.html</span>
              <span>Example</span>
            </div>
            <pre className="mono px-4 py-4 text-left leading-relaxed break-words whitespace-pre-wrap text-panel/90">
              <code>{snippet}</code>
            </pre>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/signin?mode=signup"
              className="inline-flex items-center rounded-full bg-panel px-6 py-3 text-sm font-semibold text-accent-deep transition hover:bg-panel/85"
            >
              Get started
            </Link>
            <p className="text-sm text-panel/70">
              Your key appears in the console after you create an account.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
