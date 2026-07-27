-- Seed SYNTHETIC disputes at every presentation stage for the DEV shop
-- surasvenne.myshopify.com (6f62ee7a-66ba-452f-bb13-2e4baf44e4c0) so the
-- shared presentation model can be verified end-to-end on dev
-- (design-alignment plan §15 visual validation).
--
-- DEV ONLY (project vrpkgudqmpyunekrkpnc). These rows do NOT exist in
-- Shopify — dispute_gid carries the SEED-STAGE marker. Idempotent:
-- re-running replaces the previous seed set (packs cascade or are
-- deleted explicitly).
--
-- Stages: building · prepared strong/moderate/weak · saved-editable
-- strong/moderate · Gorgias review requested · blocking (missing
-- required evidence) · under review · won · lost.
--
-- Run: npx supabase db query --linked --file scripts/sql/seed-staged-presentation-disputes.sql
--      (verify linked ref = vrpkgudqmpyunekrkpnc FIRST — CLAUDE.md #0)

with shop as (
  select '6f62ee7a-66ba-452f-bb13-2e4baf44e4c0'::uuid as id
),
old as (
  select id from disputes
  where shop_id = (select id from shop)
    and dispute_gid like 'gid://shopify/ShopifyPaymentsDispute/SEED-STAGE-%'
),
del_packs as (
  delete from evidence_packs where dispute_id in (select id from old) returning id
),
del_disputes as (
  delete from disputes where id in (select id from old) returning id
),
spec as (
  select * from (values
    -- (gid_suffix, order_name, customer, shopify_status, reason, amount,
    --  due_days, normalized_status, submission_state, final_outcome,
    --  closed_days_ago, submitted_days_ago, needs_review, needs_attention,
    --  attention_reason, attention_payload,
    --  pack_status, pack_saved_days_ago, pack_approved, strength)
    ('SEED-STAGE-BUILDING',        '#9001', 'Seed Byggman',     'needs_response', 'FRAUDULENT',            120.00, 14, 'in_progress',          'not_saved',           null,   null, null, false, false, null, null,
     'building', null, false, null),
    -- Strong/moderate on an AUTO shop → auto-save already SAVED them (an
    -- autopilot shop does not leave a strong pack sitting at "ready").
    ('SEED-STAGE-PREP-STRONG',     '#9002', 'Seed Starkman',    'needs_response', 'FRAUDULENT',            210.00, 12, 'submitted_to_shopify', 'saved_to_shopify',    null,   null, null, false, false, null, null,
     'saved_to_shopify_verified', 1, true, 'strong'),
    ('SEED-STAGE-PREP-MODERATE',   '#9003', 'Seed Mellanberg',  'needs_response', 'PRODUCT_NOT_RECEIVED',  107.92, 10, 'submitted_to_shopify', 'saved_to_shopify',    null,   null, null, false, false, null, null,
     'saved_to_shopify_verified', 1, true, 'moderate'),
    ('SEED-STAGE-PREP-WEAK',       '#9004', 'Seed Svagsson',    'needs_response', 'PRODUCT_UNACCEPTABLE',   99.00,  9, 'ready_to_submit',      'not_saved',           null,   null, null, false, false, null, null,
     'ready', null, false, 'weak'),
    ('SEED-STAGE-SAVED-STRONG',    '#9005', 'Seed Sparad',      'needs_response', 'FRAUDULENT',            186.58, 11, 'submitted_to_shopify', 'saved_to_shopify',    null,   null, null, false, false, null, null,
     'saved_to_shopify_verified', 1, true, 'strong'),
    ('SEED-STAGE-SAVED-MODERATE',  '#9006', 'Seed Sparlund',    'needs_response', 'PRODUCT_NOT_RECEIVED',   75.00,  8, 'submitted_to_shopify', 'saved_to_shopify',    null,   null, null, false, false, null, null,
     'saved_to_shopify_verified', 2, true, 'moderate'),
    ('SEED-STAGE-COMM-REQUESTED',  '#9007', 'Seed Gorgiasdottir','needs_response','FRAUDULENT',             60.78, 13, 'needs_review',         'not_saved',           null,   null, null, true,  true,  'gorgias_evidence_ready', '{"proposal_count": 2, "run_id": "seed-stage"}',
     'ready', null, false, 'moderate'),
    -- Weak case on an AUTO shop: the strength gate holds it at "ready"
    -- (auto shops don't auto-submit weak evidence) but this is NOT a
    -- merchant task — the live pipeline never flags needs_attention/
    -- missing_required_evidence here, it just keeps the strongest truthful
    -- pack and monitors. So: no attention, no urgent banner. (Previously
    -- this row FABRICATED a missing_required_evidence urgent state the real
    -- pipeline never produces — corrected 2026-07-27.)
    ('SEED-STAGE-BLOCKING',        '#9008', 'Seed Blockberg',   'needs_response', 'PRODUCT_NOT_RECEIVED',  210.00,  3, 'ready_to_submit',      'not_saved',           null,   null, null, false, false, null, null,
     'ready', null, false, 'weak'),
    ('SEED-STAGE-UNDER-REVIEW',    '#9009', 'Seed Granskvist',  'under_review',   'FRAUDULENT',            124.80, null,'submitted_to_bank',   'submitted_confirmed', null,   null, 3, false, false, null, null,
     'saved_to_shopify_verified', 5, true, 'strong'),
    ('SEED-STAGE-WON',             '#9010', 'Seed Vinnarsson',  'won',            'FRAUDULENT',            231.00, null,'won',                 'submitted_confirmed', 'won',  5, 9, false, false, null, null,
     'saved_to_shopify_verified', 12, true, 'strong'),
    ('SEED-STAGE-LOST',            '#9011', 'Seed Förlorman',   'lost',           'PRODUCT_UNACCEPTABLE',  210.00, null,'lost',                'submitted_confirmed', 'lost', 6, 10, false, false, null, null,
     'saved_to_shopify_verified', 13, true, 'weak')
  ) as t(gid_suffix, order_name, customer, shopify_status, reason, amount,
         due_days, normalized_status, submission_state, final_outcome,
         closed_days_ago, submitted_days_ago, needs_review, needs_attention,
         attention_reason, attention_payload,
         pack_status, pack_saved_days_ago, pack_approved, strength)
),
ins_disputes as (
  insert into disputes (
    shop_id, dispute_gid, order_name, customer_display_name, status, reason,
    phase, amount, currency_code, due_at, initiated_at, normalized_status,
    submission_state, final_outcome, closed_at, submitted_at,
    needs_review, needs_attention, attention_reason, attention_payload,
    outcome_amount_recovered, outcome_amount_lost
  )
  select
    (select id from shop),
    'gid://shopify/ShopifyPaymentsDispute/' || s.gid_suffix,
    s.order_name,
    s.customer,
    s.shopify_status,
    s.reason,
    'chargeback',
    s.amount,
    'USD',
    case when s.due_days is null then null else now() + (s.due_days || ' days')::interval end,
    now() - interval '6 days',
    s.normalized_status,
    s.submission_state,
    s.final_outcome,
    case when s.closed_days_ago is null then null else now() - (s.closed_days_ago || ' days')::interval end,
    case when s.submitted_days_ago is null then null else now() - (s.submitted_days_ago || ' days')::interval end,
    s.needs_review,
    s.needs_attention,
    s.attention_reason,
    coalesce(s.attention_payload::jsonb, '{}'::jsonb),
    case when s.final_outcome = 'won' then s.amount else null end,
    case when s.final_outcome = 'lost' then s.amount else null end
  from spec s
  on conflict (shop_id, dispute_gid) do nothing
  returning id, dispute_gid
)
insert into evidence_packs (
  shop_id, dispute_id, status, approved_for_save_at, saved_to_shopify_at,
  pack_json, checklist_v2
)
select
  (select id from shop),
  d.id,
  s.pack_status,
  case when s.pack_approved then now() - interval '2 days' else null end,
  case when s.pack_saved_days_ago is null then null else now() - (s.pack_saved_days_ago || ' days')::interval end,
  case s.strength
    when 'strong' then jsonb_build_object('case_strength', jsonb_build_object(
      'overall', 'strong', 'score', 85,
      'strongCount', 2, 'moderateCount', 1, 'supportingCount', 3,
      'heroVariant', 'likely_to_win',
      'strengthReasonI18n', jsonb_build_object(
        'key', 'disputes.strengthReason.strong.single',
        'params', jsonb_build_object('label', jsonb_build_object('key', 'disputes.signalLabel.delivery')))))
    when 'moderate' then jsonb_build_object('case_strength', jsonb_build_object(
      'overall', 'moderate', 'score', 55,
      'strongCount', 0, 'moderateCount', 2, 'supportingCount', 3,
      'heroVariant', 'could_win',
      'strengthReasonI18n', jsonb_build_object(
        'key', 'disputes.strengthReason.moderate.moderateOnly',
        'params', jsonb_build_object(
          'label1', jsonb_build_object('key', 'disputes.signalLabel.payment_auth'),
          'label2', 'empty',
          'hint', 'delivery confirmation'))))
    when 'weak' then jsonb_build_object('case_strength', jsonb_build_object(
      'overall', 'weak', 'score', 20,
      'strongCount', 0, 'moderateCount', 0, 'supportingCount', 3,
      'heroVariant', 'hard_to_win',
      'strengthReasonI18n', jsonb_build_object(
        'key', 'disputes.strengthReason.weak.supportingOnly',
        'params', jsonb_build_object('family', 'fraud', 'decisive', 'Delivery confirmation'))))
    else '{}'::jsonb
  end,
  '[]'::jsonb
from ins_disputes d
join spec s on d.dispute_gid = 'gid://shopify/ShopifyPaymentsDispute/' || s.gid_suffix;
