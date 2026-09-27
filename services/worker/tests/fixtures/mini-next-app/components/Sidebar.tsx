const links = [
  { href: "/", label: "Home" },
  { href: "/api-keys", label: "API Keys" },
];

export function Sidebar() {
  return (
    <aside className="w-[260px] border-r border-line bg-sidebar p-4">
      <div className="mb-6 flex items-center gap-2 text-lg font-medium">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-surface">N</span>
        NovaAir
      </div>
      <nav className="flex flex-col gap-1">
        {links.map((link) => (
          <a key={link.href} href={link.href} className="rounded-md px-3 py-2 text-sm hover:bg-hover">
            {link.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
