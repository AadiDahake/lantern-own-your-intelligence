import { Reveal } from "./Reveal";

const FEATURES = [
  {
    title: "Your company's brain",
    body: "Upload a handbook, a PDF or a URL. The documentation check asks your company's brain first, and searches what you uploaded when the brain has no answer.",
  },
  {
    title: "Routes it remembers",
    body: "When a user finishes a walk, the route is kept. The next person who asks the same question is shown the same way at once, with the exact number of steps.",
  },
  {
    title: "A guide model, measured",
    body: "A guide model is trained on the walks that reached their goal. On 108 decisions it never saw, it chose the right next control 76.8 percent of the time. The base model chose it 39.8 percent of the time.",
  },
  {
    title: "Your team in the room",
    body: "Each missing feature becomes a thread in a shared gap room. Your teammates and the room agent work the gap there, from the evidence Lantern collected.",
  },
  {
    title: "A draft for the gap",
    body: "Once your team accepts a request, an agent builds the change and opens a draft pull request. Nothing merges until a person approves it.",
  },
  {
    title: "The loop, closed",
    body: "Every gap counts the people who asked for it. The person who reported it follows its status in the widget.",
  },
] as const;

export function Features() {
  return (
    <section id="features" className="border-t border-line/60 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-10">
        <div className="mb-14 max-w-3xl">
          <h2 className="font-display text-4xl leading-[1.02] tracking-tight sm:text-5xl lg:text-[3.5rem]">
            Everything support <br />
            <span className="font-medium text-accent italic">should</span> be.
          </h2>
          <p className="mt-6 max-w-xl text-lg text-pretty text-ink/65">
            What Lantern learns about your product serves your project and no other: the knowledge
            it answers from and the routes it remembers.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delay={index * 80} className="h-full">
              <div className="h-full rounded-2xl border border-line/60 bg-surface/70 p-7">
                <h3 className="mb-2 font-display text-[1.35rem] tracking-tight">{feature.title}</h3>
                <p className="text-[14.5px] leading-relaxed text-pretty text-ink/65">{feature.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
