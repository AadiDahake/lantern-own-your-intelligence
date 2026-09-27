import { Reveal } from "./Reveal";

const FEATURES = [
  {
    title: "Your company's brain",
    body: "Upload a handbook, a PDF or a URL. Lantern builds a knowledge graph for your project alone, and every answer is drawn from what you wrote.",
  },
  {
    title: "Routes it remembers",
    body: "When a user finishes a walk, the route is kept. The next person who asks is shown the same way at once, with the exact number of steps.",
  },
  {
    title: "A model you own",
    body: "A guide model trains on how each walk ended, and plans the next one from what worked. The weights it learns are yours to keep.",
  },
  {
    title: "Your team in the room",
    body: "When a feature is missing, your people and the agent meet in one room and decide together what should be built.",
  },
  {
    title: "A factory for the gap",
    body: "Once a person approves, parallel agents build the feature side by side. The best one becomes a draft pull request, and nothing merges on its own.",
  },
  {
    title: "The loop, closed",
    body: "Every request keeps track of the customers who asked for it. When the change ships, they get the news.",
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
            it answers from, the routes it remembers and the model it trains.
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
