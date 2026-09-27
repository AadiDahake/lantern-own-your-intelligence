-- Durable facts the agent remembers about one visitor of one project.
--
-- A visitor is identified only by the random id the widget keeps in localStorage. Nothing
-- personally identifying is stored here: the agent is told to skip secrets, credentials, email
-- addresses, phone numbers and anything else sensitive, and only writes short statements about
-- the visitor's role, what they are working on, and what they prefer.

create table if not exists visitor_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  visitor_id text not null,
  fact text not null,
  source_conversation_id uuid references conversation on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, visitor_id, fact)
);

-- Every turn reads the visitor's facts newest first.
create index if not exists visitor_memory_lookup_idx
  on visitor_memory (project_id, visitor_id, created_at desc);

alter table visitor_memory enable row level security;

-- The conversation carries the visitor so the console can show what the agent remembers
-- about the person behind a transcript.
alter table conversation add column if not exists visitor_id text;
create index if not exists conversation_visitor_idx on conversation (project_id, visitor_id);
