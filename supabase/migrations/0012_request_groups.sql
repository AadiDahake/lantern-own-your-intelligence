-- Feature requests are grouped before anything is filed.
--
-- The same gap reaches the agent many times, worded differently every time. Filing one issue per
-- conversation buries the developers and hides the signal that matters: how many people hit this.
-- So every drafted request is embedded and matched against the groups this project already has.
-- A near match joins the group and raises its counts; anything else starts a new group.
--
-- A group carries its own weight (how often it was detected, how often a user asked for it
-- explicitly) and its own state on GitHub, so the issue and the pull request belong to the group
-- rather than to whichever conversation happened to be first.

create table if not exists feature_request_group (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  title text not null,
  description text not null default '',
  area text not null default '',
  -- the embedding of "title + description"; null only if the embedding call failed.
  embedding vector(1536),
  -- Every time the agent saw this gap, and the subset where the user asked for it themselves.
  report_count int not null default 1,
  user_report_count int not null default 0,
  priority text not null default 'low',      -- low | medium | high
  status text not null default 'observed',   -- observed | filed | drafting | pr_open | awaiting_approval | shipped | rejected
  issue_url text,
  issue_number int,
  pr_url text,
  -- The workflow run that is currently carrying this group forward, for the live trace.
  escalation_id uuid references escalation on delete set null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists feature_request_group_project_idx
  on feature_request_group (project_id, last_seen desc);

alter table feature_request_group enable row level security;

-- An escalation is one run of the worker against a group. `mode` says what that run is for:
-- the first `file_only` run opens the issue and stops, a `full` run drafts the pull request,
-- and an `update` run only carries the new count and quote to GitHub.
alter table escalation
  add column if not exists group_id uuid references feature_request_group on delete set null,
  add column if not exists mode text not null default 'full';

create index if not exists escalation_group_idx on escalation (group_id);

-- Cosine nearest neighbours among a project's groups, the same shape as match_chunks.
create or replace function match_request_groups(
  query_embedding vector(1536),
  match_count int,
  filter_project uuid
)
returns table (
  id uuid,
  title text,
  description text,
  area text,
  report_count int,
  user_report_count int,
  priority text,
  status text,
  issue_url text,
  issue_number int,
  pr_url text,
  escalation_id uuid,
  similarity float
)
language sql stable as $$
  select g.id, g.title, g.description, g.area, g.report_count, g.user_report_count,
         g.priority, g.status, g.issue_url, g.issue_number, g.pr_url, g.escalation_id,
         1 - (g.embedding <=> query_embedding) as similarity
  from feature_request_group g
  where g.project_id = filter_project
    and g.embedding is not null
  order by g.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;
