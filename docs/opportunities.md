# Opportunities

An opportunity is a request group with evidence behind it. The three checks proved a feature is
absent; the question that follows is whether this is one person or a pattern. PostHog answers it,
the capability compiler turns the answer into a specification, the forge engine builds and
verifies it, and PostHog measures the result. This file is the middle of that story: the pipeline
between the absence verdict and the forge run, the queries it runs, and the console page that shows
all of it.

The order is fixed and every surface presents it the same way:

```text
user workflows  ->  inferred intent  ->  semantic capability  ->  verified implementation
```

PostHog is named once, as the evidence source. The middle two stages are Lantern's own
(`docs/capability-compiler.md`). The last is the forge engine (`docs/forge.md`).

## The pipeline

`apps/web/lib/opportunity` runs steps 2 to 7 of the evidence loop for one request group. It is
called a discovery, and one run is one `discovery` row.

| Step | File | What happens | Trace row |
|---|---|---|---|
| 0 | `queue.ts` | The turn ends `absent` (`lib/agent/turn.ts`), or the user reports the gap (`POST /api/escalate`), or the console asks (`POST /api/opportunities/:groupId/discover`). A `queued` row is inserted for the group, or the one already queued or running is joined. | `status` "Checking whether other customers hit this", on the conversation |
| 2 | `mine.ts` | One HogQL query returns every successful seat-map session in the window as one row with its ordered steps; one more returns the session count and two medians. | `tool` "PostHog: 65 successful sessions in the last 90 days, median 14 interactions" |
| 3 | `mine.ts`, `describe.ts` | The replay deep link is built for every session and kept only when PostHog confirms a recording exists. Every session is described once with the compiler's own step renderer and manual-step count, and the rows are cached in `trajectory` (`steps`, `rendered`, `manual_actions`), idempotent on `(group_id, session_id)`. | `artifact` "63 replays linked" |
| 4 to 7 | `compile.ts` | `compile()` from `@lantern/capability` with the OpenAI model client in `model.ts`. Every line of the decision trail is written in order as a `capability` row. A validated IR is stored as the group's next `capability_spec` version; the per-session goals and rewards land on the `trajectory` rows. | `capability` rows, one per compiler event; `artifact` "Capability specification v1: seat_party_together"; `decision` "missing_capability.discovered: seat_party_together" |
| 7 | `run.ts` | The row is marked `done` with the decision, the supporting session count and the medians. The evidence line lands on the conversation that triggered the run. | `decision` "63 similar sessions worked around this by hand", on the conversation |
| 19 | `measure.ts` | `POST /api/opportunities/:groupId/measure` runs the outcome query and stores a `deployment_outcome` row, labelled `seeded` when every outcome event carries `seeded: true`, else `posthog`. | `artifact` "90-day outcome (seeded)" |

Every pipeline row carries `source: "forge"` and the group id; the two lines on the conversation
carry `source: "agent"` so the chat's trace reads as one story. The forge run that follows is
`docs/forge.md`, started from the page or from `POST /api/opportunities/:groupId/forge`.

### Who runs a queued row

A request never runs the pipeline before it answers. It enqueues and returns. `DISCOVERY_MODE`
says who executes the row:

- `inline`: the process that enqueued it runs it after the response. Right on a laptop, and the
  default when `VERCEL` is not set.
- `runner`: `npm run discover:runner` polls the queue, claims the oldest row through
  `claim_discovery()` (`for update skip locked`, so several runners can share one queue) and runs
  it. Right on a host that caps a request at 300 s, and the default on Vercel.

Claiming is atomic either way, so the two can coexist. Status values: `queued`, `running`,
`done`, `failed`. At most one row per group is queued or running (a partial unique index); a
second trigger joins it. The agent's triggers run once per group: a group with a finished run is
left alone. The console's button always enqueues.

### The console never evaluates the compiler

`@lantern/capability` reads its prompt files through `import.meta.url` when its modules load.
Route handlers and the runner evaluate it fine; the App Router page layer does not (no URL at
build time, a foreign URL at request time). So the pipeline does every rendering the page needs
and stores it on the rows, and `lib/opportunity/read.ts` and the components import the package as
types only. Keep it that way: a page that imports a compiler value breaks `next build`.

