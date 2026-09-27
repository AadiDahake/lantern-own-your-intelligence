import Link from "next/link";
import { Mark } from "./Mark";

const LINKS = [
  { href: "#features", label: "What it does" },
  { href: "#how", label: "How it works" },
  { href: "#pipeline", label: "The pipeline" },
  { href: "#embed", label: "Embed" },
] as const;

/**
 * The marketing header. Every destination here is one a signed-out visitor can actually reach:
 * the console links used to sit in this bar and bounced a stranger straight to sign-in.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/60 bg-[var(--glass-strong)] shadow-[var(--glass-highlight)] backdrop-blur-[30px] backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6 lg:px-10">
        <Link href="#top" className="flex flex-none items-center gap-2.5">
          <Mark />
          <span className="font-display text-xl tracking-tight">Lantern</span>
        </Link>
        <nav className="hidden items-center gap-9 text-[14px] text-muted md:flex">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-ink">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex flex-none items-center gap-5">
          <Link
            href="/signin"
            className="hidden text-sm font-medium text-ink/70 transition hover:text-ink sm:inline"
          >
            Sign in
          </Link>
          <Link
            href="/signin?mode=signup"
            className="inline-flex items-center gap-2 rounded-full bg-accent-deep px-4 py-2 text-sm font-medium whitespace-nowrap text-panel shadow-sm transition hover:bg-accent"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
