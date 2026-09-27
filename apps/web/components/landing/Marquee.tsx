const ITEMS = ["OpenAI", "Codex", "PostHog", "Runloop", "GitHub", "Supabase", "Vercel", "Next.js"];

/**
 * The stack strip under the hero. Purely typographic, scrolling slowly behind a soft mask.
 *
 * The spacing is trailing padding on each name rather than a flex gap, because the loop moves
 * the row by exactly half its width: with a gap there is no space after the last name and the
 * seam shows every time it comes round.
 */
export function Marquee() {
  return (
    <section aria-label="Stack" className="overflow-hidden border-y border-line/60 bg-surface/40 py-7">
      <div className="mx-auto flex max-w-7xl items-center gap-10 px-6 lg:px-10">
        <span className="hidden text-sm font-semibold whitespace-nowrap text-ink/45 sm:block">
          Built on
        </span>
        <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]">
          <div className="animate-marquee flex w-max">
            {[...ITEMS, ...ITEMS].map((label, index) => (
              <span
                key={`${label}-${index}`}
                className="font-display pr-14 text-2xl whitespace-nowrap text-ink/35 italic"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
