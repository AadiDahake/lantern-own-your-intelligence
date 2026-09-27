-- An account owns exactly one project.
--
-- `owner_id` is the Supabase auth user id. Every console request resolves to the caller's project
-- through it, so no account can read another account's sources, conversations or repository.
-- Widget traffic still resolves by `embed_key`, which is public by design.
--
-- The unique index is what enforces "one project per account". Postgres treats nulls as distinct,
-- so a project may temporarily have no owner (the seed claims the demo project separately, because
-- looking a user up by email needs the auth admin API rather than SQL).

alter table project add column if not exists owner_id uuid;
alter table project add column if not exists company text;
alter table project add column if not exists onboarded_at timestamptz;

create unique index if not exists project_owner_id_key on project (owner_id);

-- The console shows the company name as the project name, so a project created before this
-- migration keeps reading correctly.
update project set company = name where company is null;
