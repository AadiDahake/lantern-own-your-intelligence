# Contracts

The data model, the shared types, the HTTP API and the agent's behaviour. Parts of the system are
built against this file in parallel, so it wins over local preference. Change it in the same commit
as the code that depends on it.

## 1. Data model

Supabase Postgres with the `vector` extension. The full statement list is
`supabase/migrations/0001_init.sql`; it drops each object before creating it, so it is safe to
re-run.

Row level security is enabled on every table with no policies. The application connects only with
the service role, which bypasses RLS. Nothing else is granted access.

```sql
create table project (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid unique references auth.users on delete cascade,  -- the account that owns this workspace
  slug text not null unique,               -- from the company name, suffixed when taken
  name text not null,
  company text,                            -- the company name from the sign-up form
  embed_key text not null unique,          -- public widget key, 'pk_' || 24 hex chars
  site_url text,                           -- where the widget is installed
  repo_full_name text,                     -- 'owner/name', null until one is bound
  repo_default_branch text default 'main',
  settings jsonb not null default '{}',    -- {docsThreshold:0.62, interfaceThreshold:0.5, voice:"marin"}
  onboarded_at timestamptz,                -- when the four onboarding steps first all read done
  created_at timestamptz not null default now()
);

create table document (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  title text not null,
  source_kind text not null,               -- 'upload' | 'url' | 'text'
  source_ref text,                         -- filename or url
  mime text,
  status text not null default 'pending',  -- pending | processing | ready | failed
  page_count int,
  mean_confidence real,                    -- OCR confidence 0..1, null when not OCR'd
  chunk_count int not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create table chunk (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document on delete cascade,
  project_id uuid not null references project on delete cascade,
  ordinal int not null,
  heading text,
  content text not null,
  page int,
  block_type text,
  confidence real,                         -- per-block OCR confidence, null for text sources
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create table conversation (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  page_url text,
  page_title text,
  outcome text,                            -- 'solved' | 'missing_feature' | 'unresolved' (migration 0003)
  summary text,                            -- one sentence, written when the turn finishes
  visitor_id text,                         -- the widget's anonymous browser id (migration 0006)
  created_at timestamptz not null default now()
);

create table message (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversation on delete cascade,
  role text not null,                      -- 'user' | 'assistant'
  content text not null,
  steps jsonb,                             -- Step[] when the answer had guidance
  probes jsonb,                            -- ProbeResult[]
  verdict jsonb,                           -- Verdict
  feature_request jsonb,                   -- FeatureRequest when escalation was offered
  created_at timestamptz not null default now()
);

create table escalation (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  conversation_id uuid references conversation on delete set null,
  message_id uuid references message on delete set null,
  request jsonb not null,                  -- FeatureRequest
  engine text not null,                    -- 'local' | 'forge', see EscalationEngine
  status text not null default 'queued',
  -- queued | filing | inspecting | drafting | pr_open | awaiting_approval
  -- | approved | rejected | merging | deploying | shipped | failed
  issue_url text, issue_number int,
  pr_url text, pr_number int, branch text,
  deployment_url text,
  approval jsonb,                          -- {approved, note, decidedAt}
  approval_claimed_at timestamptz,         -- when the forge runner took the decision, see docs/forge.md
  capability_ir jsonb,                     -- the CapabilityIr a forge run builds; null makes the row unrunnable
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Migration 0012: one escalation is one run of the worker against a request group.
  group_id uuid references feature_request_group on delete set null,
  mode text not null default 'full'        -- 'full' | 'file_only' | 'update'
);

-- One gap in the product, however many conversations reached it (migration 0012). Every drafted
-- request is embedded and matched against these before anything is filed, so the same gap is one
-- issue and at most one pull request, carrying the weight of everyone who ran into it.
create table feature_request_group (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  title text not null,
  description text not null default '',
  area text not null default '',
  embedding vector(1536),                  -- the embedding of "title + description"
  report_count int not null default 1,     -- conversations where the agent found this gap
  user_report_count int not null default 0,-- the subset where the user asked for it outright
  priority text not null default 'low',    -- low | medium | high, recomputed on every join
  status text not null default 'observed', -- observed | filed | drafting | pr_open
                                           -- | awaiting_approval | shipped | rejected
  issue_url text,
  issue_number int,
  pr_url text,
  escalation_id uuid references escalation on delete set null,  -- the run carrying it now
  -- Migration 0018: the run currently filing this group's issue. Claimed with one conditional
  -- update, so two overlapping runs cannot both file, and cleared when the number lands or the
  -- run that held it fails.
  issue_claim uuid references escalation on delete set null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- A person who agreed to one text message when the draft change for a gap opens (migrations 0019
-- and 0020). No row exists without that consent. The number is sealed in the format of
-- `project.github_token` under its own key, and it is set to null after the text is sent. One
-- answer stores one number: `message_id` is unique. See "The text notice".
create table gap_subscriber (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  phone_sealed text,                       -- AES-256-GCM 'iv.ciphertext.tag'; null after the text is sent
  phone_digest text not null,              -- keyed hash of the number: one number is one row for one gap
  consent_at timestamptz not null,         -- when the person agreed to the text
  notified_at timestamptz,                 -- the claim, set before the send; null while a text is owed
  created_at timestamptz not null default now(),
  message_id uuid references message on delete set null,   -- the answer whose card took the number
  unique (group_id, phone_digest)
);
create unique index gap_subscriber_message_idx on gap_subscriber (message_id) where message_id is not null;

-- The newest heartbeats of one project's runners, newest first, with the age of each one on the
-- database's clock (migration 0020). The web app offers the text from this. The title is a
-- constant in the function, so each plan can use the partial index.
create index trace_event_worker_online_idx on trace_event (project_id, id) where title = 'worker online';
create function runner_heartbeats(p_project uuid)
  returns table (engine text, sms boolean, age_seconds double precision);

create table trace_event (
  id bigserial primary key,                -- the SSE event id and cursor
  project_id uuid not null references project on delete cascade,
  conversation_id uuid references conversation on delete cascade,
  escalation_id uuid references escalation on delete cascade,
  source text not null,                    -- 'agent' | 'workflow' | 'forge'
  kind text not null,                      -- 'probe' | 'verdict' | 'decision' | 'model'
                                           -- | 'tool' | 'artifact' | 'pause' | 'status' | 'error'
                                           -- | 'capability' | 'candidate' | 'preview'
  status text not null default 'ok',       -- 'running' | 'ok' | 'failed'
  title text not null,
  detail jsonb,                            -- free-form, rendered per kind, see section 3
  created_at timestamptz not null default now()
);

-- One Codex attempt in one sandbox of a forge run (migration 0014). The handles (devbox id, tunnel
-- key, local path, port) are stored, never a preview URL: a URL is only valid while the box runs
-- and is rebuilt on every read. capability_spec_id has no foreign key until migration 0013's
-- capability_spec table exists; a follow-up adds it.
create table candidate (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  escalation_id uuid not null references escalation on delete cascade,
  capability_spec_id uuid,                 -- null when the run was started from an inline spec
  label text not null,                     -- 'A' | 'B'
  persona text not null default 'capability_builder',  -- the persona at work, or last at work
  strategy text not null default 'runloop',            -- reflex | runloop | local
  devbox_id text, blueprint_name text, tunnel_key text,
  local_path text, preview_port int,
  status text not null default 'queued',   -- queued | provisioning | building | testing | ready | failed | torn_down
  codex_thread_id text, codex_exit_code int,
  branch text,
  scenarios_passed int, scenarios_total int,
  failing_scenarios jsonb,                 -- [scenario id]
  test_report jsonb,                       -- {verifier, runner, problem, test_exit_code}
  changed_files jsonb,                     -- [{path, kind}] from Codex file_change items
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  torn_down_at timestamptz
);

-- What happened to a capability after a person merged it (migration 0014). Future data is seeded
-- and the default source says so.
create table deployment_outcome (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  measured_at timestamptz not null default now(),
  window_days int not null default 30,
  eligible_users int, feature_used int, feature_succeeded int,
  median_actions_before real, median_actions_after real,
  support_change_pct real,
  source text not null default 'seeded',   -- seeded | posthog
  created_at timestamptz not null default now()
);

-- Migration 0014 also adds to escalation:
--   capability_spec_id uuid            -- the compiled specification the run built
--   winning_candidate_id uuid references candidate on delete set null
-- Migration 0017 adds the foreign keys from candidate.capability_spec_id and
-- escalation.capability_spec_id to capability_spec (on delete set null).

-- Behavioural evidence for one opportunity, mined from PostHog (migration 0013). One row per
-- session; unique per group, so a re-run of the miner is idempotent.
create table trajectory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  session_id text not null,                -- PostHog's $session_id
  distinct_id text,
  started_at timestamptz not null, ended_at timestamptz,
  step_count int not null default 0,
  steps jsonb not null,                    -- the ordered [{t, event, props}] list the compiler consumes
  manual_actions int not null default 0,   -- the manual steps a capability call would replace, the compiler's count
  rendered jsonb,                          -- the steps as prose, [{line, seconds}], the compiler's own rendering
  inferred_goal text, goal_name text, goal_confidence real,   -- OS-Genesis reverse task synthesis
  reward_completion real, reward_coherence real,              -- the two reward axes, never averaged
  replay_url text,                         -- the PostHog replay deep link; null when no recording exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, session_id)
);

-- The compiled Capability IR (migration 0013). One row per version; the console reads the latest.
create table capability_spec (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  intent text not null,                    -- snake_case, e.g. seat_party_together
  version int not null default 1,
  spec jsonb not null,                     -- the whole IR, validated against capability-ir.schema.json
  summary text,
  scenario_count int not null default 0,
  session_count int not null default 0,
  median_manual_actions real,              -- the compiler's count: every manual step, scanning included
  median_interactions real,                -- the product's count: seat clicks, refused clicks, passenger picks
  replaces_atomic_steps real,              -- ToolCUA: manual steps one call replaces, by median
  model text,
  created_at timestamptz not null default now(),
  unique (group_id, version)
);

-- One run of the opportunity pipeline against a group (migration 0013): mine, then compile.
-- Enqueued by the request that noticed the gap, executed by the runner or after the response.
create table discovery (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  conversation_id uuid references conversation on delete set null,  -- the chat that triggered it
  trigger text not null default 'auto',    -- auto | user | manual
  status text not null default 'queued',   -- queued | running | done | failed
  stage text,                              -- mining | compiling, while running
  decision text,                           -- capability | none, once done
  reasons jsonb,                           -- why no capability was warranted
  session_count int, median_manual_actions real, median_interactions real,
  capability_spec_id uuid references capability_spec on delete set null,
  error text,
  claimed_by text, claimed_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one run per group is queued or running: a partial unique index on (group_id).
-- claim_discovery(worker text) claims the oldest queued row atomically (for update skip locked).

-- Migration 0013 also adds to trace_event:
--   group_id uuid references feature_request_group on delete set null   -- the opportunity a row belongs to

-- What the agent remembers about one anonymous visitor (migration 0006). Nothing sensitive is
-- stored here: no emails, phone numbers, keys or passwords.
create table visitor_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  visitor_id text not null,                -- random id the widget keeps in localStorage
  fact text not null,                      -- one short third-person sentence
  source_conversation_id uuid references conversation on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, visitor_id, fact)
);

create index on trace_event (project_id, id);
create index on chunk (project_id);

-- The site graph (migration 0015): what Lantern knows about the host product beyond the page in
-- front of the user. A page is a route, a control is identified by what a person sees on it, a
-- transition says which control on which page led where. Filled by the explorer and by the
-- widget's live scans; read by the route planner. See docs/guidance.md.
create table site_page (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  route text not null,                     -- normalised path, identifiers replaced by :id
  url text not null,                       -- one concrete address the route was seen at
  title text not null default '',
  source text not null default 'widget',   -- 'explorer' | 'widget'
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (project_id, route)
);

create table affordance (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  page_id uuid not null references site_page on delete cascade,
  key text not null,                       -- role|name|landmark|href, see controlKey
  role text not null,
  name text not null,
  landmark text,
  href text,                               -- route the link points at
  visible boolean not null default true,   -- on screen when the page was read, before any click
  seen_count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (page_id, key)
);

create table transition (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  from_page_id uuid not null references site_page on delete cascade,
  affordance_id uuid not null references affordance on delete cascade,
  to_page_id uuid not null references site_page on delete cascade,
  kind text not null default 'navigation', -- 'navigation' | 'reveal'
  reveals_affordance_id uuid references affordance on delete cascade,
  source text not null default 'widget',
  seen_count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- One exploration of a site (migration 0016). The console queues it; a process with a browser
-- claims it through claim_site_explore_job(), which takes the oldest queued row for one runner.
create table site_explore_job (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  site_url text not null,
  status text not null default 'queued',   -- queued | running | done | failed
  summary jsonb,                           -- ExploreSummary when done
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- A question that resolved to a control, so the same question answers with no model call.
create table known_route (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  intent text not null,                    -- the question's concepts, sorted and joined
  feature text not null,
  question text not null,                  -- the wording that first resolved it
  target_affordance_id uuid not null references affordance on delete cascade,
  answer text not null,
  sources jsonb,                           -- [{title, url}]
  embedding vector(1536),                  -- of the question, for a near match on new wording
  hit_count int not null default 0,
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now(),
  unique (project_id, intent)
);
```

