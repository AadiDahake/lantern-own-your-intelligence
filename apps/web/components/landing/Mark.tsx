type Props = {
  className?: string;
  /** "light" inverts the mark so it reads on a deep accent panel. */
  tone?: "dark" | "light";
};

/** The Lantern mark: a patch, stitched on. */
export function Mark({ className = "h-7 w-7", tone = "dark" }: Props) {
  const plate = tone === "light" ? "var(--paper)" : "var(--accent-deep)";
  const stitch = tone === "light" ? "var(--accent-deep)" : "var(--panel)";

  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="9" fill={plate} />
      <path
        d="M10.5 16.2h11M16 10.7v11"
        fill="none"
        stroke={stitch}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeDasharray="3.1 3.1"
      />
    </svg>
  );
}
