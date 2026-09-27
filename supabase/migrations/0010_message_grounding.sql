-- The evidence an answer was built on, kept with the answer.
--
-- Continuing a walkthrough needs the same documentation passages the first answer used. Without
-- them the only way to carry on is to run the whole turn again, which costs the user a second or
-- two of standing still in the middle of being shown something.

alter table message add column if not exists grounding jsonb;
