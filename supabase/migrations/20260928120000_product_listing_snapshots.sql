-- Not-as-described plan PR 2: snapshot storage for product listings.
-- (docs/plans/not-as-described-defence-package.plan.md §3 PR 2)
--
-- Inert until PR 3's collector writes to it (behind
-- PRODUCT_LISTING_EVIDENCE_ENABLED). One row per (dispute, line item, content):
-- identical content is skipped by the unique key, changed content is a new row.
-- Images live in the `evidence-packs` bucket under
-- {shop_id}/product-listings/{dispute_id}/…, listed in image_paths.

create table if not exists product_listing_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- FK to shops so admin_purge_shop discovers this table via the FK graph.
  shop_id uuid not null references shops(id) on delete cascade,
  dispute_id uuid not null references disputes(id) on delete cascade,
  order_gid text,
  line_item_gid text not null,
  product_gid text,
  variant_gid text,
  fetched_at timestamptz not null default now(),
  product_updated_at timestamptz,
  source_url text,
  title text,
  variant_options jsonb not null default '[]'::jsonb,
  description_text text,
  description_html text,
  image_paths text[] not null default '{}',
  -- sha256 over the text fields + each image's bytes hash.
  content_hash text not null,
  provenance_class text not null default 'current_at_preparation'
    check (provenance_class in ('current_at_preparation')),
  unique (dispute_id, line_item_gid, content_hash)
);

create index if not exists product_listing_snapshots_shop_fetched
  on product_listing_snapshots (shop_id, fetched_at);

alter table product_listing_snapshots enable row level security;
drop policy if exists service_role_full_access_product_listing_snapshots on product_listing_snapshots;
create policy service_role_full_access_product_listing_snapshots
  on product_listing_snapshots for all to service_role using (true) with check (true);

-- Evidence is immutable: no UPDATE ever; DELETE only under the transaction-
-- scoped purge flag (admin_purge_shop, retention RPC below), the same flag the
-- other append-only tables honour (20260906170000).
create or replace function reject_product_listing_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.allow_append_only_delete', true) = 'on' then
    return old;
  end if;
  raise exception 'product_listing_snapshots is append-only: % not allowed', tg_op;
end;
$$;

drop trigger if exists product_listing_snapshots_append_only on product_listing_snapshots;
create trigger product_listing_snapshots_append_only
  before update or delete on product_listing_snapshots
  for each row execute function reject_product_listing_snapshot_mutation();

-- Retention: delete snapshots older than the shop's retention period
-- (retention_days, default 365, computed live) and return their image paths
-- so the retention cron can remove the objects from storage.
create or replace function purge_expired_product_snapshots()
returns setof text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.allow_append_only_delete', 'on', true);
  return query
    with gone as (
      delete from product_listing_snapshots s
      using shops sh
      where sh.id = s.shop_id
        and s.fetched_at < now() - make_interval(days => coalesce(sh.retention_days, 365))
      returning s.image_paths
    )
    select unnest(image_paths) from gone;
end;
$$;

revoke all on function purge_expired_product_snapshots() from public;
grant execute on function purge_expired_product_snapshots() to service_role;
