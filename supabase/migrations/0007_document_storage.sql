-- Where the original upload is kept, so the console can show the file itself next to what was
-- read out of it. The value is the object key inside the private `sources` storage bucket:
-- <project id>/<document id>/<filename>. Null for written notes and crawled pages, which have
-- no file of their own (their `source_text` is the original).
alter table document add column if not exists storage_path text;