Graph functions, all in migration 0015: `upsert_site_scan(project, route, url, title, source,
controls jsonb)` writes one page and its controls in one round trip; `upsert_transition(project,
from_route, key, to_route, kind, reveals_key, source)` writes one edge; `site_graph(project)`
returns the whole graph as one JSON document `{pages, controls, transitions}`;
`match_known_routes(embedding, count, project)` finds known routes by wording;
`match_chunks_with_source` is `match_chunks` with the document title and address, so the
documentation check can cite the article.

Vector search:

```sql
create or replace function match_chunks(
  query_embedding vector(1536), match_count int, filter_project uuid
)
returns table (
  id uuid, document_id uuid, heading text, content text,
  page int, confidence real, similarity float
)
language sql stable as $$
  select c.id, c.document_id, c.heading, c.content, c.page, c.confidence,
         1 - (c.embedding <=> query_embedding) as similarity
  from chunk c
  where c.project_id = filter_project
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$$;

create or replace function match_request_groups(
  query_embedding vector(1536), match_count int, filter_project uuid
)
returns table (
  id uuid, title text, description text, area text,
  report_count int, user_report_count int, priority text, status text,
  issue_url text, issue_number int, pr_url text, escalation_id uuid, similarity float
)
language sql stable as $$
  select g.id, g.title, g.description, g.area, g.report_count, g.user_report_count,
         g.priority, g.status, g.issue_url, g.issue_number, g.pr_url, g.escalation_id,
         1 - (g.embedding <=> query_embedding) as similarity
  from feature_request_group g
  where g.project_id = filter_project and g.embedding is not null
  order by g.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;
```

**Seed** (`scripts/seed.mjs`, idempotent): the demo project, slug from `LANTERN_PROJECT_SLUG`
(default `novaair`), name "NovaAir", a generated `embed_key`, `site_url` from `LANTERN_SITE_URL`
and `repo_full_name` from `LANTERN_REPO` (both null when unset, so the console asks for them),
handed to the account named by `LANTERN_DEMO_OWNER_EMAIL` through the auth admin API. Every other
project is created by sign-up.

## 2. Shared types

Exported from `@lantern/shared`. Do not redeclare them locally.

```ts
export type Affordance = {
  id: string;            // opaque, e.g. "a7"; the only handle the model gets
  role: string;          // button | link | textbox | checkbox | tab | menuitem | switch | combobox
  name: string;          // accessible name
  text?: string;         // visible text when different from name
  landmark?: string;     // nearest landmark or labelled region: "sidebar", "header", "main", "dialog"
  href?: string;         // for links
  visible: boolean;      // in viewport and hit-testable
  disabled?: boolean;
};
export type PageContext = {
  url: string;
  title: string;
  affordances: Affordance[];
  text?: string;         // the page's visible text, collapsed, at most 2000 characters
};

// What kind of message the visitor sent, decided before any check runs. `mixed` is also what an
// unsure classification falls back to, because the product path checks its evidence.
export type MessageIntent = "chat" | "page" | "product" | "mixed";

// One instruction in a walk. `target` is the live affordance id on the page the widget scanned;
// it is null for a step on a later page, which the widget binds by `control` when it gets there.
export type Step = {
  target: string | null;
  caption: string;
  advanceOn: "click" | "input" | "navigation" | "manual";
  control?: { role: string; name: string; landmark?: string; href?: string; route: string };
};

// The site graph as the planner reads it. A control's identity is role, accessible name, landmark
// and link target, never a selector.
export type SitePage = { route: string; url: string; title: string };
export type SiteControl = { key: string; route: string; role: string; name: string; landmark?: string; href?: string; visible: boolean };
export type SiteTransition = { from: string; key: string; to: string; kind: "navigation" | "reveal"; reveals?: string };
export type SiteGraph = { pages: SitePage[]; controls: SiteControl[]; transitions: SiteTransition[] };

// How a step plan was made, and how many steps it has, fixed for the whole walk.
export type PlanSource = "graph" | "cached" | "page" | "memory";
export type PlanSummary = { source: PlanSource; total: number; destination?: { route: string; title: string } };
export type AnswerSource = { title: string; url: string | null };

export type ProbeName = "docs" | "interface" | "repository";
export type ProbeResult = {
  probe: ProbeName;
  hit: boolean;
  score: number | null;
  summary: string;
  evidence: unknown;
  latencyMs: number;
};

export type VerdictOutcome = "answer" | "hedge" | "absent";
export type Verdict = {
  outcome: VerdictOutcome;
  confidence: number;
  reasoning: string;
  feature: string;
};

export type FeatureRequest = {
  title: string;
  description: string;
  area: string;
  quote: string;
  rationale: string;
};

// One gap in the product, and everyone who ran into it. See "Grouping and automatic reporting".
export type RequestPriority = "low" | "medium" | "high";
export type RequestGroupStatus =
  | "observed" | "filed" | "drafting" | "pr_open" | "awaiting_approval" | "shipped" | "rejected";
export type RequestGroup = {
  id: string;
  title: string;
  description: string;
  area: string;
  reportCount: number;
  userReportCount: number;
  priority: RequestPriority;
  status: RequestGroupStatus;
  issueUrl: string | null;
  issueNumber: number | null;
  prUrl: string | null;
  escalationId: string | null;   // the run currently carrying this group forward
  firstSeen: string;
  lastSeen: string;
};

// /api/chat SSE events, in order of emission
export type ChatEvent =
  | { type: "conversation"; conversationId: string; messageId: string }
  | { type: "understanding"; feature: string; intent: MessageIntent; memory: string[] }  // feature is empty for chat and page
  | { type: "probe"; probe: ProbeName; status: "running" }
  | { type: "probe"; probe: ProbeName; status: "done"; result: ProbeResult }
  | { type: "verdict"; verdict: Verdict }
  | {
      type: "answer";
      text: string;
      steps: Step[] | null;
      escalation: EscalationOffer;   // { offered: true, request, textNotice?: true } | { offered: false, reason? }
      noted?: boolean;               // the gap was recorded for the developers without being asked
      plan?: PlanSummary;            // where the steps came from and the count, fixed for the walk
      sources?: AnswerSource[];      // the help articles the answer cites
      routeChanged?: boolean;        // a continuation changed the route, so the count changed
    }
  | { type: "error"; message: string };

// One run of the worker. `filed` ends an issue-only run; `updated` ends a run that only carried a
// new count and quote to an issue and pull request that already exist.
export type EscalationStatus =
  | "queued" | "filing" | "filed" | "inspecting" | "drafting" | "pr_open" | "awaiting_approval"
  | "approved" | "rejected" | "merging" | "deploying" | "shipped" | "updated" | "failed";

// What builds the change. `local` is the worker's own runner; `forge` is the sandbox engine in
// apps/web/lib/forge (see docs/forge.md).
export type EscalationEngine = "local" | "forge";

export type TraceEvent = {
  id: number;
  projectId: string;
  conversationId: string | null;
  escalationId: string | null;
  groupId: string | null;                   // the opportunity the row belongs to, when known
  source: "agent" | "workflow" | "forge";   // forge is the sandbox engine's lane
  kind:
    | "probe" | "verdict" | "decision" | "model" | "tool" | "artifact" | "pause" | "status" | "error"
    | "capability"   // a capability the compiler discovered; detail carries the granularity decision
    | "candidate"    // one candidate implementation in one sandbox, or its test result
    | "preview";     // a live sandbox preview; detail carries the URL and the candidate
  status: "running" | "ok" | "failed";
  title: string;
  detail: unknown;
  createdAt: string;
};
```

