# Lantern worker

The worker turns an accepted feature request into a shipped change. It runs as a plain polling
process: it claims `escalation` rows the dashboard queued, runs the steps in order, and implements
the human pause by waiting for the console to write `escalation.approval`.

For one escalation it:

1. **Files the issue.** Asks the architect model for the priority (`low`, `medium` or `high`,
   recorded in the trace), makes sure the `lantern` and `priority:<level>` labels exist on the
   repository, and labels the issue with both. Dedupes against open issues by title: a repeat
   raises the "Requested N times" line in the existing issue's body and adds a comment with the
   new user's words instead of filing twice. Otherwise it asks the model to call the GitHub MCP
   `create_issue` tool and executes that call through the remote MCP server, falling back to the
   REST API when MCP fails.
2. **Inspects the repository.** Shallow clone, then the architect model reads the bounded file tree,
   `AGENTS.md`, the dependency list and the twelve most relevant files **in full**, and answers with
   2 to 7 files, each with a reason and an action (`edit`, `create` or `delete`), plus acceptance
   criteria. Ranking is by what the path says; body hits only break ties, and a path `AGENTS.md`
   names in backticks is lifted because it carries the repository's contract.
3. **Drafts the implementation.** One editor call per written file (existing contents supplied
   verbatim, whole-file output); a planned deletion needs no model call. Applies the files and the
   deletions in the clone, then runs the gates: `npm ci` (cached `node_modules` under
   `~/.cache/lantern/<repo>` keyed by the lockfile hash), then every gate the target's
   `package.json` defines, cheapest first: `npm run typecheck`, `npm test`, `npm run build`. On
   failure the gate output goes back to the editor for the affected file (up to 3 repairs), then a
   fresh candidate is drafted (up to 2 candidates). A repair also gets the files the gate named that
   the plan does not touch, read from the clone: a failing test says what the code has to satisfy,
   and a stack trace alone does not carry the signature it is being called with.
4. **Opens a draft pull request** on `lantern/<issue>-<slug>` with one commit
   (`feat: <title>`, `Closes #<n>`; a deleted path goes into the tree with a null blob sha), through
   MCP `create_pull_request` with a REST fallback. The body names the request, the user's quote, the
   count line and every changed and deleted file. It then comments with the gate results and a link
   to `NEXT_PUBLIC_APP_URL/console/activity`, and pauses for a human decision. The last two trace
   rows are the pull request and the approve card.
5. **After approval** marks the PR ready (GraphQL `markPullRequestReadyForReview`), waits for
   `mergeable`, squash-merges, and polls Vercel for the deployment of the merge commit (filtered by
   `sha`, matched on `meta.githubCommitSha`) until it is `READY`. After 10 minutes it stops with a
   `status` event rather than hanging: the merge landed, so the run is not marked failed. After a
   rejection it closes the PR with a comment.

### The architect and the target repository's premise

A product repository can hold a convention, a contract or a test whose whole content is that the
requested feature is absent. Read as instructions those forbid the change, and the architect used to
answer with no files at all. The issue reaching the worker is an approved decision, so the premise is
what the change supersedes. The architect is told that, a guard that only asserts the absence is
planned for deletion or rewrite, the strict schema requires at least one file, an empty answer is
retried once with the refusal named, and a second empty answer raises with the model's own words in
the message. Everything else in the conventions still binds.

When `SLACK_WEBHOOK_URL` is set, one message goes out when the issue is filed and one when the
draft pull request opens.

### The text notice

When `DIAL_API_KEY` and `DIAL_FROM_NUMBER` are set, each person who agreed to a text about the gap
gets it one time when the draft pull request opens. The rule is the web app's own
(`apps/web/lib/sms`), copied in `steps/sms_notice.py`: claim the person with one conditional
update on `gap_subscriber.notified_at`, send one time through `steps/dial.py`, then erase the
number, or give the claim back when the provider refused. The send is the one call in the worker
that does not go through `steps/retry.py`, because the provider's send call has no idempotency key
and a second attempt can be a second text. The trace gets one `status` row before the pull request
row: "Text notice: off" with the variable that is missing, "Text notice: no one asked for a text
about this request", or "Text notice: 2 of 3 sent". A notice that fails never fails the run. A
phone number is never in a trace row, a log line or an error. "The text notice" in section 4 of
`docs/contracts.md` is the contract.

Every step updates `escalation.status` and writes `trace_event` rows (source `workflow`) through
PostgREST, so the console's Activity page shows the run live. A heartbeat writes a `status` trace
event ("worker online") per project every 60 s. Its detail says `sms: true` when both text message
variables are set here. The web app reads the last heartbeat and offers "Text me when a change for
this is drafted" on the widget's gap card only then, because this process sends that text. Once
the draft pull request is open, the text notice runs whatever fails next in that step, so a
refused comment on the pull request does not cost each person their text.

The model ids the worker uses live in `steps/llm.py` and nowhere else. `docs/contracts.md`
section 5 records each choice and why.

## Layout

