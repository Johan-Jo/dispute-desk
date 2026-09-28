-- Bank-claim plan F4: the merchant's approval to append their own file (the
-- one already in Shopify's uncategorized evidence slot) to our PDF, per
-- dispute and response cycle. Without a row here the save worker never
-- replaces that file. Recorded by an operator once the merchant approves;
-- the annex itself also needs MERCHANT_FILE_ANNEX_ENABLED=on.
create table if not exists merchant_file_approvals (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  response_cycle integer not null default 1,
  decision text not null check (decision in ('attach')),
  approved_by text not null,
  approved_at timestamptz not null default now(),
  note text,
  unique (dispute_id, response_cycle)
);

alter table merchant_file_approvals enable row level security;
drop policy if exists service_role_full_access_merchant_file_approvals on merchant_file_approvals;
create policy service_role_full_access_merchant_file_approvals
  on merchant_file_approvals for all to service_role using (true) with check (true);
