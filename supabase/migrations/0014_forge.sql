-- The forge engine: candidates and what happened after the capability shipped.
--
-- A feature_request_group is still the opportunity, and an escalation is still one run against
-- it. What is new is that a forge run builds the capability in more than one sandbox at once,
-- verifies each attempt against the same scenarios, and keeps only the winner. Each attempt is a
-- `candidate` row. The 30-days-later numbers are `deployment_outcome` rows, labelled by source.
--
-- `capability_spec` (the compiled Capability IR) and `trajectory` are created by migration 0013.
-- The columns below that point at a capability_spec carry the uuid without a foreign key, so this
-- migration applies whether or not 0013 has landed yet. A follow-up migration adds the constraint
-- once both tables exist.

-- One Codex attempt in one sandbox. Rows for the same escalation share its capability spec; the
-- label tells them apart in the trace and the console.
create table if not exists candidate (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  escalation_id uuid not null references escalation on delete cascade,
  -- The compiled specification this attempt built. Null when the run was started from a spec
  -- supplied inline, before the compiler stored one. No foreign key yet, see the header.
  capability_spec_id uuid,
  label text not null,                           -- 'A' | 'B'
  -- The persona currently, or last, at work in this sandbox:
  -- capability_builder | ux_builder | capability_verifier
  persona text not null default 'capability_builder',
  -- The sandbox strategy that owns the box: runloop | local.
  strategy text not null default 'runloop',
  -- Runloop handles. devbox_id is the only handle that outlives the process.
  devbox_id text,
  blueprint_name text,
  tunnel_key text,
  -- Local handles: the checkout the candidate built in, and the port its preview serves on.
  local_path text,
  preview_port int,
  -- Nothing here is a URL we store: a preview URL is only valid while the sandbox runs.
  status text not null default 'queued',
  -- queued | provisioning | building | testing | ready | failed | torn_down
  codex_thread_id text,
  codex_exit_code int,
  branch text,
  -- Verification, from the repository's own test run against the specification's scenarios.
  scenarios_passed int,
  scenarios_total int,
  failing_scenarios jsonb,                       -- [scenario id] the verifier reported as failed
  test_report jsonb,                             -- the verifier's report and the runner's summary
  changed_files jsonb,                           -- [{path, kind}] from Codex file_change items
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  torn_down_at timestamptz
);

create index if not exists candidate_escalation_idx on candidate (escalation_id, label);

-- What happened to the capability after a human merged it. Future data is seeded and says so:
-- the default source is 'seeded', so the honest label cannot be forgotten.
create table if not exists deployment_outcome (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  measured_at timestamptz not null default now(),
  window_days int not null default 30,
  eligible_users int,
  feature_used int,
  feature_succeeded int,
  median_actions_before real,
  median_actions_after real,
  support_change_pct real,
  source text not null default 'seeded',         -- seeded | posthog
  created_at timestamptz not null default now()
);

create index if not exists deployment_outcome_group_idx
  on deployment_outcome (group_id, measured_at desc);

-- The specification a run built and the candidate that won it, so the preview and the pull
-- request know which sandbox to open. capability_spec_id has no foreign key yet, see the header.
alter table escalation
  add column if not exists capability_spec_id uuid,
  add column if not exists winning_candidate_id uuid references candidate on delete set null;

alter table candidate          enable row level security;
alter table deployment_outcome enable row level security;
