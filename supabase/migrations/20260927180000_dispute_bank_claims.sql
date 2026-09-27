-- The bank's claim (Shopify's "issuer claim"), copied by the merchant from
-- Shopify Admin. The Admin API has no field for it, and for a reopened
-- dispute or a `general` one with no network reason code it is the only
-- statement of what the response must answer.
-- Plan: docs/plans/bank-claim-capture.plan.md; code: lib/disputes/bankClaim.ts.
--
-- Its own table, not evidence_items: a pack rebuild deletes and re-creates
-- evidence_items and folds manual rows into one nested "manual uploads" row,
-- and manualSource counts untyped manual rows as customer communication. The
-- claim must survive rebuilds and must never be read as correspondence.
--
-- One row per (dispute, response cycle): a reopen asks again.

create table if not exists dispute_bank_claims (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  response_cycle int not null default 1,
  claim_text text,
  no_claim_shown boolean not null default false,
  answered_at timestamptz not null default now(),
  answered_by text not null default 'merchant',
  unique (dispute_id, response_cycle),
  check (claim_text is not null or no_claim_shown)
);

alter table dispute_bank_claims enable row level security;
drop policy if exists service_role_full_access_dispute_bank_claims on dispute_bank_claims;
create policy service_role_full_access_dispute_bank_claims
  on dispute_bank_claims for all
  using (true)
  with check (true);
