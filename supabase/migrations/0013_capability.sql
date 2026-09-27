-- The NO branch, upgraded: the evidence behind an opportunity and the specification compiled
-- from it.
--
-- A feature_request_group is still the opportunity. What is new is the behavioural evidence
-- mined for it (one `trajectory` row per PostHog session), the Capability IR the compiler
-- produced from that evidence (`capability_spec`), and the queue that carries one run of the
-- pipeline from "the turn ended absent" to "the specification is stored" (`discovery`).
--
-- `candidate` and `deployment_outcome` are migration 0014's. The foreign keys that point from
-- 0014's columns at `capability_spec` live in migration 0017, so the schema is the same whether
-- this file ran before or after 0014.

-- Behavioural evidence for one opportunity, mined from PostHog. One row per session.
create table if not exists trajectory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  -- PostHog's $session_id. Unique per group, so a re-run of the miner is idempotent.
  session_id text not null,
  distinct_id text,
  started_at timestamptz not null,
  ended_at timestamptz,
  step_count int not null default 0,
  -- The ordered [{t, event, props}] list, exactly the shape the compiler consumes.
  steps jsonb not null,
  -- The manual steps a capability call would replace, as the compiler counts them.
  manual_actions int not null default 0,
  -- The steps as prose, [{line, seconds}], rendered once by the compiler so the console says
  -- what the prompts said and never has to evaluate the compiler itself.
  rendered jsonb,
  -- OS-Genesis reverse task synthesis: the goal inferred from those steps.
  inferred_goal text,
  goal_name text,
  goal_confidence real,
  -- OS-Genesis trajectory reward model. Two axes, kept separate; never averaged in the database.
  reward_completion real,
  reward_coherence real,
  -- Deep link into the PostHog app. Null when no recording exists for the session.
  replay_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, session_id)
);

create index if not exists trajectory_group_idx on trajectory (group_id, started_at desc);

-- The compiled Capability IR. One row per version; the console reads the latest.
create table if not exists capability_spec (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  intent text not null,                          -- snake_case, e.g. seat_party_together
  version int not null default 1,
  -- The whole IR, validated against capability-ir.schema.json before insert.
  spec jsonb not null,
  -- Denormalised, so the console lists opportunities without parsing every spec.
  summary text,
  scenario_count int not null default 0,
  session_count int not null default 0,
  -- Two medians with two definitions, over the supporting sessions. The compiler counts every
  -- manual step, scanning included; the product counts what it calls an interaction (a seat
  -- click, a refused click, a passenger pick). The outcome row compares the product's.
  median_manual_actions real,
  median_interactions real,
  -- ToolCUA: how many manual steps one call replaces, by median.
  replaces_atomic_steps real,
  model text,
  created_at timestamptz not null default now(),
  unique (group_id, version)
);

create index if not exists capability_spec_group_idx on capability_spec (group_id, version desc);

-- One run of the opportunity pipeline against a group: mine the sessions, compile them.
--
-- A run is enqueued by the request that noticed the gap and executed elsewhere: by the discovery
-- runner, or after the response on a machine that allows it. The console polls the row.
create table if not exists discovery (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  -- The chat that triggered it, so the evidence line lands in that conversation's trace.
  conversation_id uuid references conversation on delete set null,
  trigger text not null default 'auto',          -- auto | user | manual
  status text not null default 'queued',         -- queued | running | done | failed
  stage text,                                    -- mining | compiling, while running
  decision text,                                 -- capability | none, once done
  reasons jsonb,                                 -- why no capability was warranted
  session_count int,
  median_manual_actions real,
  median_interactions real,
  capability_spec_id uuid references capability_spec on delete set null,
  error text,
  claimed_by text,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discovery_group_idx on discovery (group_id, created_at desc);
create index if not exists discovery_queue_idx on discovery (status, created_at) where status = 'queued';

-- One run at a time per group. A second trigger while one is queued or running joins it.
create unique index if not exists discovery_active_idx
  on discovery (group_id) where status in ('queued', 'running');

-- The trace of an opportunity spans the chat that noticed it, the pipeline that mined and
-- compiled it, and the forge run that built it. The first two carry the group id so the
-- console and the terminal can follow one opportunity; the forge rows are found through the
-- group's escalation.
alter table trace_event
  add column if not exists group_id uuid references feature_request_group on delete set null;

create index if not exists trace_event_group_idx on trace_event (group_id, id);

-- Claims the oldest queued run for a runner, atomically, or returns nothing. `skip locked`
-- lets two runners poll the same queue without handing out the same row twice.
create or replace function claim_discovery(worker text)
returns setof discovery
language plpgsql as $$
declare
  claimed uuid;
begin
  select id into claimed
  from discovery
  where status = 'queued'
  order by created_at
  limit 1
  for update skip locked;
  if claimed is null then
    return;
  end if;
  return query
    update discovery
    set status = 'running', claimed_by = worker, claimed_at = now(), updated_at = now()
    where id = claimed
    returning *;
end;
$$;

alter table trajectory      enable row level security;
alter table capability_spec enable row level security;
alter table discovery       enable row level security;