### Two medians

The evidence card shows two numbers with two definitions, and says which is which:

- **Median seat-map interactions** is the product's own count from `seat_assignment_confirmed`:
  seat clicks, refused clicks and passenger picks. It is what NovaAir calls an interaction, it is
  what the seeded sessions were tuned to (14), and it is what the outcome events count, so the
  before and after compare like with like.
- **Median manual steps** is the compiler's count: every manual step, hover scanning included.
  It is what one capability call would replace, and it is what the IR's
  `evidence.median_manual_actions` and the pull request body carry.

Both are stored on `capability_spec` and on `discovery`.

### NovaAir's names and the compiler's

The queries use NovaAir's event and property names (`docs/analytics.md` in the NovaAir
repository). The compiler's scenario rules key on refusal reasons spelled `booked`, `blocked` and
`child_in_exit_row`; NovaAir sends `seat_booked`, `seat_blocked` and `exit_row_child`. The parser
in `lib/posthog/trajectories.ts` maps them (`REASON_ALIASES`) so no verification scenario is
silently dropped. The right long-term home for those names is the compiler's contract table.

## The queries

`apps/web/lib/posthog/hogql.ts`. Every query filters on the time window first and scans `events`
once. Property access is `toString(properties.x)`, so a missing property is null rather than a
type error. `OFFSET` is never used; the endpoint rejects it for personal API keys.

**Trajectories**, one row per session:

```sql
SELECT session_id, distinct_id, opened_at, confirmed_at,
       dateDiff('second', opened_at, confirmed_at) AS duration_seconds,
       length(arrayFilter(x -> x.1 >= opened_at AND x.1 <= confirmed_at, all_steps)) AS step_count,
       arrayFilter(x -> x.1 >= opened_at AND x.1 <= confirmed_at, all_steps) AS steps
FROM (
    SELECT toString(properties.$session_id) AS session_id,
           any(distinct_id) AS distinct_id,
           minIf(timestamp, event = 'seat_map_opened') AS opened_at,
           maxIf(timestamp, event = 'seat_assignment_confirmed') AS confirmed_at,
           countIf(event = 'seat_map_opened') AS n_open,
           countIf(event = 'seat_assignment_confirmed') AS n_confirm,
           arraySort(groupArray(tuple(timestamp, event, toString(properties.seat), ...))) AS all_steps
    FROM events
    WHERE timestamp >= now() - INTERVAL 90 DAY AND event LIKE 'seat_%'
      AND notEmpty(toString(properties.$session_id))
    GROUP BY session_id
    HAVING n_open > 0 AND n_confirm > 0
)
WHERE confirmed_at > opened_at
ORDER BY opened_at DESC
LIMIT 200
```

`groupArray(tuple(timestamp, ...))` collects every seat step per session and `arraySort` orders
them by the tuple's first element, the timestamp: the ordered trajectory with no window function
and no self-join. `minIf` and `maxIf` find the window's edges in the same pass; the `HAVING` keeps
only sessions that opened the map and confirmed, the successful workflows the compiler starts
from. The tuple carries the nineteen properties in `STEP_PROPERTIES`; the parser reads them back
by that list.

**Headline**, the two numbers: `count()` of those sessions, `median()` of the manual-step count
over the same four events the compiler counts, and `median()` of the product's `interactions`.

**Outcome**, after the launch: counts of `<intent>_eligible`, `<intent>_used` and
`<intent>_succeeded`, `medianIf` of `interactions` on the succeeded events, support contacts
before and after the launch (`seat_support_contact` with `period`), and how many of those events
carry `seeded: true`.

**Replays**: `GET /api/projects/{id}/session_recordings/{session_id}/`. The recording id is the
session id, so a 200 means the link will open on a recording. The link itself is
`{host}/project/{project_id}/replay/{session_id}` and needs no call.