Also exported, for the opportunity pipeline (`packages/shared/src/opportunity.ts`):

```ts
export type DiscoveryStatus = "queued" | "running" | "done" | "failed";
export type DiscoveryTrigger = "auto" | "user" | "manual";
export type Discovery = {
  id; groupId; conversationId; trigger; status; stage: "mining" | "compiling" | null;
  decision: "capability" | "none" | null; reasons: string[];
  sessionCount; medianManualActions; medianInteractions; capabilitySpecId; error;
  createdAt; updatedAt; finishedAt;
};
// Derived from the rows, never stored, in story order.
export type OpportunityStatus =
  | "discovering" | "not_warranted" | "failed" | "discovered"
  | "building" | "verified" | "pr_open" | "merged" | "measured";
export type OpportunitySummary = {
  groupId; title; intent; status; sessionCount; medianManualActions; medianInteractions;
  scenarioCount; specVersion; reportCount; prUrl; escalationId; updatedAt;
};
export type DeploymentOutcome = {
  id; measuredAt; windowDays; eligibleUsers; featureUsed; featureSucceeded;
  medianActionsBefore; medianActionsAfter; supportChangePct; source: "seeded" | "posthog";
};
```

Also exported:

- `validatePlan(steps, affordances, maxSteps?)` rejects the whole plan if any live `target` is not
  an affordance id, if a later-page step (`target: null`) does not name its `control`, if the first
  step has no live id, or if any caption exceeds 14 words. Returns `Step[] | null`.
- `routeProbes(results, thresholds)` returns `"answer" | "hedge" | "absent"`. A `repository` hit
  whose `score` reaches `interfaceThreshold` is a control found on the site and routes to `answer`.
- `routeOf(url)`, `hrefRoute(href, pageUrl)`, `controlKey(ref)`, `controlRefOf(affordance, pageUrl)`,
  `sameControl(a, b)`, `captionFor(ref)`: the identity of a page and of a control, shared by the
  explorer, the widget and the planner.
- `planRoute(graph, current, target, captions?)`: the shortest path over the graph from the current
  page to a control, with reveal steps where the page as scanned hides a control behind a tab or a
  menu. `searchControls(graph, feature)`, `validateRoute(steps, graph)`, `graphSize(graph)`.
- `tokenize(text)` and the keyword helpers used by both the interface probe and the widget's
  affordance ranking, so page-side ranking and server-side scoring always agree.
- `MODELS` and `EFFORT`, the model ids and reasoning efforts in section 5, and
  `EMBED_DIMENSIONS` and `DEFAULT_VOICE` beside them.

## 3. HTTP API

Routes live in `apps/web/app/api`. Widget-facing routes take the public embed key as `key`, send
`Access-Control-Allow-Origin: *`, and answer `OPTIONS` preflight; they run on a customer's site and
have no session.

Console routes resolve the caller through `apps/web/lib/console/current.ts`, which reads the session
cookie, returns the project that account owns (creating one if it has none), and answers `401
{error}` when there is no session. Every query in a console route is scoped to that project id, so
one account can never read another's sources, conversations, escalations or trace.

A terminal client (`npm run tail`) has no cookie. When `LANTERN_CONSOLE_TOKEN` is set, a request
with `Authorization: Bearer <token>` resolves to the project whose slug is
`LANTERN_CONSOLE_PROJECT` (default `novaair`). Off unless the token is set; a session always wins.

| Route | Body / query | Returns |
|---|---|---|
| `POST /api/chat` | `{key, conversationId?, visitorId?, question, page: PageContext, continueFrom?}` | SSE of `ChatEvent`; each `data:` line is one JSON event, `event:` is its type. With `continueFrom`, one `answer` event with the remaining steps from the current page and `routeChanged` |
| `POST /api/guide/outcome` | `{key, outcome: "completed", question, feature, answer, steps: Step[], conversationId, messageId}` | `{ok: true, remembered, steps?, walks?, memorable?, reason?}`; the widget sends it when a walk reaches its last step. A completed walk whose every step carries `control` is remembered by `apps/web/lib/routes/provider.ts`: extracted by Memorable's `POST /v1/extract` when `MEMORABLE_API_KEY` is set, and kept in Lantern's own store. Any other outcome changes nothing |
| `POST /api/site/observe` | `{key, page: PageContext, transition?: {fromUrl, fromTitle, control: {role, name, landmark?, href?}}}` | `{ok: true}`; records the page in the site graph and the move the user made to reach it |
| `POST /api/site/explore` | - (console) | 202 `{job: ExploreJob}`; queues an exploration of `project.site_url` (or returns the one already queued or running), 400 without a site address. A browser cannot run in the function, so a process on a machine that has one carries the job: the forge runner or `npm run explore -- --drain` |
| `GET /api/site/explore` | - (console) | `{job: ExploreJob \| null}`: the newest job, `{id, siteUrl, status: queued \| running \| done \| failed, summary, error, createdAt, startedAt, finishedAt}`; the console polls it |
| `GET /api/site/map` | - (console) | `{graph, routes, siteUrl}`: the site graph with last-seen times and the known routes |
| `POST /api/documents/import-help` | - (console) | `{documents: Document[], pages}`; imports the help pages the graph knows (or a sitemap) as one document per article |
| `POST /api/escalate` | `{key, conversationId, messageId, visitorId?, notify?: {phone, consent: true}}` | `{escalationId, groupId, status, notify?: "subscribed" \| "not_needed" \| "unavailable"}`; `notify` is in the answer only when it was in the request. 409 `{error, reason: "no_repository"}` when the project has no repository bound. 400 `{error, reason: "consent_required" \| "invalid_phone"}` for a `notify` with no `consent: true` or with a number that has no country code; nothing is written. See "The text notice" |
| `GET /api/escalations/:id` | `?key=` required, must be the escalation's project | `{id, status, issueUrl, prUrl, deploymentUrl, request, approval, createdAt}` |
| `POST /api/transcribe` | multipart `key`, `file` (audio/webm or mp3) | `{text}` |
| `POST /api/speak` | `{key, text}` | `audio/mpeg` bytes, streamed as the TTS deltas arrive |
| `GET /api/project` | - | `{project, embedSnippet, widgetUrl}` |
| `PATCH /api/project` | `{repoFullName?, siteUrl?, settings?}` | validates the repository through GitHub, returns the project; `repoFullName: null` unbinds it |
| `GET /api/documents` | - | `{documents: Document[]}` |
| `POST /api/documents` | multipart `file` (pdf, png, jpg, md, txt, html), or JSON `{url}`, or JSON `{title, text}` | ingests synchronously, returns the document row |
| `DELETE /api/documents/:id` | - | `{ok: true}` |
| `GET /api/conversations` | `?limit=`, `?outcome=` (`solved`, `missing_feature`, `unresolved`) | `{conversations: ConversationSummary[], counts}`, newest first |
| `GET /api/conversations/:id` | - | `{conversation}`: every message in order with its steps, probes, verdict and feature request, the escalation, and `memory: string[]`, the facts the agent keeps about that visitor |
| `GET /api/escalations` | - | `{escalations: Escalation[]}`, newest first |
| `GET /api/requests` | - | `{requests: RequestGroup[]}`, heaviest first: priority, then last reported |
| `POST /api/escalations/:id/approve` | `{approved: boolean, note?: string}` | `202 {ok: true, status}`; the row is the queue. Under `local` the worker's runner marks the pull request ready, merges it and watches the Vercel deployment of the merge commit; under `forge` the forge runner does the same and tears the winner's sandbox down |
| `POST /api/opportunities/:groupId/forge` | `{spec?: CapabilityIr}`; without `spec` the group's latest `capability_spec` row is used | `202 {escalationId, status: "queued"}`; `409 {error, reason: "no_capability_spec" \| "no_github_token"}`; `503 {error, reason: "engine_unavailable"}` when the selected strategy has no keys; `400 {error, reason: "invalid_spec"}` |
| `GET /api/forge/:escalationId` | - | `{escalation: {id, engine, status, prUrl, prNumber, branch, deploymentUrl, winningCandidateId, capabilitySpecId, approval, error, createdAt, updatedAt}, candidates: Candidate[]}` (the `candidate` row, camel-cased) |
| `GET /api/forge/:escalationId/preview` | - | `{url: string \| null, candidate: "A" \| "B" \| null}`; the URL is rebuilt from the winner's handle and health-checked on every read, `null` once the sandbox is gone |
| `GET /api/opportunities` | - | `{opportunities: OpportunitySummary[]}`, newest activity first: every group with a discovery, a specification or a forge run |
| `GET /api/opportunities/:groupId` | - | `{opportunity}`: the group, its status, the latest discovery, the latest specification with its IR, the evidence (counts, three representative sessions rendered as steps with replay links), the inferred intent with its reward distributions, the forge run with its candidates, and the latest outcome |
| `POST /api/opportunities/:groupId/discover` | - | `202 {discoveryId, status, created}`; enqueues a run of the pipeline and answers at once. `created: false` when one was already queued or running. `503 {error, reason: "posthog_unavailable"}` without the PostHog variables |
| `POST /api/opportunities/:groupId/measure` | - | `{outcome: DeploymentOutcome}` from the outcome query; `409 {reason: "no_capability_spec" \| "no_outcome_events"}` |
| `GET /api/trace/stream` | `?since=&conversationId=&escalationId=&groupId=` | SSE; `id:` is the `trace_event.id`, `event: trace`, `data: TraceEvent` |
| `GET /api/trace` | same filters, `?since=&limit=` | `{events: TraceEvent[]}` backfill |
| `POST /api/auth/signup` | `{email, password, company}` | creates the account already confirmed through the Supabase admin API; the browser then signs in with the password |
| `GET /api/github/connect` | - | redirects to GitHub's authorize page with `scope=repo` and a signed state cookie |
| `GET /api/github/callback` | `?code=&state=` | stores `github_login`, `github_avatar` and the encrypted token on the project, then redirects to `/console/repository` |
| `POST /api/github/disconnect` | - | `{ok:true}`, clears the linked account |
| `GET /api/health` | - | `{ok, db, openai}` |

