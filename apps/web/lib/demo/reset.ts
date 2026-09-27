/**
 * Putting the demo back to its starting position.
 *
 * Two callers share this: the console's Reset demo action and `scripts/reset-demo.mjs`. It has no
 * imports on purpose, so the script can load it directly and so nothing here can reach for a
 * server-only client by accident.
 *
 * It deliberately leaves the knowledge base alone. Sources take minutes to read and cost money to
 * embed; the demo starts from a repository with nothing filed against it, not from an empty index.
 */

export type ResetOptions = {
  /** `owner/name` of the repository the worker files against. Skipped when null. */
  repo: string | null;
  githubToken: string | null;
  supabaseUrl: string | null;
  supabaseKey: string | null;
  /** Only this project's conversations, requests, escalations, known routes and trace events are cleared. */
  projectId: string;
  /** Report what would happen and change nothing. */
  dryRun?: boolean;
};

export type ResetSummary = {
  dryRun: boolean;
  repo: string | null;
  issuesClosed: number;
  pullRequestsClosed: number;
  branchesDeleted: number;
  traceEvents: number;
  escalations: number;
  requestGroups: number;
  conversations: number;
  /** Questions the agent had already resolved to a control, which would otherwise pin an answer. */
  knownRoutes: number;
  /** Anything that could not be done, in words a person can act on. */
  problems: string[];
};

/** The label the worker puts on the issues it files. */
const ISSUE_LABEL = "lantern";
/** Every branch the worker pushes starts with this. */
const BRANCH_PREFIX = "lantern/";

type Json = Record<string, unknown>;

async function github(
  token: string,
  method: string,
  path: string,
  body?: Json,
): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404) return null;
  if (response.status === 204) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${method} ${path} answered ${response.status}: ${detail.slice(0, 200)}`);
  }
  return response.json();
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

/** Closes the issues the worker filed, leaving anything a person opened alone. */
async function closeIssues(token: string, repo: string, dryRun: boolean): Promise<number> {
  const issues = asArray(
    await github(token, "GET", `/repos/${repo}/issues?state=open&labels=${ISSUE_LABEL}&per_page=100`),
  ).filter((issue) => !issue.pull_request);

  for (const issue of issues) {
    if (!dryRun) {
      await github(token, "PATCH", `/repos/${repo}/issues/${issue.number as number}`, {
        state: "closed",
        state_reason: "not_planned",
      });
    }
  }
  return issues.length;
}

/** Closes the pull requests the worker opened, recognised by their branch. */
async function closePullRequests(token: string, repo: string, dryRun: boolean): Promise<number> {
  const pulls = asArray(await github(token, "GET", `/repos/${repo}/pulls?state=open&per_page=100`)).filter(
    (pull) => String((pull.head as Json | undefined)?.ref ?? "").startsWith(BRANCH_PREFIX),
  );

  for (const pull of pulls) {
    if (!dryRun) {
      await github(token, "PATCH", `/repos/${repo}/pulls/${pull.number as number}`, { state: "closed" });
    }
  }
  return pulls.length;
}

async function deleteBranches(token: string, repo: string, dryRun: boolean): Promise<number> {
  const refs = asArray(
    await github(token, "GET", `/repos/${repo}/git/matching-refs/heads/${BRANCH_PREFIX}`),
  );

  for (const ref of refs) {
    const name = String(ref.ref).replace("refs/heads/", "");
    if (!dryRun) await github(token, "DELETE", `/repos/${repo}/git/refs/heads/${name}`);
  }
  return refs.length;
}

/** Deletes rows through PostgREST and returns how many went, counted by the server. */
async function clearTable(
  url: string,
  key: string,
  table: string,
  filter: string,
  dryRun: boolean,
): Promise<number> {
  const response = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: dryRun ? "GET" : "DELETE",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      prefer: "count=exact",
      ...(dryRun ? { range: "0-0" } : {}),
    },
  });
  if (!response.ok && response.status !== 206) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${table} answered ${response.status}: ${detail.slice(0, 200)}`);
  }
  const range = response.headers.get("content-range") ?? "";
  return Number(range.split("/")[1] ?? 0);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Closes what the worker opened, deletes its branches, and clears the conversations, request
 * groups, escalations, known routes and trace events of one project. A step that fails is recorded
 * and the rest still runs, because a half-reset demo is worse than one that says which half is
 * left.
 */
export async function resetDemo(options: ResetOptions): Promise<ResetSummary> {
  const dryRun = options.dryRun ?? false;
  const summary: ResetSummary = {
    dryRun,
    repo: options.repo,
    issuesClosed: 0,
    pullRequestsClosed: 0,
    branchesDeleted: 0,
    traceEvents: 0,
    escalations: 0,
    requestGroups: 0,
    conversations: 0,
    knownRoutes: 0,
    problems: [],
  };

  const { repo, githubToken } = options;
  if (repo && githubToken) {
    for (const [name, step] of [
      ["issuesClosed", () => closeIssues(githubToken, repo, dryRun)],
      ["pullRequestsClosed", () => closePullRequests(githubToken, repo, dryRun)],
      ["branchesDeleted", () => deleteBranches(githubToken, repo, dryRun)],
    ] as const) {
      try {
        summary[name] = await step();
      } catch (error) {
        summary.problems.push(reason(error));
      }
    }
  } else if (!repo) {
    summary.problems.push("No repository is bound, so nothing was closed on GitHub.");
  } else {
    summary.problems.push("No GitHub credential is configured, so nothing was closed on GitHub.");
  }

  const { supabaseUrl, supabaseKey, projectId } = options;
  if (supabaseUrl && supabaseKey) {
    // Trace events first: they point at the escalations and conversations that follow. Request
    // groups have to go too, or the next demo joins the group this one left behind and files
    // nothing. Known routes go with them: a route the agent remembered answers the demo's first
    // question from the last run's product map, before a single check runs.
    for (const [name, table] of [
      ["traceEvents", "trace_event"],
      ["escalations", "escalation"],
      ["requestGroups", "feature_request_group"],
      ["conversations", "conversation"],
      ["knownRoutes", "known_route"],
    ] as const) {
      try {
        summary[name] = await clearTable(
          supabaseUrl,
          supabaseKey,
          table,
          `project_id=eq.${projectId}`,
          dryRun,
        );
      } catch (error) {
        summary.problems.push(reason(error));
      }
    }
  } else {
    summary.problems.push("No database credential is configured, so nothing was cleared.");
  }

  return summary;
}
