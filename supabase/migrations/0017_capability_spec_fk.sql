-- The foreign keys from the forge engine's rows (migration 0014) to the compiled specification
-- (migration 0013). Kept apart from both so the two tables exist whichever order they landed in.
--
-- `set null`, not cascade: a candidate or a run is a record of work that happened, and deleting
-- a specification must not erase it.

alter table candidate
  drop constraint if exists candidate_capability_spec_id_fkey,
  add constraint candidate_capability_spec_id_fkey
    foreign key (capability_spec_id) references capability_spec on delete set null;

alter table escalation
  drop constraint if exists escalation_capability_spec_id_fkey,
  add constraint escalation_capability_spec_id_fkey
    foreign key (capability_spec_id) references capability_spec on delete set null;
