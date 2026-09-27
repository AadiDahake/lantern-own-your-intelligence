/** The command line of `npm run explore`: one site now, or the queue, once or for good. */
export type ExploreArgs =
  | { mode: "one"; project: string; url: string | null }
  | { mode: "drain" }
  | { mode: "watch" }
  | { error: string };

const USAGE = "usage: npm run explore -- --project <slug> [--url <site>] | --drain | --watch";

export function parseExploreArgs(argv: readonly string[]): ExploreArgs {
  let project: string | null = null;
  let url: string | null = null;
  let mode: "drain" | "watch" | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--drain" || arg === "--watch") {
      mode = arg.slice(2) as "drain" | "watch";
    } else if (arg === "--project" || arg === "--url") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) return { error: `${arg} needs a value. ${USAGE}` };
      if (arg === "--project") project = value;
      else url = value;
      index += 1;
    } else {
      return { error: `unknown argument ${arg}. ${USAGE}` };
    }
  }
  if (mode && (project || url)) return { error: `--${mode} takes no project or url. ${USAGE}` };
  if (mode) return { mode };
  if (!project) return { error: USAGE };
  return { mode: "one", project, url };
}