The client (`lib/posthog/client.ts`) is the only module that holds the personal API key. It names
every query (`lantern_trajectories`, `lantern_headline`, `lantern_outcome`) so they can be told
apart in PostHog's `query_log`. Rate limits are 240 queries a minute and three at once; a
discovery runs two queries and up to two hundred recording lookups, four at a time.

### Running the queries by hand

The mining step is one call with the keys in the environment:

```bash
npx tsx --tsconfig apps/web/tsconfig.json -e '
  import { posthogClient } from "@/lib/posthog/client";
  import { trajectoryQuery } from "@/lib/posthog/hogql";
  const r = await posthogClient().query("by_hand", trajectoryQuery({ windowDays: 90, limit: 5 }));
  console.log(r.columns, r.results.length, r.durationMs);
'
```

On 2026-08-29 against the seeded project: 65 confirmed sessions in about 500 ms, 63 of them a
party seated together; median interactions 14, median manual steps 30.

## The page

`/console/opportunities` lists every group with a discovery, a specification or a forge run: the
title (the specification's summary when there is one), the status as text, the session count,
the median interactions, the scenario count, the report count.

`/console/opportunities/:groupId` is the plan's opportunity card, in story order:

1. **User workflows.** Matching PostHog sessions, the two medians, the common intent, and three
   sessions rendered step by step (`renderStep` from the compiler, so the page and the prompts say
   the same words) with a "watch this session" link to the replay. The three are chosen by shape:
   the one that went straight to the seats, the one that backtracked through the most refusals,
   the one that moved each passenger in turn.
2. **Inferred intent.** The goal sentence, how many sessions share it, and the two reward axes as
   five-bucket bars, kept apart: high completion with low coherence is the workaround signal.
3. **Semantic capability.** The signature, the summary, the granularity decision (steps replaced,
   the names rejected below and above, coverage), the structured state, the interactive
   elements, the semantic actions, the constraints with their source, the preferences, the
   final-state checks, the scenario count by kind, the proposed interface, and the IR as JSON.
4. **Verified implementation.** From the forge tables: Capability, UI, Integration, Tests N/M,
   Sandbox preview; candidate A and B with their scores and failing scenarios; **Open Preview**
   (`GET /api/forge/:id/preview`, rebuilt and health-checked on every read), **View Code** (the
   pull request's files, or the branch), **Create Draft PR** (`POST /api/opportunities/:groupId/forge`)
   and, once the run pauses, **Approve & Merge** and **Reject** (`POST /api/escalations/:id/approve`).
5. **Outcome.** Before: the matching workflows and the median interactions. After: eligible,
   used, succeeded, the median before and after, the change in support contacts, and the label
   the row carries: seeded data, or measured by PostHog.

The page polls its own route every three seconds while a discovery or a forge run is going and
every twenty otherwise. Status is text. Nothing on the page is a literal colour.

## The terminal live view

```bash
LANTERN_URL=http://localhost:3000 LANTERN_CONSOLE_TOKEN=... npm run tail
npm run tail -- --group <groupId>
```

`scripts/lantern-tail.mjs` follows `/api/trace/stream` with no dependencies and draws the four
stages, the sandbox steps and every trace row. The board's state and rendering are
`scripts/lib/tail-render.mjs`, tested in `apps/web/test/tail.test.ts`. It reconnects from the last
event id, so the server's four-minute close is invisible.

A terminal has no session cookie. `LANTERN_CONSOLE_TOKEN` lets it present a bearer token instead
and read the project named by `LANTERN_CONSOLE_PROJECT` (`apps/web/lib/console/current.ts`). Off
unless the token is set; a session always wins; the comparison is constant time.

## Running it

```bash
npm test -w @lantern/web                  # the miner, the pipeline, the route, the tail, the token
npm run discover:runner -- --once          # drain the queue once, with the keys in the environment
```

The pipeline tests drive `runDiscovery` with a fake PostHog answering from the compiler's fixture
sessions, the compiler's fake model and a memory store. The parser tests run over rows a real
query returned (`apps/web/test/fixtures/posthog`).
