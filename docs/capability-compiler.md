# The capability compiler

`packages/capability` (`@lantern/capability`) turns repeated user workflows into one product
capability. Trajectories go in. A validated Capability IR comes out, or a reasoned "none". It is
pure TypeScript: no network, no database, no framework imports, no model SDK. The model is an
injected interface, so the whole pipeline runs offline against fixtures with a fake model, and
end to end with the machine's own `codex exec` and no API key.

The story it tells has four stages, always in this order:

```text
user workflows  ->  inferred intent  ->  semantic capability  ->  verified implementation
```

Each stage records its evidence in the decision trail. The console and `npm run compile` render
the same trail.

## 1. User workflows

**In:** one row per session, the shape the PostHog mining query returns:
`{session_id, distinct_id, opened_at, confirmed_at, duration_seconds, step_count, steps}`, where
`steps` is the ordered `[{t, event, props}]` list. PostHog is the evidence source; nothing else in
the compiler knows it exists.

**What happens:** every step is rendered as one line of prose with the delay since the previous
step: `3. selected seat 21B for passenger 1, available, $0 (+8s)`. This is `f_low` in OS-Genesis
terms, done with no model: an analytics event is already a low-level instruction in words. The
event table is `src/contract.ts`, NovaAir's analytics contract as data. A new event is one line.

**Evidence recorded:** the session count, the step count, the events seen.

## 2. Inferred intent

Powered by **OS-Genesis** (arXiv 2412.19723), reverse task synthesis.

**`f_high`.** Eight rendered sessions per call, through `PROMPT_F_HIGH` (`src/prompts/f-high.md`),
give one goal per session: a sentence in the user's terms, a snake_case name, a confidence. Batches
run in order, and each call sees the goal names the earlier calls used, so one goal keeps one name
across the whole set. A session the model leaves out is recorded as `no_coherent_goal`, never
guessed.

**The trajectory reward model.** Eight sessions per call, through `PROMPT_TRM` (`src/prompts/trm.md`),
graded on two axes, 1 to 5, exactly as the paper defines them: completion (did the final states
show the goal reached) and coherence (was the path a logical pursuit of that goal). The prompt shows
the last three states, as the paper's Algorithm 1 does. The two axes are kept separate everywhere:
in the IR, in the trail, and in the `trajectory` table. A session that wandered and then succeeded
scores high on completion and low on coherence, and that combination is the workaround signal the
product looks for. The grader also gives `total`, the paper's single reward, as its own judgement,
not an average.

**Keep, do not discard.** A trajectory with `total >= 2` is kept with its weight, including the
middle. Only `total < 2` is dropped. Exemplars for the naming prompt are drawn by reward-weighted
sampling, `P(g_i) = R_i / sum R_k`, with a fixed seed so the same input gives the same prompt.

**Evidence recorded:** every batch, the inferred intent and how many sessions share it, how many
trajectories were kept and dropped, and the completion and coherence distributions.

## 3. Semantic capability

Powered by **ToolCUA** (arXiv 2605.12481) for the granularity, and **ASIL** (arXiv 2608.26991)
for the shape of the result.

**Successful workflows only.** ToolCUA starts from successful GUI trajectories. So does this stage:
completion at least 3, three steps or more, a coherent goal.

**Bottom-up merging at four levels.** Every trajectory is segmented at each level, and segments
with the same goal, level and shape are one candidate tool:

| Level | Segment | NovaAir example |
|---|---|---|
| 0 | one step | `click_seat`, `scroll_to_row`, `pick_passenger` |
| 1 | adjacent steps of one family | `scan_rows`, `assign_seat` |
| 2 | one window, from the opening step to the committing step | `seat_party_together` |
| 3 | the whole session | `manage_trip` |

**Scoring.** Each candidate gets four numbers, all from the data:

- `support`: the share of successful trajectories it explains.
- `replaces`: the median number of manual steps one call would replace. ToolCUA's length reward,
  offline.
- `grounded`: next-state grounding. Every segment must end in one observed committed state. Merge
  past a commit, or across two, and the claimed effect matches no single observed state. That is
  why `manage_trip` dies.
- `ARG_SLOTS`: argument semantics inferred from the trajectory. A property that varied across
  sessions but kept one type is an argument (`flight_id`, `seat`, `passenger_index`,
  `party_size`). A property that never varied is a constant (`currency`), baked into the
  implementation, not passed to it.

**The pick.** The largest merge that is still grounded, still supported by at least half the
sessions, still has an argument, and still replaces at least three steps. `click_seat` replaces one
step: too small. `manage_trip` is not grounded: too big. `seat_party_together` replaces a median of
14 and ends in the confirmed state every session reached.

