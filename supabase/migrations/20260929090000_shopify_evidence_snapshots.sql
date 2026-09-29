-- Retained-evidence plan (docs/plans/reopened-retained-evidence.plan.md) §1,
-- Rollout 3: observe-only snapshots of what Shopify holds on each open
-- dispute. The last `under_review` row of a cycle becomes the next cycle's
-- round-1 reference. Nothing reads these rows to decide anything yet.
--
-- Holds merchant-typed free text: shop_id cascades through admin_purge_shop
-- (shop/redact), customers/redact deletes the customer's rows, and
-- retention-cleanup deletes rows of closed disputes past retention.
create table if not exists shopify_evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  dispute_id uuid not null references disputes(id) on delete cascade,
  cycle integer not null default 1,
  observed_status text not null,
  text_fields jsonb not null default '{}'::jsonb,
  file_slots jsonb not null default '{}'::jsonb,
  field_hashes jsonb not null default '{}'::jsonb,
  content_hash text not null,
  read_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now()
);

create index if not exists shopify_evidence_snapshots_dispute_idx
  on shopify_evidence_snapshots (dispute_id, read_at desc);

alter table shopify_evidence_snapshots enable row level security;
drop policy if exists service_role_full_access_shopify_evidence_snapshots on shopify_evidence_snapshots;
create policy service_role_full_access_shopify_evidence_snapshots
  on shopify_evidence_snapshots for all to service_role using (true) with check (true);
