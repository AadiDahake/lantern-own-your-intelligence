import { IconBranch, IconChecks, IconRoute, IconScreen } from "./icons";
import { Reveal } from "./Reveal";

const STEPS = [
  {
    title: "Someone asks in your app.",
    body: "The widget reads the page, collects the controls that are really there, and sends them with the question. The answer comes from your own knowledge.",
    icon: <IconScreen />,
  },
  {
    title: "It looks before it says no.",
    body: "Every check runs at once, and the console shows each score as it lands. A feature is called missing only when all of them come back empty.",
    icon: <IconChecks />,
  },
  {
    title: "Each finished walk teaches it.",
    body: "Lantern points at the real control, one step at a time. When the user gets there, the route is kept for the next person, and the guide model learns from how it went.",
    icon: <IconRoute />,
  },
  {
    title: "The gap becomes a pull request.",
    body: "Your team and the agent shape what is missing in one room. Parallel agents build it and open a draft pull request, and nothing merges until a person approves.",
    icon: <IconBranch />,
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how" className="relative border-t border-line/60 bg-surface/30 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="mb-16 grid items-end gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <h2 className="font-display text-4xl leading-[1.02] tracking-tight sm:text-5xl lg:text-[3.5rem]">
              Found once, <br className="hidden sm:block" />
              <span className="font-medium text-accent italic">remembered</span> for all.
            </h2>
          </div>
          <p className="text-[17px] leading-relaxed text-pretty text-ink/60 lg:col-span-4 lg:col-start-9">
            No ticket queue, no triage rota, no engineer paged. What one user finds is ready for
            the next, and what nobody finds gets built.
          </p>
        </div>

        {/* Two by two until four cards fit in a row, so no width leaves one card on its own. */}
        <div className="grid gap-6 md:grid-cols-2 lg:gap-7 xl:grid-cols-4">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 120} className="h-full">
              <article className="h-full rounded-[28px] border border-line/70 bg-panel p-8">
                <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl border border-line/80 bg-paper text-accent">
                  {step.icon}
                </div>
                <h3 className="mb-3 font-display text-[1.65rem] leading-[1.15] tracking-tight">
                  {step.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-pretty text-ink/65">{step.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
