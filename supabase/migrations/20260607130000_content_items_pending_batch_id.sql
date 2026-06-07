-- English-first autopilot: when the synchronous generation publishes only en-US
-- and hands the remaining locales to the async Anthropic Message Batches API,
-- we record the in-flight batch id here so a server-side poller cron can ingest
-- + publish the results once the batch ends, then clear it.
--
-- Nullable; null = no batch in flight for this item. Mirrors the lightweight
-- single-column approach used by source_locale (20260329213000).
alter table public.content_items
  add column if not exists pending_batch_id text;

comment on column public.content_items.pending_batch_id is
  'In-flight Anthropic Message Batch id for English-first locale backfill; null when none. Cleared by the autopilot-batch-drain cron after ingest+publish.';

-- Partial index so the drain cron cheaply finds the (usually tiny) set of items
-- with a batch still in flight.
create index if not exists content_items_pending_batch_id_idx
  on public.content_items (pending_batch_id)
  where pending_batch_id is not null;
