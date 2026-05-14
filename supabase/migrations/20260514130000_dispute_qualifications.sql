-- LSE-1: CE 3.0 qualification verdicts per dispute.
--
-- Stores the result of evaluateQualification(dispute) — whether the
-- dispute would qualify for Visa Compelling Evidence 3.0 and via which
-- branch (auto-qualified, initial-billing, or standard 2-priors-plus-anchor).
--
-- Six verdict states:
--   qualifies                          — standard CE 3.0 path: 2 priors + 2 matches + IP/Device anchor
--   qualifies_network_prequalified     — Visa Secure / Data Only authentication; Visa auto-qualified since 2025-10-17
--   qualifies_via_initial_billing      — recurring/MIT order using initial subscription billing transaction
--   partial                            — close but missing one gate (1 prior, no anchor, etc.)
--   does_not_qualify                   — cleanly fails a gate
--   not_applicable                     — wrong network, wrong reason code, wrong shape
--
-- Three branch values:
--   auto_qualified    — Branch 1 fired (3DS)
--   initial_billing   — Branch 2 fired (subscription)
--   standard          — Branch 3 fired (priors)
--   none              — verdict is partial / does_not_qualify / not_applicable
--
-- See docs/epics/EPIC-LSE-1-qualification-engine.md.

create table if not exists dispute_qualifications (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  dispute_id uuid references disputes(id) on delete cascade,
  shopify_dispute_id text not null,
  shopify_order_id text,
  card_network text not null check (
    card_network in ('visa', 'mastercard', 'amex', 'discover', 'other', 'unknown')
  ),
  reason_code text,
  program_evaluated text not null check (
    program_evaluated in ('ce_30', 'fpt', 'both', 'none')
  ),
  ce30_status text not null check (
    ce30_status in (
      'qualifies',
      'qualifies_network_prequalified',
      'qualifies_via_initial_billing',
      'partial',
      'does_not_qualify',
      'not_applicable'
    )
  ),
  ce30_branch text check (
    ce30_branch is null or ce30_branch in ('auto_qualified', 'initial_billing', 'standard', 'none')
  ),
  ce30_match_points text[] not null default '{}',
  ce30_has_anchor boolean not null default false,
  ce30_qualifying_priors text[] not null default '{}',
  ce30_auto_qualification_via text check (
    ce30_auto_qualification_via is null
    or ce30_auto_qualification_via in ('visa_secure', 'visa_data_only', 'merchant_confirmed')
  ),
  auto_qualification_fee_applies boolean not null default false,
  confidence text check (
    confidence is null or confidence in ('high', 'medium', 'low')
  ),
  confidence_reasons text[] not null default '{}',
  missing_evidence text[] not null default '{}',
  evaluated_at timestamptz not null default now(),
  evidence_package_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One verdict per shop per Shopify dispute. Upsert on re-evaluation.
create unique index if not exists dispute_qualifications_shop_dispute_uq
  on dispute_qualifications (shop_id, shopify_dispute_id);

-- Queue views: "what's qualifying right now" per shop.
create index if not exists dispute_qualifications_shop_status_idx
  on dispute_qualifications (shop_id, ce30_status);

-- Time-bound dashboards: "qualifications this period".
create index if not exists dispute_qualifications_shop_evaluated_idx
  on dispute_qualifications (shop_id, evaluated_at desc);

-- Standard auto-update trigger for updated_at.
create or replace function dispute_qualifications_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists dispute_qualifications_updated_at on dispute_qualifications;
create trigger dispute_qualifications_updated_at
before update on dispute_qualifications
for each row execute function dispute_qualifications_set_updated_at();

-- RLS: server-only access via service role (matches disputes/evidence_packs).
-- Service role bypasses RLS by default; the policy is defense-in-depth
-- against accidental anon/client access.
alter table dispute_qualifications enable row level security;

drop policy if exists service_role_full_access_qualifications on dispute_qualifications;
create policy service_role_full_access_qualifications
  on dispute_qualifications for all
  using (true)
  with check (true);

comment on table dispute_qualifications is
  'LSE-1: Per-dispute Visa CE 3.0 qualification verdicts. One row per Shopify dispute, upserted by evaluateQualification() in lib/automation/pipeline.ts.';

comment on column dispute_qualifications.ce30_status is
  'Verdict: qualifies (standard), qualifies_network_prequalified (Visa Secure / Data Only since 2025-10-17), qualifies_via_initial_billing (subscription MIT), partial, does_not_qualify, not_applicable.';

comment on column dispute_qualifications.ce30_branch is
  'Which qualification branch fired: auto_qualified, initial_billing, standard, or none.';

comment on column dispute_qualifications.auto_qualification_fee_applies is
  'True when verdict is auto-qualified AND disputed transaction date is on or after 2026-04-17 (Visa fee effective date).';

comment on column dispute_qualifications.confidence_reasons is
  'Machine codes explaining the confidence rating. Examples: guest_checkout, single_anchor, b2b_data_quality_warning, ip_match:subnet_only, shipping_match:normalized_only.';
