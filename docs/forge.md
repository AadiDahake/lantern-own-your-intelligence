# The forge engine

`forge` is the escalation engine for capability-scale work. It takes a compiled capability
specification and a target repository, has Codex build and verify the capability in isolated
sandboxes through three personas, keeps the candidate that verified best, serves its preview, and
opens a draft pull request for a person to approve. Nothing it does touches the target
repository's default branch. The code lives in `apps/web/lib/forge`.

The specification is the Capability IR of `@lantern/capability` (`docs/capability-compiler.md`).
The engine imports the compiler's type and `assertCapabilityIR`, so a spec that reaches a sandbox
is one the compiler's own schema accepted; `lib/forge/ir.ts` adds the one check the schema does not
make, scenario id uniqueness, because the verifier reports per scenario id. The example the tests
and the local run use is `lib/forge/fixtures/seat-party-together.ir.json`, with 21 scenarios.

## Strategies

One engine, three places a candidate can be built. The engine only knows the `SandboxStrategy`
interface in `strategy.ts`; every strategy writes the same trace, the same candidate rows, and
the same pull request.

| Strategy | Where the personas run | When it is used |
|---|---|---|
| `reflex` | Reflex agents, launched from the three personas by id. Each persona runs in a devbox seeded from a snapshot of the previous one. | The primary path. Selected when `REFLEX_API_KEY` is set. |
| `runloop` | A Runloop devbox per candidate, created by the engine with a code mount of the repository and the Codex CLI installed, driven with `codex exec --json`. | When `RUNLOOP_API_KEY` is set and no Reflex key is. |
| `local` | A git worktree on this machine, with the machine's own `codex` on its saved login, `npm test` locally and `next start` on a free port. | Development, and the fallback when no key is present. |

`FORGE_STRATEGY` selects one explicitly. Without it, the keys that are present decide: Reflex,
then Runloop, then local. `forgeAvailability()` in `config.ts` checks the selected strategy's
variables before anything is written; `POST /api/escalate` and the forge route answer `503
engine_unavailable` when it cannot run.

### Reflex

The three personas are created once in the Reflex web app, from the prompts in
`apps/web/lib/forge/prompts/*.md`, and their `prs_...` ids go in `REFLEX_PERSONA_BUILDER`,
`REFLEX_PERSONA_UX` and `REFLEX_PERSONA_VERIFIER`. Every call carries
`x-organization-id` (`REFLEX_ORG`, default `doing_something`) and the `rfx_` key.

One candidate is a chain of three agents (`reflex.ts`):

1. `POST /agent-personas/{builder}/launch` with the run's prompt, `repoSlug` and `repoBranch`.
   The launch prompt carries the specification, the trajectories and the acceptance criteria
   inline and tells the persona to write them under `.lantern/` first.
2. The agent's events are read from `GET /agents/{id}/stream?fromSeq=` and written to the trace
   until the agent reaches a terminal status. One `needs_input` is answered with a nudge; a second
   stops the agent and fails the candidate.
3. `POST /agents/{id}/snapshots` captures the disk. Reflex ends the run and shuts that box down.
   The UX Builder launches from its persona with `sandboxOptions.snapshotId`; the Verifier the
   same way after it. Peak devboxes per candidate: one.
4. The Verifier's devbox stays up. The repository's own tests, the preview build and server, the
   push and `gh pr create` run on it through the Runloop API (`RunloopSandbox` on the agent's
   `devboxId`), which is the one thing Reflex does not expose on an agent. The preview URL is the
   agent's `tunnelKey`. `RUNLOOP_API_KEY` is therefore required beside the Reflex key.

Teardown stops the agent, shuts the devbox down and deletes the run's snapshots.

Lantern owns the trigger. The Reflex web app shows an Automations tab, but the public OpenAPI
document (`runloopai/reflex-os`, re-read on 2026-08-29 after the personas were created) has no
automation, trigger, schedule, flow or webhook resource among its 173 paths; the one "webhook" in
it is an event type in the stream enum. So `missing_capability.discovered` is Lantern's own event,
`POST /api/opportunities/:groupId/forge` is the automation, and the personas are launched by id.
If a webhook trigger appears on the API, it replaces that route's call to `enqueueForgeRun` and
nothing below it changes.

### Runloop

`runloop.ts` creates a `LARGE` devbox per candidate: a code mount of the repository with the
GitHub token and `npm ci`, `npm i -g @openai/codex@0.151.0` in `launch_commands` (or a blueprint
named by `RUNLOOP_BLUEPRINT` that already carries it), `keep_alive_time_seconds` of one hour,
`metadata.lantern_candidate` for the sweeper, and a tunnel with `auth_mode: "open"`. Codex runs
as `codex exec --sandbox workspace-write -c sandbox_workspace_write.network_access=true
--skip-git-repo-check --json -m gpt-5.6-sol -C <repo> -o <file>` with the prompt on stdin. The
model key reaches the box as `LANTERN_OPENAI_KEY` and is handed to the Codex process alone as
`CODEX_API_KEY` on that one command. If Codex's own Landlock sandbox cannot start inside the
container, the run is retried with `--dangerously-bypass-approvals-and-sandbox` and a `status`
event says so; the devbox is the sandbox. The preview is `next build && next start` bound to
`0.0.0.0:3000`; the tunnel URL is health-checked before it is announced. The branch is pushed with
the token the code mount installed and the pull request is opened with `gh pr create --draft`.

