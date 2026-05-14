-- LSE-0: Network reason code resolution on disputes.
--
-- Shopify Admin GraphQL 2026-01 exposes only the coarse 14-value
-- `ShopifyPaymentsDisputeReason` enum. The Liability-Shift Engine
-- (EPIC-LSE-0 through EPIC-LSE-6) needs the underlying Visa / Mastercard
-- network reason code to:
--   - detect CE 3.0 eligibility (Visa 10.4)
--   - detect FPT eligibility (Mastercard 4837 / 4863)
--   - drive rebuttal-template selection per code instead of per coarse enum
--   - tailor evidence checklists per code
--
-- Resolution is performed by lib/disputes/networkReasonCode.ts using a
-- direct → derived → inferred → unknown confidence chain. Confidence is
-- stored alongside the code so downstream consumers (qualification, rebuttal
-- generation) can decide whether to act on it or fall back to the coarse
-- enum.
--
-- See docs/epics/EPIC-LSE-0-reason-codes.md.

alter table disputes
  add column if not exists network_reason_code text,
  add column if not exists network_reason_code_confidence text,
  add column if not exists network_reason_code_resolved_at timestamptz;

-- Constrain confidence to the four allowed values (matches
-- ResolveConfidence in lib/disputes/networkReasonCode.ts).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'disputes_network_reason_code_confidence_check'
  ) then
    alter table disputes
      add constraint disputes_network_reason_code_confidence_check
      check (
        network_reason_code_confidence is null
        or network_reason_code_confidence in ('direct', 'derived', 'inferred', 'unknown')
      );
  end if;
end$$;

-- Lookups for analytics + downstream qualification queries (per shop, per code).
create index if not exists disputes_shop_network_reason_code_idx
  on disputes (shop_id, network_reason_code)
  where network_reason_code is not null;

comment on column disputes.network_reason_code is
  'Resolved Visa / Mastercard network reason code (e.g. "10.4", "4837"). Null when card network is unknown or the Shopify enum does not map to a single code. Set by lib/disputes/networkReasonCode.ts.';

comment on column disputes.network_reason_code_confidence is
  'How the network reason code was resolved: direct (Shopify exposed field — currently unreachable), derived (parsed from OrderTransaction.receiptJson), inferred (Shopify enum + card network heuristic), unknown.';

comment on column disputes.network_reason_code_resolved_at is
  'Timestamp the resolver last wrote this dispute''s network_reason_code. Null when never resolved.';
