/** Quoting for the one shell line each sandbox command becomes. */

/** Wraps a value in single quotes the way POSIX `sh` reads them, so it is one literal word. */
export function shellQuote(value: string): string {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Joins argv into one line, quoting each word. */
export function shellJoin(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}

/** Cuts a string for a trace title without leaving a dangling word. */
export function truncate(text: string, limit: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= limit) return single;
  return `${single.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

/** The last `count` non-empty lines of a block of output. */
export function tail(text: string, count: number): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.slice(-count).join("\n");
}
