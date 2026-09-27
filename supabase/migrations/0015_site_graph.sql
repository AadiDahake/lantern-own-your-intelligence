-- The site graph: what Lantern knows about the host product beyond the page in front of the user.
--
-- A page is a route (`/trips/:id/seats`), a control is identified by what a person sees on it
-- (role, accessible name, landmark, link target) and never by a selector, and a transition says
-- that pressing this control on this page led to that page, or revealed another control on the
-- same page. Two sources feed it: the explorer, which reads the site with a headless browser, and
-- the widget, which reports the page it scanned and any move the user just made. The planner reads
-- it to compute a route to a control, so the number of steps the widget announces is exact.
--
-- A known route remembers which control a question resolved to, so the same question answers from
-- the graph with no model call.

create table if not exists site_page (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  route text not null,                        -- normalised path, identifiers replaced by :id
  url text not null,                          -- one concrete address the route was seen at
  title text not null default '',
  source text not null default 'widget',      -- 'explorer' | 'widget'
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (project_id, route)
);

create table if not exists affordance (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  page_id uuid not null references site_page on delete cascade,
  key text not null,                          -- role|name|landmark|href, see controlKey
  role text not null,
  name text not null,
  landmark text,
  href text,                                  -- route the link points at, when it is a link
  visible boolean not null default true,      -- on screen when the page was read, before any click
  seen_count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (page_id, key)
);

create index if not exists affordance_project_idx on affordance (project_id);