`POST /api/escalate` answers `503 {error, reason: "engine_unavailable"}` and writes nothing when
`ESCALATION_ENGINE` names an engine that cannot run: `forge` without the keys of its selected
strategy. Under a runnable `forge` the row is inserted `queued` and adopted by the next
`POST /api/opportunities/:groupId/forge` for its group.

`POST /api/escalations/:id/approve` writes `approval` on the row and sets the status to `approved`
or `rejected`. The run is polling that column, so that is the whole channel. Neither engine carries
the decision out inside the request: the `local` worker polls it, and for `forge` the runner does
(`npm run forge:runner`, "Where a run actually runs" in `docs/forge.md`). Both forge routes stay
well inside the 300 s a serverless function is allowed.

`GET /api/trace/stream` polls Postgres every 700 ms, honours `Last-Event-ID`, sends a `: ping`
comment every 15 s, and closes cleanly after 240 s so `EventSource` reconnects.

### Trace detail shapes

The console renders these specially and falls back to a key/value list for anything else.

| kind | `detail` |
|---|---|
| `probe` | `ProbeResult` |
| `verdict` | `Verdict` |
| `artifact` | discriminated by `detail.artifact`: `"issue_draft"` -> `{title, body}`; `"issue"` -> `{url, number}`; `"pr"` -> `{url, number, branch}`; `"diff"` -> `{files: [{path, patch}]}` with unified diff text per file; `"deployment"` -> `{url}` |
| `model` | `{model, purpose, input_summary?, output_summary?, files?: [{path, reason}]}` |
| `pause` | `{label, taskId?}` |
| `tool` | `{tool, transport: "mcp" \| "rest" \| "git" \| "shell", args_summary, result_summary}` |
| `candidate` | `{candidate: "A" \| "B", strategy}` while provisioning and building; `{candidate, scenarios_passed, scenarios_total, failing: [scenario id], runner: {passed, failed, total, success} \| null, files_changed}` when scored |
| `preview` | `{url, candidate, port, sandbox}` |
| `capability` | one `CompilerEvent` from `@lantern/capability`: `{stage, title, detail, at}`; the `Chosen:` event's detail carries `rejected_too_low`, `rejected_too_high` and `coverage` |
| `artifact` (pipeline) | `"capability_spec"` -> `{id, version, intent, summary, session_count, median_manual_actions, median_interactions, scenarios, constraints, actions, opportunity_id}`; `"replays"` -> `{linked, checked, failed}`; `"outcome"` -> `{source, intent, eligible, used, succeeded, median_actions_before, median_actions_after, support_before, support_after, support_change_pct}` |
| `tool` (pipeline) | `{tool: "hogql", transport: "rest", args_summary, result_summary, sessions, matching_sessions, median_manual_actions, median_interactions, window_days, queries: [{name, rows, durationMs, cached}]}` |
| `status` (text notice) | `{notice: "draft_sms", state: "off" \| "failed" \| "done", reason?, asked?, sent?, unconfirmed?, taken?, reasons?: string[]}`; `taken` counts the people a different run claimed at the same moment, and `reasons` are short codes (`rate_limited`, `http_400`, `timeout`, `unreachable`, `pass_limit`). Never a phone number and never the provider's own words |
| `decision` (text offer) | `{notice: "draft_sms", offer: "on" \| "off", reason?}`, titled "Text notice: offered with the report" or "Text notice: not offered". One row for each answer that offers a report. Its kind is not `status`, because the console reads the newest `status` row as the worker's heartbeat |
| `decision` "The user asked for this to be reported" | the feature request, `groupId`, the counts and the priority, and `textNotice: {state, reason?}` when the report asked for the text. Never a phone number |
| `status` "worker online" | `{engine: "local" \| "forge", at, sms}`: a runner's heartbeat, one row for each project every 60 seconds. The worker writes it for `local` and the forge runner writes it for `forge`. `sms` is true when that runner has both text message variables, and the web app offers the text only from these rows |

Forge rows carry `source: "forge"`; the persona's `tool`, `artifact` and `model` rows are titled
`<Persona> (<candidate>): ...`, and a `file_change` artifact is `{artifact: "file_change", files: [{path, kind}]}`.

The opportunity pipeline's rows (`docs/opportunities.md`) also carry `source: "forge"` and the
group id. Two rows land on the conversation that triggered the run with `source: "agent"`: the
`status` "Checking whether other customers hit this" when the run is enqueued, and the `decision`
"63 similar sessions worked around this by hand" (or its negative) when it finishes.

## 4. Agent behaviour

`apps/web/lib/agent`. One chat turn:

1. Insert the conversation if it is new, insert the user message, emit `conversation`.
2. **Record and recall.** The page the question was asked on is written into the site graph
   (`recordScan`), so a route can start from it - but only when its origin is the origin of the
   project's `site_url` (`apps/web/lib/graph/origin.ts`). A page from anywhere else, a preview
   deployment of an unmerged branch above all, still answers the question from its live controls
   and writes nothing: no page, no affordance, no transition and no `known_route`. A project with
   no `site_url` has not said where it lives, so every scan is taken. `POST /api/site/observe`
   applies the same rule. What the visitor is told is decided separately: `mapWithCurrentPage`
   (`apps/web/lib/graph/live.ts`) merges this page's controls into the map the turn plans over, in
   memory and for this turn only, so a control on the screen is always a control the answer may
   point at whatever the origin, the cache or the scan did. The question's intent key (its concepts, sorted) is looked up in
   `known_route`; a miss is retried by the question's embedding at cosine 0.92 or above once it is
   in flight. The question's embedding, the site graph and the read below all start here, together.
