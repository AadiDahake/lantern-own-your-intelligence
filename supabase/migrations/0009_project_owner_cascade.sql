-- Deleting an account takes its workspace with it.
--
-- Without this the project row outlives the auth user that owned it: unreachable, because nothing
-- resolves to it any more, but still holding its slug and its embed key.
--
-- Any project that is already orphaned is released rather than deleted, which is the same state a
-- freshly seeded project is in before the seed hands it to an account. Nothing is lost, and the
-- constraint can then be trusted.

update project
set owner_id = null
where owner_id is not null
  and owner_id not in (select id from auth.users);

alter table project drop constraint if exists project_owner_id_fkey;
alter table project
  add constraint project_owner_id_fkey
  foreign key (owner_id) references auth.users (id) on delete cascade;
