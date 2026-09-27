import Link from "next/link";
import { Mark } from "./Mark";

export function SiteFooter() {
  return (
    <footer className="bg-ink text-panel/75">
      <div className="mx-auto grid max-w-7xl items-start gap-10 px-6 py-16 sm:grid-cols-12 lg:px-10">
        <div className="sm:col-span-6">
          <div className="flex items-center gap-2.5">
            <Mark />
            <span className="font-display text-xl text-panel">Lantern</span>
          </div>
          <p className="mt-4 max-w-md font-display text-2xl leading-snug text-panel/90 italic">
            Support that answers honestly, and builds what it could not find.
          </p>
        </div>
        <div className="flex gap-10 text-sm sm:col-span-6 sm:justify-end">
          <div className="space-y-2.5">
            <p className="text-sm font-semibold text-panel/45">Product</p>
            <a href="#features" className="block transition hover:text-panel">
              What it does
            </a>
            <a href="#how" className="block transition hover:text-panel">
              How it works
            </a>
            <a href="#embed" className="block transition hover:text-panel">
              Embed
            </a>
          </div>
          <div className="space-y-2.5">
            <p className="text-sm font-semibold text-panel/45">Account</p>
            <Link href="/signin" className="block transition hover:text-panel">
              Sign in
            </Link>
            <Link href="/signin?mode=signup" className="block transition hover:text-panel">
              Get started
            </Link>
          </div>
        </div>
      </div>
      <div className="border-t border-panel/10">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-6 py-5 text-sm text-panel/50 lg:px-10">
          <span>Lantern</span>
          <span className="font-display italic">Ask once. Get it built.</span>
        </div>
      </div>
    </footer>
  );
}
