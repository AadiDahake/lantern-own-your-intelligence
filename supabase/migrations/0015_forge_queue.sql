-- The forge queue: what a route writes and a long-lived runner picks up.
--
-- A forge run takes minutes, so it cannot live inside a serverless function. The routes now only
-- write the row and answer; `npm run forge:runner` polls these columns and carries the work.
--
-- `capability_ir` is the specification the run builds, copied onto the row at enqueue time. It is
-- what makes a forge escalation runnable: the widget also opens `engine='forge'` rows with status
-- 'queued' and no specification, and the runner must not pick those up. `capability_spec_id` still
-- records which compiled spec it came from, when it came from one.
--
-- `approval_claimed_at` is the runner's claim on a decision. The status column cannot carry it: a
-- rejection's terminal status is 'rejected', which is also the status the console writes when the
-- decision is made, so there is no status transition left to claim it with.
alter table escalation
  add column if not exists capability_ir jsonb,
  add column if not exists approval_claimed_at timestamptz;
