"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountMenu } from "@/components/console/AccountMenu";
import { NotificationBell } from "@/components/console/NotificationBell";
import { Mark } from "@/components/landing/Mark";

const LINKS = [
  { href: "/console", label: "Overview" },
  { href: "/console/knowledge", label: "Knowledge" },
  { href: "/console/map", label: "Product map" },
  { href: "/console/conversations", label: "Conversations" },
  { href: "/console/repository", label: "Repository" },
  { href: "/console/opportunities", label: "Opportunities" },
  { href: "/console/activity", label: "Activity" },
] as const;

type Props = {
  email: string;
  company: string | null;
  githubLogin: string | null;
};

/**
 * The console's top bar. It holds one row at every width: the tabs tighten as the viewport
 * narrows, and below the small breakpoint they fold into the menu behind the compass button.
 * The exact path match keeps Overview from staying lit on child pages.
 */
export function ConsoleNav({ email, company, githubLogin }: Props) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLDivElement | null>(null);

  // The compact menu is a popover, so it closes the way every popover does: on a click outside
  // and on Escape. Picking a tab closes it through the nav's own click handler below.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Opportunities has child pages, so its tab stays lit on them; Overview must not.
  const isActive = (href: string): boolean =>
    pathname === href || (href !== "/console" && pathname.startsWith(`${href}/`));
  const current = LINKS.find((link) => isActive(link.href));

  return (
    <header className="app-bar">
      <Link href="/" className="app-bar__brand">
        <Mark className="h-[30px] w-[30px]" />
        <span className="app-bar__wordmark">Lantern</span>
      </Link>
      <div className="app-nav-wrap" ref={navRef}>
        <button
          type="button"
          className={`app-nav-toggle${menuOpen ? " is-open" : ""}`}
          aria-expanded={menuOpen}
          aria-controls="console-nav"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MenuGlyph />
          <span className="app-nav-toggle__label">{current?.label ?? "Menu"}</span>
        </button>
        <nav
          id="console-nav"
          className={`app-nav${menuOpen ? " is-open" : ""}`}
          aria-label="Console"
          onClick={() => setMenuOpen(false)}
        >
          {LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`app-nav__tab${active ? " is-active" : ""}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="app-bar__end">
        <NotificationBell />
        <AccountMenu email={email} company={company} githubLogin={githubLogin} />
      </div>
    </header>
  );
}

function MenuGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="flex-none">
      <path
        d="M2 4h12M2 8h12M2 12h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
