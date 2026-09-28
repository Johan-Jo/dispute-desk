-- English translations of product-listing snapshots
-- (docs/plans/defence-letter-structure.plan.md §4, maintainer D3 2026-09-28).
--
-- Visa's Dispute Management Guidelines (p. 9): evidence must be "in English or
-- accompanied by an English translation". A non-English listing exhibit prints
-- the original with a machine translation beneath it, captioned as such.
-- One translation per snapshot, made once and reused. The snapshot itself is
-- append-only, so the translation lives here and goes with it (cascade).

create table if not exists product_listing_translations (
  snapshot_id uuid primary key references product_listing_snapshots(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  title text,
  variant_line text,
  excerpt text,
  model text not null,
  created_at timestamptz not null default now()
);

create index if not exists product_listing_translations_shop_idx on product_listing_translations(shop_id);

alter table product_listing_translations enable row level security;
drop policy if exists service_role_full_access_product_listing_translations on product_listing_translations;
create policy service_role_full_access_product_listing_translations
  on product_listing_translations
  for all
  to service_role
  using (true)
  with check (true);