create table if not exists transition (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  from_page_id uuid not null references site_page on delete cascade,
  affordance_id uuid not null references affordance on delete cascade,
  to_page_id uuid not null references site_page on delete cascade,
  kind text not null default 'navigation',    -- 'navigation' | 'reveal'
  reveals_affordance_id uuid references affordance on delete cascade,
  source text not null default 'widget',      -- 'explorer' | 'widget'
  seen_count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- One row per (control, destination) for a navigation and per (control, revealed control) for a
-- reveal. Postgres treats nulls as distinct in a unique constraint, so the reveal column is
-- coalesced into the index.
create unique index if not exists transition_edge_idx
  on transition (affordance_id, to_page_id, coalesce(reveals_affordance_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists transition_project_idx on transition (project_id);

create table if not exists known_route (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project on delete cascade,
  intent text not null,                       -- the question's concepts, sorted and joined
  feature text not null,                      -- the capability the question was about
  question text not null,                     -- the wording that first resolved it
  target_affordance_id uuid not null references affordance on delete cascade,
  answer text not null,                       -- the prose that holds from any page
  sources jsonb,                              -- [{title, url}] the answer cites
  embedding vector(1536),                     -- of the question, for a near match on new wording
  hit_count int not null default 0,
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now(),
  unique (project_id, intent)
);

create index if not exists known_route_project_idx on known_route (project_id);

alter table site_page enable row level security;
alter table affordance enable row level security;
alter table transition enable row level security;
alter table known_route enable row level security;

-- One page as one scan saw it: the page row and every control on it, in a single round trip. A
-- control seen again keeps its identity and moves its last_seen forward; a control seen visible
-- once stays visible, because the explorer reads pages before any click and that is the state a
-- route should assume. Returns the page id.
create or replace function upsert_site_scan(
  filter_project uuid,
  page_route text,
  page_url text,
  page_title text,
  scan_source text,
  controls jsonb                               -- [{key, role, name, landmark, href, visible}]
)
returns uuid
language plpgsql as $$
declare
  page uuid;
begin
  insert into site_page (project_id, route, url, title, source)
  values (filter_project, page_route, page_url, coalesce(page_title, ''), scan_source)
  on conflict (project_id, route) do update
    set url = excluded.url,
        title = case when excluded.title = '' then site_page.title else excluded.title end,
        last_seen = now()
  returning id into page;

  insert into affordance (project_id, page_id, key, role, name, landmark, href, visible)
  select filter_project, page, c.key, c.role, c.name, c.landmark, c.href, coalesce(c.visible, true)
  from jsonb_to_recordset(controls)
    as c(key text, role text, name text, landmark text, href text, visible boolean)
  where c.key is not null and c.role is not null and c.name is not null
  on conflict (page_id, key) do update
    set visible = affordance.visible or excluded.visible,
        seen_count = affordance.seen_count + 1,
        last_seen = now();

  return page;
end;
$$;

-- One move: this control on this page led to that page, or revealed that control on the same
-- page. Pages and controls named here must already exist; the caller upserts the scans first.
create or replace function upsert_transition(
  filter_project uuid,
  from_route text,
  control_key text,
  to_route text,
  transition_kind text,
  reveals_key text,
  scan_source text
)
returns void
language plpgsql as $$
declare
  from_page uuid;
  to_page uuid;
  control uuid;
  revealed uuid;
begin
  select id into from_page from site_page where project_id = filter_project and route = from_route;
  select id into to_page from site_page where project_id = filter_project and route = to_route;
  if from_page is null or to_page is null then return; end if;
  select id into control from affordance where page_id = from_page and key = control_key;
  if control is null then return; end if;
  if reveals_key is not null then
    select id into revealed from affordance where page_id = to_page and key = reveals_key;
    if revealed is null then return; end if;
  end if;

  insert into transition (project_id, from_page_id, affordance_id, to_page_id, kind, reveals_affordance_id, source)
  values (filter_project, from_page, control, to_page, transition_kind, revealed, scan_source)
  on conflict (affordance_id, to_page_id, coalesce(reveals_affordance_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set seen_count = transition.seen_count + 1, last_seen = now();
end;
$$;

-- The whole graph of one project as one document, in the shape the planner reads.
create or replace function site_graph(filter_project uuid)
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'route', p.route, 'url', p.url, 'title', p.title, 'source', p.source,
        'lastSeen', p.last_seen, 'firstSeen', p.first_seen
      ) order by p.route)
      from site_page p where p.project_id = filter_project
    ), '[]'::jsonb),
    'controls', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'route', p.route, 'key', a.key, 'role', a.role, 'name', a.name,
        'landmark', a.landmark, 'href', a.href, 'visible', a.visible,
        'seenCount', a.seen_count, 'lastSeen', a.last_seen
      ) order by p.route, a.first_seen)
      from affordance a join site_page p on p.id = a.page_id
      where a.project_id = filter_project
    ), '[]'::jsonb),
    'transitions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from', fp.route, 'key', a.key, 'to', tp.route, 'kind', t.kind,
        'reveals', r.key, 'source', t.source, 'seenCount', t.seen_count, 'lastSeen', t.last_seen
      ) order by t.last_seen desc)
      from transition t
        join site_page fp on fp.id = t.from_page_id
        join site_page tp on tp.id = t.to_page_id
        join affordance a on a.id = t.affordance_id
        left join affordance r on r.id = t.reveals_affordance_id
      where t.project_id = filter_project
    ), '[]'::jsonb)
  );
$$;

-- Known routes near a question, by the embedding of the wording that first resolved them.
create or replace function match_known_routes(
  query_embedding vector(1536),
  match_count int,
  filter_project uuid
)
returns table (
  id uuid, intent text, feature text, question text, target_affordance_id uuid,
  answer text, sources jsonb, hit_count int, similarity float
)
language sql stable as $$
  select k.id, k.intent, k.feature, k.question, k.target_affordance_id,
         k.answer, k.sources, k.hit_count,
         1 - (k.embedding <=> query_embedding) as similarity
  from known_route k
  where k.project_id = filter_project and k.embedding is not null
  order by k.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 10);
$$;

-- The same nearest-passage search as match_chunks, with the document title and the address the
-- passage came from, so the documentation check can name the article it found.
create or replace function match_chunks_with_source(
  query_embedding vector(1536), match_count int, filter_project uuid
)
returns table (
  id uuid, document_id uuid, document_title text, source_ref text, heading text, content text,
  page int, confidence real, similarity float
)
language sql stable as $$
  select c.id, c.document_id, d.title as document_title, coalesce(c.source_ref, d.source_ref) as source_ref,
         c.heading, c.content, c.page, c.confidence,
         1 - (c.embedding <=> query_embedding) as similarity
  from chunk c join document d on d.id = c.document_id
  where c.project_id = filter_project
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$$;
