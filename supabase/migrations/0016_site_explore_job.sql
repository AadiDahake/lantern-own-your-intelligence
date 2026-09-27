-- Exploring a site is minutes of headless-browser work, which does not fit inside a serverless
-- function. The console's route only writes a job row and answers; a process on a machine with a
-- browser (the forge runner, or `npm run explore`) claims the row, explores, and records the
-- summary. The console polls the row and the graph tables.

create table if not exists site_explore_job (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  site_url text not null,
  status text not null default 'queued',     -- queued | running | done | failed
  summary jsonb,                             -- ExploreSummary when done
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists site_explore_job_status_idx on site_explore_job (status, created_at);
create index if not exists site_explore_job_project_idx on site_explore_job (project_id, created_at desc);

alter table site_explore_job enable row level security;

-- Claims the oldest queued job for one process. Two runners cannot claim the same row: the update
-- only lands where the status is still queued.
create or replace function claim_site_explore_job()
returns setof site_explore_job
language sql as $$
  update site_explore_job
  set status = 'running', started_at = now()
  where id = (
    select id from site_explore_job
    where status = 'queued'
    order by created_at
    limit 1
    for update skip locked
  )
  returning *;
$$;