`npm run forge:sweep` lists every devbox tagged by the engine that is still alive and shuts it
down. Run it after a crash.

### Local

`local.ts` clones the repository once into `FORGE_LOCAL_CACHE_DIR` (default
`<tmpdir>/lantern-forge`), fetches and installs it once per run, and gives each candidate a
`git worktree` on its own branch with the clone's `node_modules` through a symlink. Codex is the
machine's `codex`; without `OPENAI_API_KEY` it runs on the saved login. The dependency tree is
added to Codex's writable roots so a test runner can write its cache. The preview is `next start`
on a free port. The push always goes to `https://github.com/<owner>/<name>.git`, never to the
clone's source, so a run against a local checkout (`--source`) cannot push into it.

## Personas

`personas.ts` holds the three personas as data in the shape Reflex's `AgentPersona` uses: name,
agent type, system prompt, model `gpt-5.6-sol`, sandbox size `LARGE`, blueprint name, environment
variable names. The prompts are Markdown in `prompts/`:

- **Capability Builder** finds the existing primitives, composes them into one library function
  and one API route, writes no UI, keeps the existing tests green, deletes a test whose only
  purpose was to assert the capability is absent.
- **UX Builder** continues the builder's thread (`codex exec resume`) and implements the
  product-native interface at `proposed_ui.location` with the repository's own components.
- **Capability Verifier** writes one test per scenario in `success.scenarios`, runs the suite,
  and reports per scenario as JSON. Its final message is constrained by `--output-schema`
  (`VERIFIER_REPORT_SCHEMA`). It fixes nothing.

Every persona receives `.lantern/spec.json` (the IR), `.lantern/trajectories.json`,
`.lantern/acceptance.md` (rendered from the IR's postconditions, constraints, preferences and
scenarios), and the target repository's `AGENTS.md` when it has one. Each prompt carries an
"Authority" section: the specification is a product decision backed by real sessions and reviewed
by a person, so it supersedes a repository rule that exists only to keep the capability absent
(NovaAir's `AGENTS.md` tells an agent to raise group seating rather than add it, and its guard test
bans the names). Every other rule of the repository stands. Without that section the first live
run's Capability Builder obeyed the guard and changed nothing. The two candidates get one
line each that differs: candidate A is told to prefer the most direct composition, candidate B to
enumerate every result and rank it. The verifier decides between them.

## The pipeline

`engine.ts` runs steps 8 to 18 of the evidence loop and writes every step as a `trace_event`
with `source: "forge"`.

| Step | What happens | Trace |
|---|---|---|
| 8 | The escalation moves to `drafting`. | `status` "Forge started" |
| 9 | Two candidates provision in parallel (`Promise.all`). | `candidate` "Candidate A provisioning", "Candidate B provisioning" |
| 10 | Capability Builder. Every `item.completed` command becomes a `tool` row, every `file_change` an `artifact`. | `tool`, `artifact`, `model` rows prefixed with the persona |
| 11 | UX Builder, in the same sandbox, resuming the builder's thread. | same |
| 12 | Capability Verifier, then the repository's own `npm test -- --reporter=json`. `verify.ts` scores against the specification's scenario ids: a scenario the verifier did not report counts as failed. | `candidate` "Candidate A: 18/21", "Candidate B: 21/21", detail holds the failing ids |
| 13 | `select.ts`: highest scenarios passed, tie-break on fewest changed files. | `decision` "Selected candidate B, 21/21" |
| 14 | The winner builds and serves; the URL is health-checked. | `preview` "Preview live" with `{url, candidate}` |
| 15 | The loser's sandbox is torn down. | `status` "Candidate A torn down" |
| 16 | Branch pushed, draft pull request opened with the body from `pr.ts`. | `tool` "Pushed ...", `artifact` "Draft PR #182" |
| 17 | Pause for a person. | `pause` "Approve & merge?" |
| 18 | On approval: mark ready, squash merge, watch the Vercel deployment (`deploy.ts`), tear the winner down. On rejection: close the pull request, tear the winner down. | `status` rows, `artifact` "Deployment is live" |

A candidate that fails at any step tears its own sandbox down and the other continues. When no
candidate finishes, or the winner's preview cannot be built, the run fails and every sandbox is
torn down in a `finally`. On success only the winner's sandbox stays up, on purpose: it is the
preview and the branch until the decision. Its handle (devbox id and tunnel key, or the local
path and port) is on the candidate row, never a URL: `GET /api/forge/:id/preview` rebuilds the URL
and health-checks it on every read, and answers `null` once the box is gone.

## The trust boundary