3. **Read the message** with `MODELS.understand` and a JSON schema (`agent/understand.ts`):
   `{intent, feature}`. `intent` is the `MessageIntent` the rest of the turn is routed on, and
   `feature` names the capability in the user's own terms ("changing a seat", "finding seats
   together"), empty for `chat` and `page`. Anything else the model returns lands on `mixed`.
   Load what the agent remembers about this `visitorId` (at most 20 facts, oldest first) and emit
   `understanding` with the class, the capability and the facts as `memory`. Write a `model` trace
   row titled `Read the message: <intent>`.

   | intent | what it is | what the turn does |
   |---|---|---|
   | `chat` | a greeting, thanks, small talk, a question about the assistant, or general knowledge that is not about this product | one `MODELS.understand` call over the page context answers it in one or two sentences (`agent/direct.ts`). No probe, no verdict, no request, no offer. `model` trace row with `purpose: "chat"`. |
   | `page` | a question the page in front of the visitor already answers | the same, over the page's own text and its visible affordances only. Nothing outside the page is cited. When the page does not say, the answer says so and invites the question the product path answers. `purpose: "page"`. |
   | `product` | what the product can do, or where one of its controls is | the whole path below: known route, three probes, verdict, guidance or absence, report offer. |
   | `mixed` | part general, part product, or unsure | the same as `product`, and when the verdict is `absent` and the documentation returned a passage scoring at least `DOCS_SURE_MISS`, that passage answers the general half first ("... There is still no way of X here today."). |

   A `chat` or `page` turn stores its assistant message with `probes: []` and `verdict: null`,
   writes the conversation's outcome and one-sentence summary itself (`solved` when it answered,
   `unresolved` when the page did not), and still keeps whatever the visitor said about themselves.
4. **A remembered route** comes first when route memory is on (`MEMORABLE_API_KEY`, or
   `LANTERN_ROUTE_MEMORY=local`): a question with the intent key of a walk a person completed is
   planned from the current page to the control that walk ended on, over the graph, and answered
   with `plan.source: "memory"`, before the message is read and with no model call. The `decision`
   row is titled "Remembered route: N steps, confirmed by M walks". A miss, or a target the graph
   cannot reach from this page, falls through to the known route.

   **A known route** (`product` and `mixed` only): a hit plans the route from the current page
   over the graph, emits `answer` with `plan.source: "cached"` and returns, with no search and no
   further model call. No model output reaches the user: the answer, the route and the count are
   all read off the graph, and the reading of step 3, started beside the lookups for the sake of
   the questions that miss, is never awaited.
5. **Three probes in parallel.** Each emits `probe running`, then `probe done`, and writes a
   `trace_event` with source `agent` and kind `probe`.
   - **docs**: embed the question, call `match_chunks_with_source` for the top 6, and rank them by
     `similarity * (0.6 + 0.4 * overlap)`, where overlap is the share of the question's concepts
     the passage uses, multiplied by `0.6 + 0.4 * confidence` when the chunk carries an OCR
     confidence. A score at or above `settings.docsThreshold` (default 0.62) is a hit; below 0.40
     a miss; in between the best passage is read by `MODELS.understand`, which answers whether the
     product does what was asked or the passage describes a manual workaround. Evidence is
     `[{documentTitle, url, heading, snippet, similarity}]`. Both lines are tuned on the offline
     set in `scripts/eval-docs.ts`.
     When a company brain is configured (`GBRAIN_MCP_URL` and `GBRAIN_TOKEN`,
     `integrations/gbrain/README.md`), `searchBrain` in `apps/web/lib/brain/provider.ts` is asked
     first, for pages under `help/` only and with a limit of 1,500 ms. Its passages are scored by
     the same rule on the cosine the brain reports, and a passage matched on meaning alone
     (`weak_semantic`) is always read before it counts. The brain can only find the capability:
     a brain that is off, late or empty, and a passage that does not cover the question, all
     hand the question to the search above, so an absence never rests on the brain alone.
   - **interface**: pure local matching, no model call. Token overlap between the keywords plus the
     feature and each affordance's name, text, landmark and href, with simple stemming and a small
     synonym list (theme/dark/light/appearance, username/display name/name/profile/account). Score
     0..1 is the best match; a hit needs `coversCapability` (below), never the raw threshold alone.
     A long label is damped so it cannot win on one shared word, but a name that covers the
     capability keeps its full coverage as its score however many other words it carries, so "Find
     three seats together" scores what "Find seats together" scores. Evidence is the top 5
     affordance ids with their names and scores.
   - **repository**, labelled "Known product capabilities": the site graph first, then the
     repository. `searchControls` over every control the graph knows; a hit when a control's own
     accessible name covers the capability, and then `score` is that control's coverage, so
     `routeProbes` can answer. When no control covers it, `score` is `null` even if the search
     ranked something highly, because a rank is not a control to walk to: the page title a control
     sits on lifts its rank and covers nothing. Then GitHub REST with the project's token:
     `GET /repos/{repo}/git/trees/{branch}?recursive=1` cached 60 s, filtered to source files, and
     kept only when the path covers the capability by the same rule. Evidence is
     `{graph: {pages, controls, matches}, repository: {connected, files}}`, and the summary always
     says how many pages and controls were searched, so an absence is grounded in the product and
     not only in the current page.

   **`coversCapability`** (`@lantern/shared`) is the one rule all three of these share. A label
   covers a capability when it carries every concept of a one or two concept capability, or all
   but one of a longer one. The concept that may differ is the verb the question happened to use,
   so the button "Find seats together" is the control for "getting seats together"; one shared
   word is never enough, so no seat button is. Only a control's own accessible name is read, never
   the title of the page it sits on.
6. **Route** with `routeProbes`. A documentation or interface hit gives `answer`; so does a control
   found on the site. Code alone gives `hedge`. Nothing at all asks `MODELS.verdict` to confirm
   absence from the three summaries, returning `{exists, confidence, reasoning}`: `exists: false`
   gives `absent`, otherwise `hedge`. Emit `verdict` and write the trace event.
7. **Answer.**
   - `answer` with a graph: `candidatesFor` gathers the controls a route may be planned to, one per
     identity and one per capability, and computes the route to each with `planRoute` first. There
     are two ways to be one, and no third: the control's own name covers the capability, or a
     documentation passage names it while the documentation check says that passage covers the
     question. Where the same control sits on many pages, the copy kept is the one the user can
     actually be walked to. `MODELS.plan` then chooses the target, writes one or two sentences that
     hold from any page and name the article used, and writes one caption per step of the chosen
     route (`{target, answer, captions}`); it never counts steps. The route is bound to the live
     page with `bindFirstStep` (the planner's control, else a visible twin of it, else the control
     off screen) and checked with `validatePlan(steps, affordances, 8)`; captions that fail are
     replaced by ones written from the control's role and name. The answer carries
     `plan: {source: "graph", total}` and `sources`, and the target is saved as a known route. When
     the model names no target and a control the visitor can see covers the capability, that
     control is the target anyway: it is on the screen and pressing it is the whole route. When it
     names no target and the documentation hit, the answer is the prose with no steps.
   - `answer` without a graph route, and only when the documentation check or the interface check
     is what found the capability and no control the visitor can see does what was asked:
     `MODELS.plan` with `{answer, steps: [{target, caption, advanceOn}]}` over the documentation
     evidence and the current page's affordance list, at most 5 steps, captions at most 12 words,
     `validatePlan`; `plan.source: "page"`. The walk is kept only when its last step lands on a
     control that passes one of the two doors above (`planEndsOnCapability`); otherwise the prose
     is kept and the steps are dropped, because a walk that ends on a control that does something
     else is not guidance. When neither check found it and no candidate control does what was
     asked, nothing is planned over the page and nothing is claimed from it: the turn says so and
     drafts the request, so the answer carries the report offer rather than a walk through controls
     that do something else.
   - `hedge`: the same model, an honest answer that the feature could not be confirmed, no steps,
     escalation offered with a drafted request.
   - `absent`: an apology, a plain statement, and an offer, for example "Dark mode is not available
     here today. I can report this to the developers so they can build it. Want me to?"
     Draft the `FeatureRequest` with `MODELS.answer` and a JSON schema: an imperative title of at
     most 8 words, a description of two or three sentences, an area, `quote` set to the user's exact
     words (verified to be a substring of the user message, otherwise empty), and a rationale.

   Persist the assistant message with its steps, probes, verdict and feature request. Emit `answer`.
8. Every stage writes `trace_event` rows, which is what makes the console's Activity page show the
   chat-side reasoning live. The planner writes `decision` rows: "Known route", "Planned the
   route", "Re-planned the route over the product map", and "The route could not start from this
   page" with the reason and the scanned controls.
9. Close the conversation out for the console: `outcome` is `solved` when the answer carried
   guidance steps, `missing_feature` when the verdict was `absent`, and `unresolved` otherwise;
   `summary` is one sentence written with `MODELS.understand`. Both are best-effort and never
   fail the turn. A known route and a turn that ran no check set them without a model.

### Continuing a walk

`POST /api/chat` with `continueFrom` and `conversationId` is what the widget sends when the
control it expected is not on the page after a re-scan. `continueGuidance` records the page,
reads the last answer's target (the `control` of its last step) and recomputes the route over the
graph from the page as it is now, with no model. Only when the graph has no route from this page
does a model read the page. When `RIVER_API_KEY` is set, the trained River guide
(`apps/web/lib/guide/provider.ts`) gets the goal, the names already walked and the visible controls,
and has 8 seconds to name the next control; a control it names that the widget sent becomes the one
step left. Otherwise, or when it names nothing on the page, fails or times out, one `MODELS.plan`
call names the steps that are left. One trace event says which of the two chose, and why River did
not. The answer carries
`routeChanged: true` whenever the remaining steps differ from the ones the user was told.

The console links back to the customer's site with `?lantern_ask=<question>`; the widget reads that
parameter on load, opens, and asks the question once.

### Grouping and automatic reporting

Nothing is filed for one conversation, and nothing is drafted for a message that was not about the
product: a `chat` or `page` turn never reaches this path. Every drafted `FeatureRequest`, whether
the user asked for it to be reported or not, goes through `apps/web/lib/agent/requests.ts` first:

