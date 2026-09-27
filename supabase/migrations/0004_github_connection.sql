-- The GitHub account a console user linked to the project.
--
-- github_token holds the OAuth access token encrypted at rest (AES-256-GCM, see
-- apps/web/lib/github/secret.ts). It never leaves the server: the console only ever reads
-- github_login and github_avatar.

alter table project add column if not exists github_login text;
alter table project add column if not exists github_avatar text;
alter table project add column if not exists github_token text;
