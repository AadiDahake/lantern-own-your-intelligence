-- How each conversation ended, written once the assistant's turn is stored.
-- outcome: 'solved' | 'missing_feature' | 'unresolved'; summary is one sentence in plain English.
alter table conversation add column if not exists outcome text;
alter table conversation add column if not exists summary text;

-- The Conversations page filters by outcome inside one project.
create index if not exists conversation_project_outcome_idx on conversation (project_id, outcome);
