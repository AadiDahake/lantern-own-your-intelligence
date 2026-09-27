-- Whether an answer helped, as told by the person who read it.
--
-- One rating per message: a visitor changing their mind overwrites the row rather than adding a
-- second opinion, so the console never has to reconcile two verdicts on the same answer.

create table if not exists message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references message on delete cascade,
  project_id uuid not null references project on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  note text,
  created_at timestamptz not null default now(),
  unique (message_id)
);

-- The conversation detail reads every rating for a transcript in one go.
create index if not exists message_feedback_project_idx on message_feedback (project_id, created_at desc);

alter table message_feedback enable row level security;