1. Embed `"title + description"` with `MODELS.embed` and call `match_request_groups`. A nearest
   group at cosine `>= 0.86` (`REQUEST_MATCH_THRESHOLD`) is the same gap, so the request joins it;
   anything else starts a new group with `status = 'observed'` and `priority = 'low'`.
2. A join from the agent raises `report_count`; a join from the user raises `user_report_count`
   only, because the agent already counted that conversation the moment it drafted the request.
   `priorityFor` then recomputes the group: `high` at two user reports or five detections, `medium`
   at one user report or three detections, `low` otherwise.
3. `actionFor` decides what the worker does about it, and `apps/web/lib/agent/runner.ts` inserts one
   `escalation` row for that run and starts it. **Only a user's report reaches step 3.** The
   agent's own note (`noteRequest`) stops after step 2: the group and its counts are what the
   opportunity dashboard reads, and nothing is filed in the customer's repository for a question
   nobody asked to have reported. `noted: true` on the answer means exactly that, and no more.

| Group | Run `mode` | What happens |
|---|---|---|
| new | `file_only` | files the issue, labels `lantern` and its priority, and stops. No pull request is drafted for a gap one person has hit once. |
| reached `medium` or `high`, nothing drafted yet | `full` | the same workflow the user-reported path has always run: the issue is updated with the new labels, count and quote, then the change is drafted and a draft pull request is opened. |
| already drafting, or already has a pull request | `update` | the count line, the priority line and the labels are brought up to date and the new quote is added as a comment on the issue and on the pull request. Never a second pull request. |

A project with no repository bound still accumulates the group and its counts; there is simply
nowhere to file it, so no run starts. The widget is only ever told a repository is missing when the
project row really has none: `runTurn` reads `project.repo_full_name` itself before it offers,
because "the team has not connected a repository yet" is a claim about the customer.

**One gap in one group is one GitHub issue, whatever order the runs reach GitHub in.** Two runs for
the same group can overlap, and both can read a group whose `issue_number` is still null. So
`file_issue` re-reads the group and then claims `feature_request_group.issue_claim` with one
conditional update (migration 0018). The winner files and writes `issue_number`; every other run
polls the group for that number and comments on the issue instead of opening a second one. A claim
that never produces an issue is taken over after `ISSUE_WAIT_S`, and a failed run releases it.

A turn that ends `absent`, and a report through `POST /api/escalate`, also enqueue one discovery
for the group (`apps/web/lib/opportunity/queue.ts`): the second question, is this one person or a
pattern, answered from PostHog off the request. Once per group; a group with a finished run is
left alone, and the console's button is the way to run it again. Nothing about it can fail the
turn or the report.

`POST /api/escalate` resolves the message's request, joins its group as a user report, writes a
trace event recording that the user accepted, and starts whatever run `actionFor` chose. It returns
the run that owns the group when there is one, so a second reporter follows the same issue and pull
request rather than a run of their own. Under `local` the insert is the whole handover: the worker's
runner polls for rows with `status = 'queued'` and `engine = 'local'` and reads the group off
`escalation.group_id`.

### The text notice

A person who reported a gap can agree to one text message when the draft change for it opens.
`gap_subscriber` holds one row for each person and gap. `apps/web/lib/sms` is the rule, and
`apps/web/lib/dial.ts` is the only module in the web app that calls the provider. The worker has
the same rule in `services/worker/steps/sms_notice.py`, and `steps/dial.py` is the only module
there that calls the provider.

- **Who sends it.** The engine that opens the draft pull request. The forge engine sends it
  through `notifyDraft` in `ForgeDeps`, wired in `lib/forge/queue.ts`. The `local` engine's worker
  sends it in `open_draft_pr` (`steps/pipeline.py`), after it tells Slack. Each engine reads its
  own environment, so under `local` the two variables must be set where the worker runs.
- **Who is offered the text.** The answer event carries `escalation.textNotice: true` only when
  the runner that sends the text says that it can, and the gap is not past its draft
  (`lib/sms/offer.ts`). The sender is a process with its own environment: the worker under
  `local`, the forge runner under `forge`. Each one writes a heartbeat every 60 seconds with
  `sms: true` or `sms: false`. The offer is on when the runner of the engine that
  `ESCALATION_ENGINE` names has a heartbeat of at most 3 minutes that says true, and no other
  live runner says false (a forge run can be started from the console under `local`). The web
  app's own two variables decide nothing, so a web app that has them and a runner that does not
  make no promise. The heartbeats are read through `runner_heartbeats`, which measures each age
  on the database's clock. A read that fails means no offer. The trace says which it was, with
  the reason. A runner that is started again without its variables is still read as "can send"
  until its next heartbeat.
- **Who writes a row.** `POST /api/escalate`, through `subscribeToGap` (`lib/sms/subscribe.ts`),
  and nothing else. The widget's gap card shows one box that is not ticked, "Text me when a change
  for this is drafted". With the tick it shows a number field and the sentence that the person
  agrees to. The number leaves the widget only in the report request, as
  `notify: {phone, consent: true}`. The route refuses a `notify` with no `consent: true` and a
  number that `toE164` does not accept, before it writes anything. `toE164` (`@lantern/shared`)
  removes spaces, hyphens, dots and brackets, removes a "(0)" directly after the country code,
  refuses a "(0)" in any other place, and never guesses a country code.
- **What the report answers.** The report is recorded first, and what becomes of the text never
  fails it. The answer's `notify` is one of three states, and the card says each one in words.

  | State | When | The number |
  |---|---|---|
  | `subscribed` | The row is stored and one text is owed or on its way | Sealed in `phone_sealed` |
  | `not_needed` | The gap is `pr_open`, `awaiting_approval`, `shipped` or `rejected`. Each of these comes after a draft pull request, so a change was drafted already and no text will come | Not stored by this report |
  | `unavailable` | No runner can send the text now, a limit is reached, the answer already stored a different number, the gap is gone, or a query failed | Not stored by this report |

  The card says "this report did not save your number" for the last two. That is the exact
  claim: an earlier report of the same person can still have a number stored for the same gap.
  The line "You will get one text" stays on the card only while the report is before `pr_open`.
- **A row that no run will see is taken back.** The run sets the gap to `pr_open` before it reads
  who is owed a text. `subscribeToGap` writes the row first and reads the gap's state second. If
  the row was written too late for the run to see it, the state read is `pr_open` or later, and the
  row is deleted while no run holds it. If a query fails after the write, the row is deleted too.
  A request deletes only the row of its own answer (`message_id`), so it cannot break the promise
  that an earlier answer made. When nothing was deleted, the row is read: a row that still holds
  a number is owed a text or on its way to one, and the answer is `subscribed`.
- **Three limits bound what a caller can make the company send.** The embed key is public, and
  nothing proves that a number belongs to the caller. So: one answer stores one number
  (`message_id` is unique), one gap holds at most 50 people who are owed a text (`GAP_LIMIT`, the
  number that one pass reaches in its 60 seconds), and one project takes at most 100 new numbers
  in 24 hours (`DAY_LIMIT`). The two counts are read before the write and do not look at the
  number, so the answer does not say if a number was known before. What stays possible: a caller
  who asks 100 real questions in one day can make the company text 100 numbers that are not the
  caller's, one time each. A code that proves the number is the fix, and it is not built.
- **A person who asks again is texted again.** A row whose text ended (sent, never confirmed, or
  claimed more than 15 minutes ago by a run that stopped) is armed again with the new number and a
  new `consent_at`. A row whose text is owed or on its way is left as it is. So the rule is one
  text for one consent.
- **One gap is one text for one person.** The send call has no idempotency key, so a second call
  is a second text. A sender claims a person first, with one conditional update that sets
  `notified_at` only where it is null, and sends only when the update returned the row. The client
  makes one attempt and nothing repeats it.
- **How a send ends.** There are three results, and the client decides which one applies
  (`sendSms`, and `send_sms` in the worker).

  | Result | When | What the store does |
  |---|---|---|
  | `sent` | A 2xx whose body is the provider's own answer, `{message: {...}}` | `phone_sealed` is set to null. The claim stays. |
  | `refused` | Nothing was sent: any 4xx, a redirect other than a 303 (never followed), or a request that could not leave (connection refused, no such host, a base address that is not a URL) | `notified_at` goes back to null, so the text is still owed. The number stays. |
  | `unconfirmed` | The text may have gone: a 5xx, a 303 (it says "done, see there"), a timeout, a connection that broke, or a 2xx that is not the provider's answer (a page from a wrong address) | The claim stays and the number is erased, so nobody sends it again. |

  The worker's client reads three more failures as `refused`, because its HTTP library can tell
  that nothing was sent: a connection that did not open in time (to the provider or to a proxy in
  front of it), a certificate that is not trusted (`untrusted_certificate`; the request is written
  only after that check), and a key that cannot be a header (`bad_api_key`). In both engines a
  timeout after the connection opened is `unconfirmed`, and so is an answer whose headers cannot
  be read: the provider took that request. The worker also reads a status under 200 as
  `unconfirmed`: its library can take an interim answer (a 102) for the last one. The worker reads
  the body of an answer for at most 10 seconds and 64 kB, and a body it cannot read does not
  change what the status says. A message id is kept only when it is a short token; any other
  value is the provider's free text.

