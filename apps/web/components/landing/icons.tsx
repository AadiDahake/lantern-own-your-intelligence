const base = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function IconScreen() {
  return (
    <svg {...base} aria-hidden>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M9 10l3 2 3-3" />
    </svg>
  );
}

export function IconChecks() {
  return (
    <svg {...base} aria-hidden>
      <path d="M4 7h5M4 12h5M4 17h5" />
      <path d="M13 6.5l2 2 4-4" />
      <path d="M13 15l5 5M18 15l-5 5" />
    </svg>
  );
}

export function IconBranch() {
  return (
    <svg {...base} aria-hidden>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M6 8v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8" />
      <path d="M12 14v2" />
    </svg>
  );
}
