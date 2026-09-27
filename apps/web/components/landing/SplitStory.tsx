import { Reveal } from "./Reveal";

const BEFORE = [
  "Screenshot in a ticket thread",
  "Two engineers pulled in",
  "Eight days to triage",
  "The user quietly leaves",
];

const AFTER = [
  "Answer on the page, in seconds",
  "Absence proved three ways",
  "Draft pull request in a minute",
  "The user gets the feature",
];

export function SplitStory() {
  return (
    <section className="border-t border-line/60 py-24 lg:py-32">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2 lg:gap-20 lg:px-10">
        <div>
          <h2 className="font-display text-4xl leading-[1.04] tracking-tight sm:text-5xl lg:text-[3.25rem]">
            From a ticket queue <br />
            to a <span className="font-medium text-accent italic">closed</span> pull request.
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink/65">
            Support has always been a holding pattern. Lantern turns it into the shortest path
            between &ldquo;this is missing&rdquo; and &ldquo;merged to main&rdquo;.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Reveal>
            <CompareCard tone="before" label="Before" lines={BEFORE} />
          </Reveal>
          <Reveal delay={140}>
            <CompareCard tone="after" label="After" lines={AFTER} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function CompareCard({
  tone,
  label,
  lines,
}: {
  tone: "before" | "after";
  label: string;
  lines: string[];
}) {
  const isAfter = tone === "after";
  return (
    <div
      className={`rounded-3xl border p-7 ${
        isAfter ? "border-accent bg-accent-deep text-panel" : "border-line/70 bg-panel"
      }`}
    >
      <p className={`mb-5 text-sm font-semibold ${isAfter ? "text-panel/70" : "text-ink/50"}`}>
        {label}
      </p>
      <ul className="space-y-3">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-3 text-[15px] leading-snug">
            <span
              aria-hidden
              className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                isAfter ? "bg-sage" : "bg-ink/30"
              }`}
            />
            <span className={isAfter ? "" : "text-ink/70"}>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
