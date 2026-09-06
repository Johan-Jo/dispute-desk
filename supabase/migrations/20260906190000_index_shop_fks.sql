-- Index the four `shop_id` FKs that had no supporting index, so deleting a
-- shop stops scanning whole tables to validate them.
--
-- Postgres indexes the REFERENCED side of a foreign key automatically, never
-- the referencing side. So `delete from shops` has to prove no child row
-- still points at the row — and with no index on the child's `shop_id` that
-- is a sequential scan of the entire table, once per FK.
--
-- `fraud_intel_parse_misses` is 1371 MB / 6.5M rows, so a single shop delete
-- paid a full scan of it. Measured on prod 2026-09-06: `delete from shops`
-- took **6.6 s** for a shop with zero orders and 194 audit rows, while the
-- deletes of that shop's own data took 3 ms. Through the admin UI the purge
-- exceeded the statement timeout and failed with `canceling statement due to
-- statement timeout` — the cost was entirely FK validation against tables the
-- shop had no rows in, which is why an empty shop was as slow as a full one.
--
-- The other three are small today, but the same trap scales with them, and an
-- index on a 32 kB table costs nothing.
--
-- Plain CREATE INDEX, not CONCURRENTLY: `supabase db push` wraps each
-- migration in a transaction, and CONCURRENTLY cannot run inside one. The
-- write lock on `fraud_intel_parse_misses` lasts the length of the build;
-- that table is written only by the fraud-intel parser, so a brief stall
-- there is acceptable and nothing merchant-facing blocks on it.
create index if not exists idx_fraud_intel_parse_misses_shop_id
  on fraud_intel_parse_misses (shop_id);

create index if not exists idx_evidence_short_links_shop_id
  on evidence_short_links (shop_id);

create index if not exists idx_carrier_alert_incidents_shop_id
  on carrier_alert_incidents (shop_id);

create index if not exists idx_submission_attempts_shop_id
  on submission_attempts (shop_id);
