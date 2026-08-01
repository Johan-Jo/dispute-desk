-- Stratified sample for the case-strength parity harness.
--
-- docs/plans/case-strength-gates-object.plan.md §6.1. Emits ONE JSON
-- array so the replay script can consume it verbatim:
--
--   npm run db:query:dev -- --file scripts/sql/case-strength-parity-sample.sql \
--     > <scratchpad>/case-strength-sample.json
--   node scripts/case-strength-parity.mjs --input <scratchpad>/case-strength-sample.json
--
-- Never pipe this through `tail` — it is one row, and truncating from
-- the top turns the answer into nothing (CLAUDE.md non-negotiable #2).
--
-- Strata (plan §6.1). Each row carries its stratum so the script can
-- report shortfalls instead of silently "covering" a gate with 0 cases:
--   recent           50  most recent packs
--   gate_coverage     3  Shopify Protect coverage recorded
--   gate_fatal_loss   3  fatal-loss triggered
--   gate_risk          3  risk-weakness triggered
--   gate_credit        3  credit-already-issued recorded
--   multi_gate         5  two or more gate blocks present
--   no_gates          10  no gate block at all
--   incident           1  blume-box 162042cd, the case that motivated this
--
-- `name_mismatch` is derived at score time from the AVS payload, not
-- persisted as a block, so it has no stratum here; the script derives it
-- from pack_json sections exactly as the production call sites do.

with base as (
  select
    p.id                as pack_id,
    p.dispute_id,
    p.created_at,
    d.reason,
    d.customer_display_name,
    p.checklist_v2,
    p.pack_json -> 'sections'               as sections,
    p.pack_json -> 'coverage'               as coverage,
    p.pack_json -> 'fatal_loss'             as fatal_loss,
    p.pack_json -> 'risk_weakness'          as risk_weakness,
    p.pack_json -> 'credit_already_issued'  as credit_already_issued,
    p.pack_json -> 'case_strength'          as persisted_case_strength
  from evidence_packs p
  join disputes d on d.id = p.dispute_id
  where p.checklist_v2 is not null
    and jsonb_array_length(coalesce(p.checklist_v2, '[]'::jsonb)) > 0
),
flagged as (
  select
    base.*,
    (coverage is not null and coverage->>'state' = 'covered_shopify')    as has_coverage,
    (fatal_loss is not null and (fatal_loss->>'triggered')::bool)        as has_fatal_loss,
    (risk_weakness is not null and (risk_weakness->>'triggered')::bool)  as has_risk,
    (credit_already_issued is not null)                                  as has_credit
  from base
),
counted as (
  select
    flagged.*,
    (has_coverage::int + has_fatal_loss::int + has_risk::int + has_credit::int) as gate_count
  from flagged
),
-- Population per stratum, so a short stratum can be reported as
-- "the database holds N, we took all N" rather than as under-sampling.
population as (
  select
    count(*)                                        as pop_recent,
    count(*) filter (where has_coverage)            as pop_gate_coverage,
    count(*) filter (where has_fatal_loss)          as pop_gate_fatal_loss,
    count(*) filter (where has_risk)                as pop_gate_risk,
    count(*) filter (where has_credit)              as pop_gate_credit,
    count(*) filter (where gate_count >= 2)         as pop_multi_gate,
    count(*) filter (where gate_count = 0)          as pop_no_gates
  from counted
),
sampled as (
  (select 'recent'          as stratum, * from counted order by created_at desc limit 50)
  union all
  (select 'gate_coverage'   as stratum, * from counted where has_coverage    order by created_at desc limit 3)
  union all
  (select 'gate_fatal_loss' as stratum, * from counted where has_fatal_loss  order by created_at desc limit 3)
  union all
  (select 'gate_risk'       as stratum, * from counted where has_risk        order by created_at desc limit 3)
  union all
  (select 'gate_credit'     as stratum, * from counted where has_credit      order by created_at desc limit 3)
  union all
  (select 'multi_gate'      as stratum, * from counted where gate_count >= 2 order by created_at desc limit 5)
  union all
  (select 'no_gates'        as stratum, * from counted where gate_count = 0  order by created_at desc limit 10)
  union all
  (select 'incident'        as stratum, * from counted
     where dispute_id::text like '162042cd%' order by created_at desc limit 1)
)
select jsonb_pretty(
  jsonb_build_object(
    'population', (select to_jsonb(population) from population),
    'rows', (
      select jsonb_agg(to_jsonb(sampled) order by sampled.stratum, sampled.created_at desc)
      from sampled
    )
  )
) as sample;
