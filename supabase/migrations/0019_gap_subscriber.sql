-- A person who reported a gap can ask for one text message when the draft change for it opens.
--
-- One row is one person, one gap, one text. A row exists only when the person agreed to the text,
-- so `consent_at` has no default and cannot be null.
--
-- The phone number is never stored in the clear. `phone_sealed` is the number encrypted with a key
-- derived from the service role key, in the format the GitHub token on `project` already uses
-- (AES-256-GCM, 'iv.ciphertext.tag', each part base64url). `phone_digest` is a keyed hash of the
-- number: it makes one number one row for one gap, and it finds a person's rows when they ask to
-- stop, without a readable number in the table.
--
-- `notified_at` is the claim. A sender sets it with one conditional update before the send, and
-- only where it is still null. The provider's send call has no idempotency key, so a second send
-- is a second text; the claim is what makes one gap one text when two runs overlap. A send that
-- the provider refused sets it back to null. After a text is sent, `phone_sealed` is set to null:
-- the number is kept only while a text is still owed. A run that stops between the claim and that
-- write leaves the number behind, so each pass first erases the number of every claim of the
-- project that is older than 15 minutes.

create table if not exists gap_subscriber (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  group_id uuid not null references feature_request_group on delete cascade,
  phone_sealed text,                         -- the encrypted number; null after the text is sent
  phone_digest text not null,                -- keyed hash of the number, base64url
  consent_at timestamptz not null,           -- when the person agreed to the text
  notified_at timestamptz,                   -- the claim: set before the send, null while a text is owed
  created_at timestamptz not null default now(),
  unique (group_id, phone_digest)
);

create index if not exists gap_subscriber_owed_idx
  on gap_subscriber (group_id, created_at) where notified_at is null;

alter table gap_subscriber enable row level security;

comment on table gap_subscriber is
  'People who agreed to one text message about one gap. The number is encrypted, and it is erased after the text is sent.';
