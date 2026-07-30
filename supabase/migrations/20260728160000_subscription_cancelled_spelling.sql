-- ---------------------------------------------------------------------------
-- SUBSCRIPTION_CANCELLED — repair the reason-code spelling in stored data.
--
-- Shopify's `ShopifyPaymentsDisputeReason` enum contains SUBSCRIPTION_CANCELLED
-- (double L) and has never contained SUBSCRIPTION_CANCELED (single L). We
-- hardcoded the single-L spelling everywhere, so every real subscription
-- dispute (17 in prod, all from the 2026-07-20 blume-box backfill) fell through
-- to `general` family handling, got the GENERAL evidence checklist — which never
-- asks for the cancellation policy, the single most important document for a
-- "you charged me after I cancelled" claim — and resolved to NO template at all.
--
-- The code fix (canonical keys + `canonicalReasonCode()`) lands in the same PR.
-- This migration moves the DATA, without which the rename leaves live
-- subscription disputes with no template:
--
--   1. reason_template_mappings — the single-L rows hold the real templates;
--      the double-L row is an empty placeholder auto-created by
--      `syncDisputes.ensureReasonMapping` (family 'Unknown', template_id NULL)
--      when the first real dispute arrived. Drop placeholders, promote the
--      real rows, and leave exactly one row per (code, phase).
--   2. pack_templates.dispute_type + packs.dispute_type — the Template Library
--      filters on `.eq("dispute_type", …)`, so a stale value matches nothing.
--   3. rules.match.reason — merchant rules written before today.
--
-- NOT touched: `disputes.reason`. Those are historical facts as Shopify sent
-- them; the 2 legacy single-L rows are read through the alias
-- (`LEGACY_REASON_ALIASES` in lib/rules/disputeReasons.ts). Never rewrite a
-- dispute's recorded reason.
--
-- Idempotent: re-running is a no-op.
-- ---------------------------------------------------------------------------

-- 1a) Drop empty auto-created double-L placeholders that a real single-L row
--     is about to replace. Guarded on template_id IS NULL so a placeholder that
--     someone has since mapped by hand is preserved instead.
delete from public.reason_template_mappings placeholder
where placeholder.reason_code = 'SUBSCRIPTION_CANCELLED'
  and placeholder.template_id is null
  and exists (
    select 1
    from public.reason_template_mappings real_row
    where real_row.reason_code = 'SUBSCRIPTION_CANCELED'
      and real_row.dispute_phase = placeholder.dispute_phase
      and real_row.template_id is not null
  );

-- 1b) Promote the real rows to the canonical spelling. Skipped for a phase that
--     already has a surviving double-L row (a hand-mapped placeholder) so the
--     (reason_code, dispute_phase) uniqueness holds.
update public.reason_template_mappings m
set reason_code = 'SUBSCRIPTION_CANCELLED',
    label = case when m.label = 'Subscription Canceled'
                 then 'Subscription Cancelled' else m.label end,
    family = case when m.family = 'Unknown' then 'Subscription' else m.family end,
    updated_at = now()
where m.reason_code = 'SUBSCRIPTION_CANCELED'
  and not exists (
    select 1
    from public.reason_template_mappings existing
    where existing.reason_code = 'SUBSCRIPTION_CANCELLED'
      and existing.dispute_phase = m.dispute_phase
  );

-- 1c) Anything single-L still standing lost to a hand-mapped double-L row.
delete from public.reason_template_mappings
where reason_code = 'SUBSCRIPTION_CANCELED';

-- 1d) A phase whose only row was the empty placeholder (prod: chargeback had
--     one, inquiry had none) keeps its row but must stop reading as 'Unknown'.
update public.reason_template_mappings
set family = 'Subscription',
    label = case when label = 'Subscription Cancelled' then label
                 else 'Subscription Cancelled' end,
    notes = null,
    updated_at = now()
where reason_code = 'SUBSCRIPTION_CANCELLED'
  and family = 'Unknown';

-- 2) Template library + installed packs.
update public.pack_templates
set dispute_type = 'SUBSCRIPTION_CANCELLED', updated_at = now()
where dispute_type = 'SUBSCRIPTION_CANCELED';

update public.packs
set dispute_type = 'SUBSCRIPTION_CANCELLED', updated_at = now()
where dispute_type = 'SUBSCRIPTION_CANCELED';

-- 3) Merchant + setup rules that filter on the reason.
update public.rules r
set match = jsonb_set(
      r.match,
      '{reason}',
      (
        select jsonb_agg(
          case when elem = '"SUBSCRIPTION_CANCELED"'::jsonb
               then '"SUBSCRIPTION_CANCELLED"'::jsonb
               else elem end
          order by ord
        )
        from jsonb_array_elements(r.match -> 'reason') with ordinality as t(elem, ord)
      )
    ),
    updated_at = now()
where r.match -> 'reason' @> '["SUBSCRIPTION_CANCELED"]'::jsonb;
