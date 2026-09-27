import { Reveal } from "./Reveal";

const STAGES = [
  { label: "Widget on your page", tone: "neutral" },
  { label: "Three checks", tone: "neutral" },
  { label: "Verdict", tone: "accent" },
  { label: "Issue and draft PR", tone: "neutral" },
  { label: "Your approval", tone: "soft" },
] as const;

const FACTS = [
  "Three checks before a verdict.",
  "One human approval before a merge.",
  "Every step written to the trace.",
] as const;

/**
 * The five stages, laid out so they always fit the card they sit in.
 *
 * The stages share the width equally in a grid rather than sitting in a row wide enough to need
 * its own scrollbar, and the connector between them is a hairline drawn in the gap, so it costs
 * no track. Below the wide breakpoint the same grid becomes a vertical stepper.
 */
export function Pipeline() {
  return (
    <section id="pipeline" className="border-t border-line/60 bg-surface/30 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="mb-14 grid items-end gap-10 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <h2 className="font-display text-4xl leading-[1.04] tracking-tight sm:text-5xl lg:text-[3.5rem]">
              Every step is on the <br />
              <span className="font-medium text-accent italic">record.</span>
            </h2>
          </div>
          <p className="leading-relaxed text-ink/60 lg:col-span-4">
            One trace per conversation. Every probe, verdict, model call and artefact is written
            down as it happens, and streamed to the console live.
          </p>
        </div>

        <div className="rounded-[32px] border border-line/70 bg-panel p-6 sm:p-8 lg:p-12">
          <ol className="pipeline">
            {STAGES.map((stage, index) => (
              <li key={stage.label} className={`pipeline__stage is-${stage.tone}`}>
                {index > 0 ? <span className="pipeline__link" aria-hidden /> : null}
                <Reveal delay={index * 90}>
                  <span className="pipeline__label block">{stage.label}</span>
                </Reveal>
              </li>
            ))}
          </ol>

          <ul className="pipeline__facts">
            {FACTS.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
