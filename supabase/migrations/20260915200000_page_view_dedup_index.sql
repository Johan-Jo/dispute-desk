-- 20260915200000: make page-view dedup atomic
--
-- WHY. `recordPageView` deduped with a read-then-write: select any row for the
-- same (shop, path, actor) in the last 5s, insert only if none found. Two
-- reporters describe one navigation -- the server layout and the client beacon
-- -- and they run concurrently, so BOTH read "nothing recent" before either
-- inserts. Measured on dev 2026-09-15: the same path recorded twice 0.29s
-- apart, straight through a 5-second guard.
--
-- A check-then-act cannot dedup concurrent writers. Only the database can.
--
-- The bucket column is generated, not supplied: truncating viewed_at to a
-- 10-second bucket gives a unique key that two racing inserts collide on, and
-- the loser is rejected by the constraint rather than by a lost race. A page
-- genuinely revisited in the next bucket still records, which is the intent --
-- dedup means "one navigation, one row", not "suppress revisits".
alter table shop_page_views
  add column if not exists dedup_bucket timestamptz
  generated always as (date_bin('10 seconds', viewed_at, timestamptz 'epoch')) stored;

-- Existing duplicates must go before a unique index can be built. Keeps the
-- earliest row in each bucket -- the one that actually corresponds to the
-- navigation; later ones are the double-report.
delete from shop_page_views a
using shop_page_views b
where a.shop_id = b.shop_id
  and a.path = b.path
  and a.actor_type = b.actor_type
  and date_bin('10 seconds', a.viewed_at, timestamptz 'epoch')
    = date_bin('10 seconds', b.viewed_at, timestamptz 'epoch')
  and a.viewed_at > b.viewed_at;

create unique index if not exists uq_shop_page_views_dedup
  on shop_page_views (shop_id, path, actor_type, dedup_bucket);

comment on column shop_page_views.dedup_bucket is
  'Generated 10-second bucket of viewed_at. With the unique index, two racing '
  'reporters of the same navigation collide instead of both inserting. Added '
  '2026-09-15 after a read-then-write guard let duplicates through 0.29s apart.';
