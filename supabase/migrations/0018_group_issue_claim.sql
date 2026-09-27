-- One gap in one request group is one GitHub issue, whoever files it.
--
-- A group can have more than one run against it at the same moment: a user's report arrives while
-- an earlier run is still filing, and both read a group whose `issue_number` is still null. Both
-- then file, and the repository gains two issues for the same request.
--
-- `issue_claim` is the slot that makes the decision atomic. A run claims it with a conditional
-- update - it only wins when the column is still null - and every other run for that group waits
-- for the `issue_number` the winner writes and comments on that issue instead. A run that fails
-- clears the slot, so the next report can file after all.
alter table feature_request_group
  add column if not exists issue_claim uuid references escalation on delete set null;

comment on column feature_request_group.issue_claim is
  'The escalation currently filing this group''s GitHub issue. Claimed atomically; cleared on failure.';
