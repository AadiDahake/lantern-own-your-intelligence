-- One answer stores one phone number.
--
-- A person asks for the text on the card of one answer, so the row records which answer it was.
-- The unique index is the rule: a second number for the same answer is refused. Without it, one
-- call for each number would put any list of numbers behind one gap, and the company would text
-- them all when the draft change opens. With it, each number costs one real question.
--
-- The column is null on a row from before this migration and after its message is deleted, and a
-- null is never a duplicate.

alter table gap_subscriber
  add column if not exists message_id uuid references message on delete set null;

create unique index if not exists gap_subscriber_message_idx
  on gap_subscriber (message_id) where message_id is not null;

-- The web app offers the text only when the runner that sends it says that it can. Each runner
-- (the worker, the forge runner) writes a heartbeat row, titled 'worker online', every 60 seconds,
-- and its detail says the engine and `sms`.
--
-- `runner_heartbeats` gives the newest heartbeats of one project, newest first, with the age of
-- each one. Two things are done here and not in the web app. The age is measured on this
-- database's clock, so a web app whose clock is wrong does not read a runner that stopped as
-- live. And the title is a constant in the query, so each plan can use the partial index below.
-- A query through the REST API sends the title as a parameter, and after a few calls the planner
-- stops using a partial index for it; a project with no runner then pays for a scan of each trace
-- row it has. The index is built with a plain `create index`, which holds back writes to
-- `trace_event` for the time of one scan of the table.
create index if not exists trace_event_worker_online_idx
  on trace_event (project_id, id) where title = 'worker online';

create or replace function runner_heartbeats(p_project uuid)
returns table (engine text, sms boolean, age_seconds double precision)
language sql stable as $$
  select
    coalesce(detail->>'engine', ''),
    coalesce(detail->'sms' = 'true'::jsonb, false),
    extract(epoch from (now() - created_at))::double precision
  from trace_event
  where project_id = p_project and title = 'worker online'
  order by id desc
  limit 8
$$;
