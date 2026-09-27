import Link from "next/link";

export function Hero() {
  return (
    <section id="top" className="relative">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-6 pt-24 pb-24 text-center lg:px-10 lg:pt-32 lg:pb-32">
        <h1 className="max-w-4xl font-display text-4xl leading-[1.12] tracking-tight text-ink sm:text-5xl lg:text-[3.75rem]">
          Support that answers honestly, and{" "}
          <span className="font-medium text-accent italic">builds</span> what it could not find.
        </h1>

        <p className="mt-8 max-w-xl text-[17px] leading-relaxed text-ink/65">
          Lantern answers from your own documentation, points at the real control on the page the
          user is already looking at, and opens the pull request when the feature does not exist.
        </p>

        {/* Both calls stay on the marketing side. The trace this used to link to belongs to a
            project, so a visitor who has not made one had nothing to watch. */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-6">
          <Link
            href="/signin?mode=signup"
            className="rounded-full bg-accent-deep px-8 py-4 text-base font-medium text-panel shadow-xl shadow-accent/20 transition-all hover:-translate-y-0.5 hover:bg-accent"
          >
            Get started
          </Link>
          <a href="#how" className="group inline-flex items-center gap-2 font-semibold text-accent">
            See how it works
            <span aria-hidden className="transition-transform group-hover:translate-y-0.5">
              &darr;
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
