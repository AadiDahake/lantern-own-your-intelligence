import { IconBranch, IconChecks, IconScreen } from "./icons";
import { Reveal } from "./Reveal";

const STEPS = [
  {
    title: "Someone asks in your app.",
    body: "The widget sits in the corner of your product. It reads the page, collects the controls that are really there, and sends the question with them.",
    icon: <IconScreen />,
  },
  {
    title: "Three checks run at once.",
    body: "Your documentation, the live interface and the repository each answer on their own. The console shows every score as it lands.",
    icon: <IconChecks />,
  },
  {
    title: "The gap becomes a pull request.",
    body: "Lantern files the issue, drafts the change, opens a draft pull request, and waits for a developer to approve before anything merges.",
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
              From a question to a <br className="hidden sm:block" />
              <span className="font-medium text-accent italic">merged</span> pull request.
            </h2>
          </div>
          <p className="text-[17px] leading-relaxed text-ink/60 lg:col-span-4 lg:col-start-9">
            Three quiet steps between a confused user and a change on your main branch. No ticket
            queue, no triage rota, no engineer paged.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3 lg:gap-7">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 120} className="h-full">
              <article className="h-full rounded-[28px] border border-line/70 bg-panel p-8">
                <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl border border-line/80 bg-paper text-accent">
                  {step.icon}
                </div>
                <h3 className="mb-3 font-display text-[1.65rem] leading-[1.15] tracking-tight">
                  {step.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-ink/65">{step.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