**No capability warranted.** ToolCUA rewards abstaining from a tool when a tool would not help.
The compiler does the same. When support is under 0.5, the median steps replaced is under 3, or
fewer than 5 sessions succeeded, the result is `decision: "none"` with one reason per floor
missed. The unrelated fixture sessions (help article views, a single seat change) end here.

**One naming call.** `PROMPT_TOOL_SYNTH` (`src/prompts/tool-synth.md`) receives the winning
candidate with two reward-sampled exemplar segments, the properties that varied and the ones that
never did, and the rejected candidates one level down and one level up, each with its reason. It
returns the name, the signature, the arguments, the actions with their ASIL action type and target,
the proposed UI, and one sentence on why this level and not the rejected ones. The model justifies
a choice the scorer already made; it does not invent the granularity.

**The IR.** Everything else in the specification is read off the data, never asked of the model:
constraints from outcome properties that held in every session and from the refusals the product
recorded, preferences from numeric outcomes the users kept at their minimum, final-state checks
from the committed state, interactive elements from the events that addressed them. Then the IR is
validated against `capability-ir.schema.json` with Ajv in strict mode. An invalid IR is refused
and never returned.

**Evidence recorded:** every candidate with its four scores, the chosen level with the rejected
names below and above it, the naming call's answer, and the validated specification.

## 4. Verified implementation

**In:** the constraints, the preferences, and the facts the trajectories established: the group
sizes seen, the refusal reasons seen, whether a paid option existed.

**What happens:** `src/scenarios.ts` holds one rule per test case. Each rule names the fact it
needs and emits nothing without it, so the count is a property of the evidence. For NovaAir the
rules produce 21 scenarios: the ten the plan lists for the Capability Verifier (a contiguous group,
only aisle-separated seats, no group, a blocked accessibility seat, an exit-row restriction, a seat
taken during checkout, an existing paid seat, a child apart from an adult, a duplicate submission,
insufficient permission) and eleven more (the aisle boundary, paid-row ranking, a party of two, a
party of four, an idempotent re-run, an unknown passenger, a cancelled reservation, a seat map that
changes mid-selection, a partial failure that rolls back, a party already together, a party larger
than a row). Each has `id`, `given`, `when`, `then` and `kind`.

The final-state checks (`success.final_state`) are what ASIL calls the final-state validator: the
implementation is judged on the state it leaves, never on the steps it took.

**Evidence recorded:** the scenario list with kinds, and the closing line: the capability, how many
workflows support it, how many scenarios verify it. Those scenarios are what the Capability
Verifier persona runs against each candidate implementation in its sandbox.

## What each paper contributed

**OS-Genesis: Automating GUI Agent Trajectory Construction via Reverse Task Synthesis**
(Sun et al., arXiv 2412.19723). The paper explores a GUI to manufacture trajectories, then writes
the task afterwards: `f_low` maps a step to an instruction, `f_high` lifts a sequence to the goal it
serves, and a trajectory reward model grades completion and coherence, 1 to 5, as a sampling weight
rather than a cutoff. Lantern has real trajectories, so it keeps only the second half:
`render.ts` is `f_low` without a model, `reverse-task-synthesis.ts` is `f_high` and the reward
model, batched eight per call.

**ToolCUA: Towards Optimal GUI-Tool Path Orchestration for Computer Use Agents**
(Hu et al., arXiv 2605.12481). The paper synthesises tools "at varying levels of specificity, from
single-action wrappers to multi-step composite functions", merges adjacent steps bottom-up, anchors
every merged tool to an observed next state, infers argument semantics from what varied in the
trajectory, and rewards tools that shorten the path while also rewarding abstaining when a tool
would not help. `granularity.ts` does all of that offline: segment, cluster, score, pick, and one
naming call that sees the rejected levels.

**ASIL: Replacing Screenshot-and-Click with Structured State and Semantic Actions**
(Xie and Chen, arXiv 2608.26991). ASIL exposes software to an agent as a structured JSON
observation (metadata, application state, interactive elements with stable ids and typed
attributes, environment, navigation, a summary) and schema-constrained semantic actions
(`action_type`, `target`, `params`), verified by a final-state validator rather than an action
history. Its four principles are completeness, semanticity, stability and composability. The
Capability IR takes its shape from ASIL: `observation` with `inputs`, `app_state` and
`interactive_elements`; `actions` with `kind`, `action_type`, `target` and typed `params`;
`success.final_state` as the validator. ASIL assumes the interface has already been designed.
Lantern discovers it from real usage, which is the gap the compiler fills.

Related work the IR also draws on: **VACP** (Stähle et al., arXiv 2603.29322) for typed
parameters with ranges and enums and the split between what the caller passes and what is read at
call time; **CI4A** (Qiu et al., arXiv 2601.14790) for the structured contract on constraints, and
for naming constraint invisibility, which is why every constraint in the IR carries a `source`.