- **When a pass stops.** At a refusal that is not about the person (`forAll`: 401, 402, a
  redirect, an address that cannot be reached) and at an `unconfirmed` result: the next send is
  expected to end the same way. The people who are left stay unclaimed, so a provider outage costs
  one person their text and not everyone. A pass also stops after 200 people (`PASS_LIMIT`) or 60
  seconds (`PASS_BUDGET_MS`), because the run waits for it; the trace row then says `pass_limit`
  or `time_budget`. Every query of the store has a 10 second limit.
- **What the worker repeats, and what it does not.** The send is one attempt in both engines. It
  is the one call in the worker that does not go through `steps/retry.py`. The worker's store
  calls do go through it, each request with the 10 second limit: a read and the erase of a number
  are repeated after a blip, because a second one changes nothing. The claim and the release of a
  claim are made one time. A claim that is repeated after a lost answer comes back empty when the
  first one landed, and then nobody can say who holds the person. A release that is repeated can
  free the claim of a run that took the person in between.
- **Nothing starts a second pass.** A gap gets one draft pull request (`actionFor` starts no
  second one). So a person who is still owed after the pass gets no text, and the sealed number
  stays stored: a refusal for that person, a pass that stopped at a failure, the 60 second budget.
  The worker runs the pass in a `finally` once the pull request is open, so a step that fails
  after that point (the comment on the pull request, a trace row) does not skip it. A sweep that
  texts owed people while the draft is open is the fix for the rest, and it is not built.
- **What a stopped run leaves.** A run that stops between the claim and the record of the send
  leaves a claimed row with its number. A claim is held for seconds, so each pass first erases the
  number of every claim of the project that is older than 15 minutes (`forgetStale`). A stored
  value that does not open is skipped and is not erased: a runner with a different service role
  key reads every number that way, and that mistake must not destroy what people gave.
- **What the text says.** `draftNoticeText` in `@lantern/shared`: the company's name, the gap's
  title, that a change is drafted and the team reviews it next, and that no more texts follow. It
  does not say that the feature is live. `smsText` folds every text into the basic SMS alphabet,
  because one character outside it lowers the provider's cap from 1530 to 670 characters and more
  than doubles the segments of a long text. A character with no plain form is removed; it is never
  replaced by a different meaning.
- **A quoted name cannot be followed.** A gap's title starts as a visitor's words, and the text
  goes out under the company's name. So the quoted company and title keep letters, digits, spaces,
  an apostrophe, a comma and a hyphen. A dot, a slash, a colon and an at sign are removed, and so
  is anything that reads as a phone number. A phone then has no link and no number to offer.
- **What the trace says.** One `status` row for each draft pull request, written before the pull
  request row: "Text notice: off" with the missing variable, "Text notice: no one asked for a text
  about this request", "Text notice: 2 of 3 sent" (status `failed` when one was not sent), "Text
  notice: a different run sent the texts", or "Text notice: could not read who asked for a text".
  A notice that fails never fails the run.
- **A phone number is never logged.** It is in the sealed column and in the request body to the
  provider, and nowhere else: not in a trace row, an error, a reason code, or a console line.
- **Two copies of one rule.** The text rules are in `packages/shared/src/sms.ts` and in
  `services/worker/steps/sms_text.py`. `packages/shared/test/fixtures/sms-text.json` holds inputs
  and the exact text each one becomes, and both test suites run every one of them, so a rule
  changes in both files and in the fixture together. The sealed number has the same proof: the
  worker's `tests/test_seal.py` opens a value that `sealPhone` wrote. One difference is known. An
  accented letter is folded with the Unicode data of the runtime, so a character that a newer
  Unicode version added can fold to a letter in one runtime and to nothing in the other. Both
  results are in the basic SMS alphabet.

With `DIAL_API_KEY` or `DIAL_FROM_NUMBER` blank the notice is off, the table is not read, and the
run is the same as before, plus the one trace row. The answer then has no `textNotice`, the card
has no field, and the report is the same as before.

What is not built. A person cannot take a request for a text back. A sealed number stays stored
for as long as no draft opens and the gap is not deleted, and after a pass that did not reach the
person. When the database fails two times in one request (the write lands and the delete does
not), the answer is `unavailable` and the row stays. The forge engine logs a failed write of the
gap's state and goes on, so after such a failure a row can be stored for a gap whose draft is
open.

### The local engine's draft

`services/worker` turns one approved issue into one draft pull request. What the model is given and
what it may answer:

- **The architect reads the repository, not a summary of it.** The bounded file tree (400 paths),
  `AGENTS.md`, the dependency list from `package.json`, and the twelve most relevant files in full
  (9,000 characters each, 110,000 in total). Ranking is by what the path says, as in the web app's
  repository probe; keyword hits in the body only break ties, so a long document that mentions every
  word of the request cannot outrank the module the request is about. A path named in backticks by
  `AGENTS.md` is lifted, because a repository that documents itself says which files carry its
  contract.
- **The plan schema is strict and requires at least one file.** Each entry is
  `{path, reason, action}` with `action` one of `edit`, `create`, `delete`. The action is reconciled
  against the clone: a `create` of a file that is there is an edit, and a `delete` of a file that is
  not there is dropped.
- **An empty file list is a refusal, not a failure.** The issue is an approved product decision and
  supersedes any premise, guard test or contract in the target repository whose only content is that
  the feature is absent; such a guard belongs in the plan as a `delete` or an `edit`. One retry says
  so explicitly. A second empty answer raises with the model's own summary in the message, so the
  trace records why. See "An approved request outranks the target repository's premise" in
  `docs/architecture.md`.
- **The gates are the target repository's own.** `npm ci` (cached by lockfile hash), then every
  script in `GATES` that the target's `package.json` defines, cheapest first: `npm run typecheck`,
  `npm test`, `npm run build`, in the clone with the drafted files applied and the planned deletions
  removed. `npm test` earns its place: a draft passed typecheck and build and still broke NovaAir's
  `tests/seat-party.test.ts`, adding the two exports that repository documents with a signature the
  contract test does not call. `e2e` is never a gate, because it needs a browser and a running
  server.
- **A repair sees the file the gate named.** A failure goes back to the editor for the files the
  output names, up to 3 repairs, then a fresh candidate, up to 2 candidates. It also carries at most
  two files the gate named that the plan does not touch, read from the clone, because that is
  usually the test stating what the code has to satisfy, and a stack trace alone does not carry the
  signature it is being called with. Only a planned file is ever rewritten, so a contract is never
  edited into agreement.
- **The pull request body** names the request, the user's quote, the count line
  (`Requested N times, M by users`), every changed file and every deleted one.
- **The trace ends on the pull request and the pause.** `open_draft_pr` writes the gate comment and
  the status row first, then the `artifact` row for the pull request and the `pause` approve card, so
  those two are the last rows the console shows before a human decides.
- **The deployment watch finds the merge commit.** NovaAir's Vercel project is git-linked, so a merge
  to `main` deploys by itself. `steps/deploy.py` polls `GET /v6/deployments` filtered by `sha`, plus
  the recent list because a queued deployment can be missing from the filtered answer for a few
  seconds, and matches `meta.githubCommitSha`. After 10 minutes it raises `DeploymentTimeout`, which
  the pipeline records as a `status` event and an `error` on the row with the escalation left
  `deploying`. The pull request is merged either way, so the run is not marked failed.

## 5. Models

Exported as `MODELS` from `@lantern/shared`, with the reasoning efforts in `EFFORT` beside them.
Every call in `apps/web` goes through `apps/web/lib/openai.ts`; every call in the worker goes
through `services/worker/steps/llm.py`. Nothing else names a model id.

Chosen on **2026-08-29** by reading <https://developers.openai.com/api/docs/models> and the guides
it links.

| Purpose | Model id | Why this one |
|---|---|---|
| Fast understanding and small JSON tasks | `gpt-5.6-luna` | "Optimized for cost-sensitive workloads" and the cheapest of the current family. Understanding, the step plan, the visitor facts and the conversation summary are small extractions over evidence that is already gathered, and the user is waiting on them. |
| Answers, step plans, issue drafting, code planning | `gpt-5.6-sol` | "Flagship model for complex professional work". Issue text and a change plan both end up in a pull request a human reads, so this is where the strongest model earns its cost. |
| Absence verdict | `gpt-5.6-terra` at effort `high` | "Balances intelligence and cost". The verdict is one judgement over three short summaries: it needs deliberation, not writing. Running the middle model at high effort buys the deliberation without the flagship price. |
| Code generation | `gpt-5.6-sol` | The worker writes whole files that must pass the target repository's own typecheck and build. No Codex-branded model id is published on the models page, so the flagship general model does this work. |
| Capability compiler: reverse task synthesis (chosen 2026-08-29) | `gpt-5.6-luna` at effort `low` | Batched, eight sessions per call, over prose the compiler already rendered: a small extraction per session, nine calls per opportunity. On the seeded sessions it named the goal of all 63 family sessions correctly. |
| Capability compiler: the trajectory reward and the naming call (chosen 2026-08-30) | `gpt-5.6-sol` at effort `medium` | The reward decides how many sessions count as evidence, and on 2026-08-30 the small model graded 33 of 63 completed workflows as unfinished while the flagship graded 63 of 63. The naming call's answer becomes the specification and then a pull request a person reads. The flagship earns its cost on both. |
| Embeddings, 1536 dimensions | `text-embedding-3-small` | The current small embedding model. Its default width is 1536, which is what every vector column and both match functions are built around. |
| Document reading (vision) | `gpt-5.6-terra` at effort `low` | Reading a scanned handbook needs vision and accuracy, not the flagship's reasoning. The middle model is the balance point, and one call reads a whole document. |
| Speech to text | `gpt-transcribe` | The speech-to-text guide names it "the recommended model for transcribing recorded speech in its original language". |
| Text to speech | `gpt-4o-mini-tts` | The current text-to-speech model id. The default voice is `marin`, which the guide names among the best-quality voices. |

