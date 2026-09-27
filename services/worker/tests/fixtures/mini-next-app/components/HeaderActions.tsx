// Global controls belong here, in order.
export function HeaderActions() {
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <a href="https://discord.com" className="hover:text-ink">
        Discord
      </a>
      <a href="/help" className="hover:text-ink">
        Help Center
      </a>
    </div>
  );
}
