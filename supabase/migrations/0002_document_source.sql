-- Re-indexing needs whatever produced a document, and the console previews what the reader
-- actually extracted, so both live on the row next to the chunks they produced.
alter table document add column if not exists source_text text;
alter table document add column if not exists pages jsonb;

-- A crawled site is one document made of many pages. The chunk remembers which page it came
-- from so a retrieved passage can be traced back to a real address.
alter table chunk add column if not exists source_ref text;