### The API these calls use

**Structured output goes through the Responses API.** The structured outputs guide presents it as
the current primary API, so `chatJson` sends
`text: {format: {type: "json_schema", name, schema, strict: true}}` rather than Chat Completions'
`response_format`. The worker does the same for its JSON and function-call steps.

Notes the API enforces:

- Every model in the `gpt-5.6` family is a reasoning model. Effort is
  `reasoning: {effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"}` and
  defaults to `medium`. `EFFORT` in `@lantern/shared` records the value each purpose uses.
- `max_output_tokens` counts reasoning tokens as well as text, so every budget is set well above
  the size of the answer itself. A budget sized for the text alone comes back empty.
- Embeddings take `dimensions`. The provider asks for `EMBED_DIMENSIONS` explicitly and rejects a
  vector of any other width, because a mismatch would fail later inside Postgres instead.
- A PDF goes to the Responses API directly as `input_file` with a `data:application/pdf;base64,`
  URL; the API extracts page text and page images itself, so nothing renders pages locally. An
  image goes as `input_image` with `detail: "high"`.
- Document reading returns `confidence` from 0 to 1 per page and per block: how legible the reader
  found that region. The documentation probe damps a passage's score by it, so a blurry scan cannot
  outvote clean text. It is a model-reported legibility score, not an engine measurement, and it is
  clamped into range on the way in.
- Text to speech answers with chunked audio, so `POST /api/speak` yields each `audio/mpeg` chunk as
  it lands and playback starts before the utterance is complete.

### Text messages

The provider is Dial. `SMS` in `@lantern/shared` holds the two paths and the caps,
`apps/web/lib/dial.ts` is the only module in the web app that calls it, and the base address is
`DIAL_API_URL`. The worker has the same two pieces: `steps/sms_text.py` holds the send path and
the cap, and `steps/dial.py` is the only module in the worker that calls the provider. Nothing
else names an endpoint.

Chosen on **2026-10-11** by reading <https://docs.getdial.ai> and the OpenAPI document it links.

| What | Value | Why |
|---|---|---|
| Send one text | `POST /api/v1/messages`, `Authorization: Bearer <key>`, JSON `{to, fromNumber, body}`; `201 {message: {id, status}}` | The OpenAPI document uses the `/api/v1` prefix, and some guide pages show `/v1`. The path is one constant in `SMS`, and `npm run dial:live` proves it with the first key. |
| List the account's numbers | `GET /api/v1/numbers` | Read-only. The live check uses it to prove the key, and to show the sender number's 10DLC status, which decides if a US phone gets the text. |
| Body cap | 1530 characters; 670 when one character is outside the basic SMS alphabet | From the send call's reference. `smsText` keeps every body in the basic alphabet, so the 1530 cap always applies. |
| `channel` | not sent | "Omit to use the number's own default - a standard number sends SMS, an iMessage number sends iMessage", and an iMessage number falls back to SMS for a phone that cannot take it. So the notice works with either kind of sender number. |
| SDK | not used | The call is one POST. The SDK adds two runtime dependencies for it. |
| Retries | none | "Not idempotent - there is no idempotency key, so retrying a failed request can send a duplicate message." A 4xx means nothing was sent. A 5xx or no answer is not known, and is never sent again. |
| Redirects | never followed (`redirect: "manual"`) | A redirect repeats a POST as a GET, and the page it lands on can answer 200. A 3xx is read as "nothing was sent, and the base address is wrong". |
| What counts as sent | a 2xx with `{message: {...}}` in the body | A 200 from a different server must not erase a person's number as if the text had gone. `message.id` is kept when it is a string, and is not required. |
| Error reason | the provider's `code` when it is a lower-case word (`insufficient_credit`, `rate_limited`), else `http_<status>` | The provider's error text can quote the phone number, so it is never copied. |


## 6. Capability IR

`@lantern/capability` compiles user workflows into one product capability. Its output is the
Capability IR, validated against `packages/capability/src/capability-ir.schema.json`
(`schema_version` "1") before anything stores it. The shape follows ASIL (arXiv 2608.26991): a
structured observation, semantic actions with typed params, and a final-state validator.

```ts
type CapabilityIR = {
  schema_version?: "1";
  intent: string;                       // snake_case, a user goal, never a gesture: seat_party_together
  summary?: string;
  observation: {                        // ASIL structured observation, as a schema
    inputs: Slot[];                     // what the caller passes
    app_state: Slot[];                  // what is read from the product at call time
    interactive_elements?: { type; id: Slot; attributes?: Slot[]; constraints?: string[]; available_actions?: string[] }[];
    example?: Record<string, unknown>;
  };
  actions: {                            // ASIL semantic actions; each maps to a product primitive
    name; kind: "read" | "write" | "rank";
    action_type?: "set_value" | "invoke_function" | "modify_file" | "api_call" | "navigate" | "batch";
    target?: string; params: Slot[]; returns?; primitive?: {symbol, file, confidence}; idempotent?;
  }[];
  constraints: { id; statement; source?: "trajectory" | "documentation" | "repository" | "policy" | "inferred"; evidence_ref? }[];
  preferences?: { id; statement; direction: "minimize" | "maximize"; weight? }[];
  success: {
    final_state: { id; statement }[];   // ASIL final-state validator
    scenarios: { id; given; when?; then; kind? }[];   // the Verifier's denominator, 21 for NovaAir
  };
  proposed_ui?: { location?; label?; affordance?; result_summary? };
  evidence: {                           // everything here comes from the mined sessions
    session_count; median_manual_actions?; window?: {from, to};
    trajectories: { session_id; replay_url?; reward?: {completion, coherence, total}; steps: {t, event, props?}[] }[];
  };
  granularity?: { replaces_atomic_steps_median?; rejected_too_low?: string[]; rejected_too_high?: string[]; coverage? };
  provenance?: { compiler_version?; model?; created_at?; opportunity_id? };
};
```

`Slot` is `{name, type, description?, required?, enum?, range?}` with `type` one of `string`,
`number`, `integer`, `boolean`, `string[]`, `number[]`, `object`, `object[]`.

The compiler's entry point is `compile(trajectories, context, model)`, returning
`{decision: "capability", ir, rejected, events}` or `{decision: "none", reasons, rejected, events}`.
`events` is the decision trail, one `CompilerEvent` `{stage, title, detail, at}` per step under the
four stages `workflows`, `intent`, `capability`, `verification`. How each field is derived, and how
to run the compiler with no key, is in `docs/capability-compiler.md`.

## 7. Environment

Every variable is described in `.env.example` and read through `apps/web/lib/env.ts`. The
evidence pipeline's: `POSTHOG_PERSONAL_API_KEY` (`query:read` and `session_recording:read`) and
`POSTHOG_PROJECT_ID` make PostHog reachable, `POSTHOG_HOST` picks the region (default
`https://us.posthog.com`), `POSTHOG_WINDOW_DAYS` bounds the miner (default 90);
`DISCOVERY_MODE` (`inline` | `runner`, default by host) says who executes a queued discovery;
`LANTERN_CONSOLE_TOKEN` and `LANTERN_CONSOLE_PROJECT` let a terminal read the console. The forge
engine's: `ESCALATION_ENGINE=forge` selects it; `FORGE_STRATEGY` (`reflex` | `runloop` | `local`,
default by the keys present) selects where candidates build; `REFLEX_API_KEY`,
`REFLEX_ORG`, `REFLEX_API_URL` and `REFLEX_PERSONA_BUILDER`, `REFLEX_PERSONA_UX`, `REFLEX_PERSONA_VERIFIER` for Reflex;
`RUNLOOP_API_KEY` and the optional `RUNLOOP_BLUEPRINT` for Runloop devboxes (also the agent's
devbox under Reflex); `FORGE_TARGET_REPO` (default `AadiDahake/novaair-own-your-intelligence`) when the project has no
repository bound; `FORGE_LOCAL_CACHE_DIR` for the local strategy's clone; `OPENAI_API_KEY` for
Codex inside a devbox, optional locally where the saved Codex login is used. Route memory's:
`MEMORABLE_API_KEY` turns it on with extraction, `MEMORABLE_API_URL` is the extraction API base,
`LANTERN_ROUTE_MEMORY=local` turns it on with no Memorable key, and `LANTERN_ROUTE_MEMORY_DIR` is
where the store keeps one JSON file per project (default the OS temp dir). Text messages:
`DIAL_API_KEY` and `DIAL_FROM_NUMBER` turn them on together, and they are off when one is blank;
`DIAL_API_URL` is the API base (default `https://api.getdial.ai`). The worker reads the same three
names from its own environment (`services/worker/config.py`). Only the runner that sends needs
them: the worker under `local`, the forge runner under `forge`. Its heartbeat tells the web app
that the text can be offered, and the web app reads neither variable for the offer.
