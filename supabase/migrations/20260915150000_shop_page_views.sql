-- 20260915150000: shop_page_views — what merchants (and we) actually looked at
--
-- WHY. `audit_events` records ACTIONS. Asked what a merchant did after logging
-- in, it answers with automation rows, because the dominant merchant behaviour
-- is looking, not writing. Mein Maison logged in at 06:53 on 2026-09-15, browsed,
-- and left: nothing in the database recorded any of it.
--
-- Deliberately NOT a column or event type on `audit_events`. That table is the
-- append-only compliance record of actions, with triggers rejecting UPDATE and
-- DELETE. Page views carry a 90-day retention policy, so they would have to
-- fight those triggers on every cleanup run, and navigation rows would bury the
-- real actions the table exists to preserve.
create table if not exists shop_page_views (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,

  -- Who was looking. `merchant` = a human in the merchant's own Shopify
  -- session. `admin` = one of us via SuperAdmin "View as merchant".
  --
  -- Admin views are recorded for the same reason the actor-attribution work
  -- exists (migration 20260915120000): an unlabelled gap is indistinguishable
  -- from absence. If our sessions went unlogged, "no rows for this page" would
  -- read as "the merchant never opened it" when it might mean "we opened it and
  -- did not record it". A page-view log with silent holes is worse than none.
  actor_type  text not null check (actor_type in ('merchant','admin')),

  -- adminUserId for `admin`; the Shopify staff id (session token `sub`) for
  -- `merchant`. Nullable: the staff id is not always resolvable, and a view
  -- worth recording must never be dropped for want of an id.
  actor_id    text,

  -- `path` is the URL as requested, so "which dispute did they open" is
  -- answerable. `route` is the normalised Next.js pattern
  -- (/app/disputes/[id]), so aggregates group without exploding per-uuid.
  path        text not null,
  route       text not null,

  -- Set when the path carries a dispute id, so views join to the dispute
  -- timeline without parsing strings at read time.
  dispute_id  uuid,

  viewed_at   timestamptz not null default now()
);

-- The only read pattern: one shop's recent views, newest first.
create index if not exists idx_shop_page_views_shop_time
  on shop_page_views (shop_id, viewed_at desc);

-- Retention sweep scans by age alone, across all shops.
create index if not exists idx_shop_page_views_viewed_at
  on shop_page_views (viewed_at);

-- Dispute-scoped lookups ("who looked at this dispute"), skipping the nulls.
create index if not exists idx_shop_page_views_dispute
  on shop_page_views (dispute_id) where dispute_id is not null;

alter table shop_page_views enable row level security;

-- Service-role only, mirroring audit_events. No merchant-facing surface reads
-- this; it is an internal record.
drop policy if exists shop_page_views_service_role on shop_page_views;
create policy shop_page_views_service_role on shop_page_views
  for all using (auth.role() = 'service_role');

comment on table shop_page_views is
  'Embedded-app page views, 90-day retention (cron: cleanup-page-views). '
  'Records BOTH merchant sessions and admin View-as-merchant sessions, each '
  'labelled in actor_type -- an unlabelled gap would be indistinguishable from '
  'the merchant never having visited. Actions live in audit_events, not here.';