- The engine never checks out, commits to, or pushes the default branch. Every candidate works on
  `lantern/<intent>-<label>`; the pull request is a draft; a person approves it in the console.
- Model output is untrusted. The verifier's report is parsed into a checked shape; an unknown
  scenario id is ignored and a missing one counts as failed. Codex's JSONL is narrowed by
  `asThreadEvent` before it is read.
- The model key is never in a command line or a trace row. Under Runloop it is an environment
  variable of the box, expanded by the box's shell for the Codex process only. Under Reflex the
  organization holds the key and Lantern hands nothing over. The GitHub token reaches `git`
  through a credential helper that reads it from the environment.
- `.lantern/` (the specification, the prompts, the reports) never travels with the change: the
  commit excludes it and the changed-file list drops it.
- An open tunnel exposes every port on the box. The preview is a built app with nothing else
  listening, and the box lives at most `keep_alive_time_seconds`.

## Why two candidates

A Runloop trial allows three running devboxes. The plan's picture has two candidates, a UX
Builder and a Verifier at once, which is four. The engine runs two candidates in parallel and the
UX Builder and the Verifier as later personas inside each candidate's own sandbox. That keeps the
peak at two boxes with one slot spare, and it is more honest: the interface and the verification
belong to the candidate they judge. Two `LARGE` boxes for thirty minutes cost about $0.42.

## Running it locally

```bash
# offline: the engine end to end with a fake strategy replaying recorded Codex output
npm test

# for real, on this machine, against a clone of the target repository
npm run forge:local -- --spec apps/web/lib/forge/fixtures/seat-party-together.ir.json
npm run forge:local -- --spec <ir.json> --repo AadiDahake/novaair-own-your-intelligence --base main --no-push --hold 120
npm run forge:local -- --spec <ir.json> --source ~/workspace/projects/novaair --base fm/nova-site --no-push

# clean up devboxes a crash left behind
npm run forge:sweep
```

`--no-push` stops before the push and prints the branch, the changed files and the pull request
body that would have been opened. `--hold <seconds>` keeps the winner's preview up before tearing
it down; `--keep` leaves it up. `--trace-out <path>` writes every trace row as JSON lines.

From the console: `POST /api/opportunities/:groupId/forge` starts a run for the group's latest
compiled specification (or the `spec` in the body while none is stored) and answers `202` with the
escalation id. `GET /api/forge/:escalationId` lists the candidates; `GET
/api/forge/:escalationId/preview` gives the live preview URL or `null`. Approval goes through the
existing `POST /api/escalations/:id/approve`, which records the decision and answers `202`.

## Where a run actually runs

Neither route does the work. A forge run is two sandboxes, six Codex sessions and two test runs,
which is tens of minutes; carrying a decision out is a merge plus a Vercel deployment watch, which
`deploy.ts` gives eight minutes. Vercel's hobby plan caps a serverless function at 300 s, and no
plan holds a function open for a run of that length, so both routes answer as soon as the row
exists and a long-lived process does the rest:

```bash
npm run forge:runner
```

This is the shape the `local` engine has always had, where `services/worker/local_runner.py` polls
the same table. The console and the widget read `trace_event` rows either way, so the live trace,
the Activity page and the widget's status are unchanged.

The `escalation` row is the queue. `lib/forge/queue.ts` holds both claims and
`apps/web/scripts/forge-runner.ts` is the loop, which polls every 2 s and carries each claimed row
on its own promise, so a run waiting on a deployment does not hold up the next one.

| Queue | A row joins it when | The runner claims it by | Then |
|---|---|---|---|
| A run to build | `POST /api/opportunities/:groupId/forge` writes `engine='forge'`, `status='queued'` and the `capability_ir` it will build | moving `queued` to `drafting`, conditional on it still being `queued` | `runForge` from step 8, ending on the `pause` for a person |
| A decision to carry out | `POST /api/escalations/:id/approve` writes `approval` and `status` `approved` or `rejected` | stamping `approval_claimed_at`, conditional on it still being null | `approveForge`: mark ready, squash merge, watch the deployment, tear the winner down |

Each claim is one conditional update, so two runners cannot take the same row.

Two columns arrive with `0015_forge_queue.sql`. `capability_ir` is the specification, copied onto
the row at enqueue time: it is what makes a forge escalation runnable, because the widget also
opens `engine='forge'` rows with status `queued` and no specification, and the runner must skip
those. `approval_claimed_at` is the claim on a decision; the status column cannot carry that one,
because a rejection's terminal status is `rejected`, which is already the status the console wrote.

Everything that can refuse a run still happens in the route, before a row exists: the strategy's
keys (`forgeAvailability`) and the target repository's token. What is left is only work.

The runner needs the same environment a run needs: the Supabase service key, the GitHub token, and
the selected strategy's keys, plus `VERCEL_TOKEN` for the deployment watch. Export them
first. Stop it with Ctrl-C; a row it was carrying stays where it got to, and `npm run forge:sweep`
shuts down any devbox it left behind.
