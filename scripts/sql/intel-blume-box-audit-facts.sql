-- Runs the intel_data_quality_audit() aggregation body inline for Blume Box.
-- READ ONLY (SELECT only) — used to validate the Phase A audit against real
-- prod data without deploying the function to prod (prod deploy needs separate
-- per-change approval). Mirrors supabase/migrations/*_intelligence_engine_phase_a.sql.
with sid as (select id as p from shops where shop_domain = 'blume-box.myshopify.com'),
o as (select * from shopify_orders where shop_id = (select p from sid)),
d as (select * from disputes where shop_id = (select p from sid)),
oc as (select count(*)::numeric as n from o),
dc as (select count(*)::numeric as n from d)
select jsonb_pretty(jsonb_build_object(
  'orders', jsonb_build_object(
    'count', (select n from oc),
    'coverage_start', (select min(created_at_shopify) from o),
    'max_processed_at', (select max(processed_at) from o),
    'distinct_currencies', (select count(distinct currency) from o),
    'pct_null_delivery_status', round(100.0*(select count(*) from o where delivery_status is null)/greatest((select n from oc),1),2),
    'pct_has_chargeback_true', round(100.0*(select count(*) from o where has_chargeback)/greatest((select n from oc),1),3)
  ),
  'leakage', jsonb_build_object(
    'median_ingest_lag_hours', (select round(percentile_cont(0.5) within group (
      order by extract(epoch from (first_ingested_at - created_at_shopify))/3600.0)::numeric,1)
      from o where first_ingested_at is not null and created_at_shopify is not null),
    'pct_ingested_within_48h', round(100.0*(select count(*) from o where first_ingested_at - created_at_shopify < interval '48 hours')/greatest((select n from oc),1),2)
  ),
  'disputes', jsonb_build_object(
    'count', (select n from dc),
    'pct_orphan_no_order', round(100.0*(select count(*) from d where order_gid is null)/greatest((select n from dc),1),2),
    'pct_null_phase', round(100.0*(select count(*) from d where phase is null)/greatest((select n from dc),1),2),
    'pct_null_final_outcome', round(100.0*(select count(*) from d where final_outcome is null)/greatest((select n from dc),1),2),
    'count_adjudicated', (select count(*) from d where final_outcome in ('won','partially_won','lost')),
    'count_submitted', (select count(*) from d where submitted_at is not null),
    'pct_network_code_direct_or_derived', round(100.0*(select count(*) from d where network_reason_code_confidence in ('direct','derived'))/greatest((select n from dc),1),2),
    'count_with_outcome_amount', (select count(*) from d where outcome_amount_recovered is not null or outcome_amount_lost is not null),
    'count_with_response_opportunity', (select count(*) from d where initiated_at is not null and due_at is not null)
  )
)) as audit_facts;
