#!/usr/bin/env node
// Resets the demo: closes the worker's issues and pull requests in the target repository, deletes
// its branches, clears escalations, request groups, conversations, known routes and trace events,
// and moves `main` back to the `demo-baseline` tag. Run through vault-exec so the tokens are in
// the environment.
//
//   node scripts/reset-demo.mjs [--dry-run] [--skip-main] [--repo owner/name]
//
// The knowledge base is never touched: sources take minutes to read and cost money to embed.
//
// Everything except the `main` reset is shared with the console's Reset demo action and lives in
// apps/web/lib/demo/reset.ts. Moving `main` stays here, because a force push is not something a
// button in a browser should do.
//
// `--skip-main` leaves the `main` branch and the tag alone (use it while the target repository is
// still being set up, so the tag is not created at a placeholder commit).
//
// The `demo-baseline` tag marks the commit `main` is reset to. If the tag does not exist, the
// first run creates it at the current head of `main` (the same thing as `git tag demo-baseline`
// followed by `git push origin demo-baseline`) and does not move `main`. To pick a new baseline,
// delete the tag on GitHub and run the script again from the commit you want.

// Node strips the types on its own. `npm run demo:reset` disables the typeless-package warning
// this raises, because apps/web is a Next app and does not declare "type": "module".
import { resetDemo } from "../apps/web/lib/demo/reset.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipMain = args.includes("--skip-main");
const repoArg = args.indexOf("--repo");
const REPO = repoArg >= 0 ? args[repoArg + 1] : (process.env.LANTERN_REPO ?? "AadiDahake/novaair-own-your-intelligence");
const PROJECT_SLUG = process.env.LANTERN_PROJECT_SLUG ?? "novaair";
const BASELINE_TAG = "demo-baseline";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? null;
const SUPABASE_URL = process.env.SUPABASE_URL ?? null;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

const log = (line) => console.log(`${dryRun ? "[dry-run] " : ""}${line}`);

async function gh(method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
  if (response.status === 204) return null;
  return response.json();
}

/** The project whose rows are cleared, looked up by the slug the console manages. */
async function projectId() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/project?slug=eq.${PROJECT_SLUG}&select=id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  if (!response.ok) throw new Error(`project lookup -> ${response.status}`);
  const rows = await response.json();
  if (rows.length === 0) throw new Error(`no project with slug ${PROJECT_SLUG}`);
  return rows[0].id;
}

async function tagCommitSha(ref) {
  // A lightweight tag points at the commit; an annotated tag points at a tag object.
  if (ref.object.type === "commit") return ref.object.sha;
  const tag = await gh("GET", `/repos/${REPO}/git/tags/${ref.object.sha}`);
  return tag.object.sha;
}

async function resetMain() {
  const main = await gh("GET", `/repos/${REPO}/git/ref/heads/main`);
  if (!main) throw new Error("branch main not found");
  const tag = await gh("GET", `/repos/${REPO}/git/ref/tags/${BASELINE_TAG}`);
  if (!tag) {
    log(`tag ${BASELINE_TAG} missing: create it at main (${main.object.sha.slice(0, 7)}); main is not moved`);
    if (!dryRun) await gh("POST", `/repos/${REPO}/git/refs`, { ref: `refs/tags/${BASELINE_TAG}`, sha: main.object.sha });
    return "tag created";
  }
  const baseline = await tagCommitSha(tag);
  if (baseline === main.object.sha) {
    log(`main already at ${BASELINE_TAG} (${baseline.slice(0, 7)})`);
    return "unchanged";
  }
  log(`force main from ${main.object.sha.slice(0, 7)} back to ${BASELINE_TAG} (${baseline.slice(0, 7)})`);
  if (!dryRun) await gh("PATCH", `/repos/${REPO}/git/refs/heads/main`, { sha: baseline, force: true });
  return "reset";
}

async function main() {
  const summary = await resetDemo({
    repo: GITHUB_TOKEN ? REPO : null,
    githubToken: GITHUB_TOKEN,
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_KEY,
    projectId: SUPABASE_URL && SUPABASE_KEY ? await projectId() : "",
    dryRun,
  });

  log(`${dryRun ? "would close" : "closed"} ${summary.issuesClosed} issue(s) and ${summary.pullRequestsClosed} pull request(s)`);
  log(`${dryRun ? "would delete" : "deleted"} ${summary.branchesDeleted} branch(es)`);
  log(`${dryRun ? "would delete" : "deleted"} ${summary.traceEvents} trace event(s), ${summary.escalations} escalation(s), ${summary.requestGroups} request group(s), ${summary.conversations} conversation(s), ${summary.knownRoutes} known route(s)`);
  for (const problem of summary.problems) console.warn(`warning: ${problem}`);

  const mainState = GITHUB_TOKEN && !skipMain ? await resetMain() : "skipped";
  console.log(JSON.stringify({ ...summary, repo: REPO, main: mainState }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
