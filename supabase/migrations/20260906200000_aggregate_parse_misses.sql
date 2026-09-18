-- Collapse `fraud_intel_parse_misses` from one row per occurrence to one row
-- per distinct (shop, fact, parser_version), with a count.
--
-- The table exists to monitor parser drift when Shopify rewords a signal, so
-- the information it needs to carry is the DISTINCT SET of unmatched phrasings
-- — not every individual sighting. It was storing one row per order per
-- unmatched fact, and the parser deliberately matches only the six signals the
-- GraphQL schema does not expose, so every other fact Shopify sends counts as
-- a "miss". On prod 2026-09-06 that was 6,500,217 rows carrying just 23,890
-- distinct phrasings (most of those templated: "Shipping address is N km…").
--
-- The cost was not theoretical. At 1371 MB it was the largest table in the
-- database and, being an unindexed FK to `shops`, it was the direct cause of
-- the admin shop-delete timing out (fixed in 20260906190000; this removes the
-- bulk that made it matter). It grew with every order, forever.
--
-- It also broke the very widget it feeds: /admin/fraud-intel pulled 2000 raw
-- rows and aggregated them in JS, so against 6.5M rows the drift list was an
-- arbitrary sliver rather than the real top-N.
--
-- Rebuilt rather than migrated in place: collapsing 6.5M rows with an UPDATE …
-- GROUP BY would be slower and would bloat the heap. `create table as` +
-- rename is one pass, and the old table is dropped in the same transaction.

-- Aggregate straight out of the existing data.
create table fraud_intel_parse_misses_new as
select
  gen_random_uuid()      as id,
  shop_id,
  fact_text,
  -- Sentiment is a property of the phrasing, not the sighting; identical text
  -- carries identical sentiment. min() collapses the group deterministically
  -- and tolerates a stray NULL rather than failing the rebuild.
  min(fact_sentiment)    as fact_sentiment,
  parser_version,
  count(*)::bigint       as occurrences,
  min(observed_at)       as first_seen_at,
  max(observed_at)       as last_seen_at
from fraud_intel_parse_misses
group by shop_id, fact_text, parser_version;

drop table fraud_intel_parse_misses;
alter table fraud_intel_parse_misses_new rename to fraud_intel_parse_misses;

alter table fraud_intel_parse_misses
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column shop_id set not null,
  alter column fact_text set not null,
  alter column parser_version set not null,
  alter column occurrences set not null,
  alter column occurrences set default 1,
  alter column first_seen_at set not null,
  alter column first_seen_at set default now(),
  alter column last_seen_at set not null,
  alter column last_seen_at set default now();

alter table fraud_intel_parse_misses
  add constraint fraud_intel_parse_misses_pkey primary key (id);

-- `create table as` does not carry the FK across. Restoring it keeps the shop
-- purge correct (the row must die with its shop) — and the index below is what
-- keeps `delete from shops` fast, per 20260906190000.
alter table fraud_intel_parse_misses
  add constraint fraud_intel_parse_misses_shop_id_fkey
  foreign key (shop_id) references shops(id) on delete cascade;

-- The aggregation key. UNIQUE so the writer can upsert on it and increment
-- rather than append.
create unique index fraud_intel_parse_misses_key_idx
  on fraud_intel_parse_misses (shop_id, fact_text, parser_version);

create index fraud_intel_parse_misses_shop_id_idx
  on fraud_intel_parse_misses (shop_id);

-- Drives the drift widget's ordering.
create index fraud_intel_parse_misses_recent_idx
  on fraud_intel_parse_misses (last_seen_at desc);

alter table fraud_intel_parse_misses enable row level security;
-- No policies — service-role only, unchanged.

comment on table fraud_intel_parse_misses is
  'Unmatched Shopify risk fact strings, AGGREGATED: one row per (shop_id, fact_text, parser_version) with an occurrence count. Populated by lib/fraudIntel/signalWriter.ts via upsert-and-increment. Watched by /admin/fraud-intel for parser-drift alerts. Was one row per sighting until 20260906200000 — 6.5M rows for 23,890 distinct phrasings.';

comment on column fraud_intel_parse_misses.occurrences is
  'How many times this exact fact text has been seen unmatched for this shop under this parser version.';

-- Atomic increment for the writer. An upsert from PostgREST cannot express
-- `occurrences = occurrences + 1` against the existing row, and a
-- read-modify-write would lose counts under the concurrent order-ingest that
-- produces these. One statement per batch, no read-back.
create or replace function record_parse_misses(p_misses jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into fraud_intel_parse_misses
    (shop_id, fact_text, fact_sentiment, parser_version, occurrences, first_seen_at, last_seen_at)
  select
    (m->>'shop_id')::uuid,
    m->>'fact_text',
    m->>'fact_sentiment',
    (m->>'parser_version')::int,
    count(*)::bigint,
    now(),
    now()
  from jsonb_array_elements(p_misses) as m
  group by 1, 2, 3, 4
  on conflict (shop_id, fact_text, parser_version) do update
    set occurrences  = fraud_intel_parse_misses.occurrences + excluded.occurrences,
        last_seen_at = excluded.last_seen_at;
$$;

comment on function record_parse_misses(jsonb) is
  'Upsert-and-increment for parse misses. Groups the batch first so one payload touches each key once (ON CONFLICT cannot update the same row twice in a statement), then adds to any existing count.';

revoke all on function record_parse_misses(jsonb) from public;