## The IR, field by field

The schema is `packages/capability/src/capability-ir.schema.json` (`schema_version` "1"). It is
the single source of truth; `src/types.ts` mirrors it and `test/types.test.ts` proves they agree.
`additionalProperties: false` everywhere: adding a field is a deliberate act with a version bump.

| Field | Where it comes from |
|---|---|
| `intent`, `summary` | the naming call |
| `observation.inputs` | the naming call's arguments, typed from the observed values (ASIL app state read from the caller) |
| `observation.app_state` | the properties that varied and were read before the commit, with their observed enums and ranges |
| `observation.interactive_elements` | the elements the events addressed (`seat`, `passenger`): id, typed attributes, the refusals the product recorded on them, the actions that take them |
| `observation.example` | the opening state of the highest-reward exemplar |
| `actions[]` | the naming call, typed by the observed slots; `action_type` and `target` are ASIL's |
| `constraints[]` | outcome booleans true in every session (`same_row`, `contiguous`), refusal reasons (`never_booked`, `never_blocked`, `never_child_in_exit_row`), each with `source: "trajectory"` and an `evidence_ref`; plus the caller's documentation and policy rules |
| `preferences[]` | numeric outcomes users kept at their minimum in at least half the sessions (`minimize_additional_cost`), plus the caller's |
| `success.final_state` | the committed event, one entry per group member, the outcome booleans |
| `success.scenarios` | `scenarios.ts`, from the constraints and the observed facts |
| `proposed_ui` | the naming call |
| `evidence` | the supporting sessions with their two-axis rewards and every step, the session count, the median manual actions, the time window |
| `granularity` | the steps one call replaces, the rejected names below and above, the coverage |
| `provenance` | the compiler version, the model, the time, the opportunity |

`docs/contracts.md` section 6 summarises the IR for the rest of the system.

## The decision trail

`compile()` returns `events: CompilerEvent[]`, each `{stage, title, detail, at}`. `stage` is one of
`workflows`, `intent`, `capability`, `verification`, in that order; `STAGES` carries the title and
the research credit for each. The last event names the decision. The web app writes these as
`trace_event` rows (kind `capability`) so the console's Activity page and `npm run tail` show the
same thing.

## Running it

```bash
npm run compile -- --fixtures                 # the fixtures through the fake model, offline
npm run compile -- --fixtures --unrelated     # only the unrelated sessions: decision none
npm run compile -- --codex                    # the same fixtures through the machine's codex exec
npm run compile -- --codex --model gpt-5.6-sol --concurrency 3 --out /tmp/ir.json
```

`--codex` uses `codex exec --sandbox read-only --skip-git-repo-check --ephemeral --output-schema
<schema> -o <file>` with the prompt on stdin, in an empty working directory per call. It reuses
the CLI's saved sign-in, so it needs no API key. It is a development loop for the prompts, not a
server path; the server supplies its own `ModelClient` from `apps/web/lib/openai.ts`.

The fixtures are `packages/capability/test/fixtures/sessions.json`, generated by
`node scripts/make-fixtures.mjs` in the package with a fixed seed: 63 successful family sessions in
three shapes plus variation, 15 the reward model sets aside, 5 unrelated ones. A test regenerates
them and compares. Their manual seat-map action counts have a median of 14, which is what the
opportunity card shows. A median of whole counts is a whole number or a half; the 14.2 in the
30-days-later card is the seeded outcome figure, labelled as seeded.

```bash
npm test -w @lantern/capability               # 44 tests, all offline
OPENAI_API_KEY=... npm test -w @lantern/capability   # adds one live test through the Responses API
```

The live test defines a minimal client in the test file and runs a slice of the fixtures through
the real prompts. Without the key it is skipped.

In the app, `apps/web/lib/opportunity/compile.ts` calls `compile()` with the model client in
`apps/web/lib/opportunity/model.ts` (`gpt-5.6-luna` for goal inference, `gpt-5.6-sol` for the
reward model and the naming call) over the sessions `apps/web/lib/posthog` mined, writes each event as a `capability`
trace row and stores the IR in `capability_spec`. `docs/opportunities.md` has the whole pipeline.

## Supplying a model

```ts
interface ModelClient {
  readonly name: string;
  structured(prompt: { purpose: "f_high" | "trm" | "tool_synth"; system: string; user: string }, schema: JsonSchema): Promise<unknown>;
}
```

Whatever the client returns is validated against the schema the prompt was given, so a client may
hand back the provider's parsed JSON unchecked. Every output schema has an object root, every
property required and `additionalProperties: false`, which is what strict structured output
expects. The thresholds (`min_reward_total` 2, `min_completion` 3, `min_support` 0.5,
`min_replaces` 3, `min_sessions` 5) are overridable through `context.thresholds`.
