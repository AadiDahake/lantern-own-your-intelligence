-- Initial schema. Drops every object it owns before creating it, so it is safe to re-run against a
-- database that is only partly built.

create extension if not exists vector;
create extension if not exists pgcrypto;

drop function if exists match_chunks(vector, int, uuid) cascade;
drop function if exists match_chunks cascade;
drop function if exists rls_auto_enable cascade;
drop function if exists trace_event_broadcast cascade;

drop table if exists trace_event cascade;
drop table if exists probe_result cascade;
drop table if exists escalation cascade;
drop table if exists message cascade;
drop table if exists conversation cascade;
drop table if exists chunk cascade;
drop table if exists document cascade;
drop table if exists project cascade;
drop table if exists tenant cascade;

create table if not exists project (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  embed_key text not null unique,
  site_url text,
  repo_full_name text,
  repo_default_branch text default 'main',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists document (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  title text not null,
  source_kind text not null,
  source_ref text,
  mime text,
  status text not null default 'pending',
  page_count int,
  mean_confidence real,
  chunk_count int not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists chunk (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references document on delete cascade,
  project_id uuid not null references project on delete cascade,
  ordinal int not null,
  heading text,
  content text not null,
  page int,
  block_type text,
  confidence real,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create table if not exists conversation (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  page_url text,
  page_title text,
  created_at timestamptz not null default now()
);

create table if not exists message (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversation on delete cascade,
  role text not null,
  content text not null,
  steps jsonb,
  probes jsonb,
  verdict jsonb,
  feature_request jsonb,
  created_at timestamptz not null default now()
);

create table if not exists escalation (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  conversation_id uuid references conversation on delete set null,
  message_id uuid references message on delete set null,
  request jsonb not null,
  engine text not null,
  status text not null default 'queued',
  issue_url text,
  issue_number int,
  pr_url text,
  pr_number int,
  branch text,
  deployment_url text,
  approval jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trace_event (
  id bigserial primary key,
  project_id uuid not null references project on delete cascade,
  conversation_id uuid references conversation on delete cascade,
  escalation_id uuid references escalation on delete cascade,
  source text not null,
  kind text not null,
  status text not null default 'ok',
  title text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trace_event_project_id_id_idx on trace_event (project_id, id);
create index if not exists chunk_project_id_idx on chunk (project_id);

-- Nearest-neighbour search over a project's chunks. `similarity` is cosine similarity, so higher
-- is closer, which is what the docs probe thresholds against.
create or replace function match_chunks(query_embedding vector(1536), match_count int, filter_project uuid)
returns table (id uuid, document_id uuid, heading text, content text, page int, confidence real, similarity float)
language sql stable as $$
  select c.id, c.document_id, c.heading, c.content, c.page, c.confidence,
         1 - (c.embedding <=> query_embedding) as similarity
  from chunk c
  where c.project_id = filter_project
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$$;

-- Row level security on with no policies: the service role bypasses it and nothing else has a way in.
alter table project enable row level security;
alter table document enable row level security;
alter table chunk enable row level security;
alter table conversation enable row level security;
alter table message enable row level security;
alter table escalation enable row level security;
alter table trace_event enable row level security;
