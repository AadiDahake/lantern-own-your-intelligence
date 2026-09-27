import { Reveal } from "./Reveal";

const FEATURES = [
  {
    title: "Grounded answers",
    body: "Upload a handbook, a PDF or a URL. Every answer is drawn from what you wrote, and scanned pages are discounted by how well they read.",
  },
  {
    title: "Guidance on the page",
    body: "The widget reads the page the user is on and hands the agent opaque handles, never selectors. A plan naming a control that is not there is thrown away.",
  },
  {
    title: "Three checks, one verdict",
    body: "Documentation, the live interface and the repository all have to come back empty before Lantern will say a feature does not exist.",
  },
  {
    title: "Issues, not apologies",
    body: "When the answer is no, Lantern drafts the request in the user's own words and files it on GitHub with the evidence attached.",
  },
  {
    title: "A pull request, drafted",
    body: "It reads the repository, picks the files to change and says why, writes the change, and opens a draft pull request that builds.",
  },
  {
    title: "A human still decides",
    body: "Nothing merges on its own. The run pauses on Approve, and the console shows the diff and the links before anyone clicks.",
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
          <p className="mt-6 max-w-xl text-lg text-ink/65">
            One script tag on your app, a console on ours, and nothing in between for your team to
            run.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delay={index * 80} className="h-full">
              <div className="h-full rounded-2xl border border-line/60 bg-surface/70 p-7">
                <h3 className="mb-2 font-display text-[1.35rem] tracking-tight">{feature.title}</h3>
                <p className="text-[14.5px] leading-relaxed text-ink/65">{feature.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