```
local_runner.py    the engine: polls escalation rows, runs the steps, pause by polling `approval`
heartbeat.py       the "worker online" trace event loop
models.py          Pydantic models: FeatureRequestInput, IssueRef, Plan, Draft, PrRef, Approval, Outcome
config.py          environment access
steps/llm.py       the model provider: ids, chat, structured output, function calls
steps/pipeline.py  the five steps
steps/db.py        PostgREST helpers (update_escalation, emit_trace, claim_queued_local, heartbeat)
steps/trace.py     the trace `detail` shapes the console renders
steps/github.py    REST + GraphQL client
steps/mcp_github.py  streamable-HTTP MCP client and the model-driven issue filing
steps/repo.py      clone, file tree, keyword ranking, bounded reads
steps/codegen.py   architect and editor prompts and model calls
steps/applier.py   atomic apply and delete with a path guard, gates, node_modules cache, diffs
steps/drafting.py  the draft / gate / repair / new-candidate loop
steps/deploy.py    Vercel deployment polling by commit sha, with a clean 10 minute timeout
steps/issue.py     issue and PR body builders
steps/slack.py     optional webhook
steps/sms_notice.py  the text notice: the one-text rule, the people in `gap_subscriber`, the trace row
steps/sms_text.py  how a text is written; the worker's copy of `packages/shared/src/sms.ts`
steps/dial.py      the text message provider: one send, one attempt
steps/seal.py      opens what the dashboard stores encrypted (the GitHub token, a phone number)
tests/             pytest suite and the fixture Next.js app
```

## Running

Python 3.12 and [uv](https://docs.astral.sh/uv/). `node` and `npm` must be on `PATH` for the gates.

```sh
cd services/worker
uv sync
vault-exec uv run python local_runner.py
```

`vault-exec` is the local helper that injects the secrets. Without it, export the variables
yourself (see `.env.example`).

### Environment

| Variable | Required | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | yes | OpenAI API key, used by every model call |
| `SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | service role key; the worker writes `escalation` and `trace_event`, and derives the keys that open a project's linked GitHub token and the phone number of a person who asked for a text |
| `GITHUB_TOKEN` | yes | fallback credential, used only for a project whose owner has not linked a GitHub account: fine-grained PAT with contents, issues and pull requests read-write on the target repository |
| `VERCEL_TOKEN` | yes | token for the Vercel team that owns the target project |
| `TARGET_VERCEL_PROJECT` | no (`novaair`) | Vercel project name whose deployment the worker waits for |
| `TARGET_PRODUCTION_URL` | no | Stable address of that project's production deployments; blank reports each deployment's own URL |
| `SLACK_WEBHOOK_URL` | no | post a message when an issue and a draft PR exist |
| `DIAL_API_KEY` | no | Dial API key; with `DIAL_FROM_NUMBER` it turns on the text notice. Blank: off, and the trace says so |
| `DIAL_FROM_NUMBER` | no | the Dial number that sends each text: E.164, its id, or its nickname |
| `DIAL_API_URL` | no (`https://api.getdial.ai`) | the Dial API base |
| `LANTERN_CACHE_DIR` | no (`~/.cache/lantern`) | where cached `node_modules` live |

### Starting a run by hand

Insert an `escalation` row with `engine='local'` and `status='queued'`, then approve by setting
`approval` to `{"approved": true, "note": ""}`.

## Tests

```sh
uv run pytest                                          # unit tests, no network
vault-exec uv run pytest -s tests/test_codegen_e2e.py  # real model calls against the fixture app
```

The end-to-end test drafts a dark-mode change in `tests/fixtures/mini-next-app` and asserts that
`npm run typecheck` and `npm run build` pass. It is skipped when `OPENAI_API_KEY` is unset. The
first run installs the fixture's dependencies (about a minute); later runs reuse the cache.

## Troubleshooting

- **Nothing is claimed** - the dashboard writes rows with `engine='local'`. Check
  `ESCALATION_ENGINE` on the dashboard and `SUPABASE_URL` here.
- **`git clone failed` / 403 on `/contents`** - the `GITHUB_TOKEN` lacks the Contents permission
  on the target repository. Issues and pull requests need their own permissions too.
- **`npm ci failed`** - the cache under `~/.cache/lantern/<repo>` is keyed by the lockfile hash;
  delete that directory to force a clean install. The gates need network access on the first run.
- **A gate fails in the repair loop** - the trace shows the gate output and every repair. The run
  gives up after 2 candidates with 3 repairs each and marks the escalation `failed`.
- **`npm test` runs against the target repository, not this one.** It is a gate because typecheck
  and build are not enough: a draft passed both and still broke NovaAir's own contract test, having
  added the documented exports with a signature the test does not call. `e2e` is never a gate, as it
  needs a browser and a running server.
- **No deployment found after 10 minutes** - the Vercel project is not linked to the repository, or
  `TARGET_VERCEL_PROJECT` names a different project. The worker matches `meta.githubCommitSha` to
  the squash-merge commit. The run stops with a `status` trace event and leaves the row `deploying`
  with the reason in `error`; the pull request is merged either way.
- **`the architect returned no files after two attempts`** - the message carries the model's own
  summary. If it names a convention in the target repository, that repository is telling the model
  not to build the feature; the prompt already overrides an absence claim, so read the summary
  before changing anything.
- **403 `Resource not accessible by personal access token` on `/git/blobs`** - the credential has
  Issues write but not Contents write. Issues get filed and nothing can be pushed. A fine-grained
  PAT needs Contents read-and-write on the target repository.
- **Worker shows offline in the console** - the heartbeat writes through PostgREST every 60 s;
  check `SUPABASE_URL` and the service role key.
- **Escalation stuck in `awaiting_approval`** - the console must set `escalation.approval`. The
  runner then writes `approval`, `status` and the trace.
