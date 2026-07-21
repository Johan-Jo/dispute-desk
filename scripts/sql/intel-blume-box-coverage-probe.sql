-- Historical Intelligence Engine — Phase A read-only coverage probe for Blume Box.
-- Grounds the data-quality assessment: import completeness, field coverage,
-- temporal-leakage gap (ingest vs order time), dispute outcome coverage.
-- READ ONLY. Run: npx supabase db query --linked --file scripts/sql/intel-blume-box-coverage-probe.sql
with sid as (
  select id from shops where shop_domain = 'blume-box.myshopify.com'
),
o as (
  select * from shopify_orders where shop_id = (select id from sid)
),
d as (
  select * from disputes where shop_id = (select id from sid)
)
-- Shop-level import state
select 1 as ord, 'shop.import_status' as metric,
       coalesce((select historical_import_status from shops where id=(select id from sid)),'(null)') as value
union all
select 2, 'shop.import_progress_pct',
       coalesce((select historical_import_progress_pct::text from shops where id=(select id from sid)),'(null)')
union all
select 3, 'shop.import_orders_total',
       coalesce((select historical_import_orders_total::text from shops where id=(select id from sid)),'(null)')
union all
select 4, 'shop.import_orders_processed',
       coalesce((select historical_import_orders_processed::text from shops where id=(select id from sid)),'(null)')
union all
select 5, 'shop.import_since_date',
       coalesce((select historical_import_since_date::text from shops where id=(select id from sid)),'(null)')
union all
select 6, 'shop.import_scope_granted',
       coalesce((select historical_import_scope_granted from shops where id=(select id from sid)),'(null)')
union all
-- Orders volume + span
select 10, 'orders.count', (select count(*)::text from o)
union all
select 11, 'orders.min_processed_at', (select min(processed_at)::text from o)
union all
select 12, 'orders.max_processed_at', (select max(processed_at)::text from o)
union all
select 13, 'orders.distinct_currencies', (select count(distinct currency)::text from o)
union all
-- Orders field missingness (% null)
select 20, 'orders.pct_null_risk_level_initial',
       (select round(100.0*sum((risk_level_initial is null or risk_level_initial in ('NONE','PENDING'))::int)/greatest(count(*),1),1)::text from o)
union all
select 21, 'orders.pct_null_country',
       (select round(100.0*sum((country is null)::int)/greatest(count(*),1),1)::text from o)
union all
select 22, 'orders.pct_null_payment_gateway',
       (select round(100.0*sum((payment_gateway is null)::int)/greatest(count(*),1),1)::text from o)
union all
select 23, 'orders.pct_null_delivery_status',
       (select round(100.0*sum((delivery_status is null)::int)/greatest(count(*),1),1)::text from o)
union all
select 24, 'orders.pct_null_customer_shopify_id',
       (select round(100.0*sum((customer_shopify_id is null)::int)/greatest(count(*),1),1)::text from o)
union all
select 25, 'orders.pct_has_chargeback_true',
       (select round(100.0*sum((has_chargeback)::int)/greatest(count(*),1),3)::text from o)
union all
-- Temporal leakage: median hours between order creation and first ingest
select 30, 'orders.median_ingest_lag_hours',
       (select round(percentile_cont(0.5) within group (order by extract(epoch from (first_ingested_at - created_at_shopify))/3600.0)::numeric,1)::text from o)
union all
select 31, 'orders.pct_ingested_within_48h_of_order',
       (select round(100.0*sum((first_ingested_at - created_at_shopify < interval '48 hours')::int)/greatest(count(*),1),1)::text from o)
union all
-- Disputes volume + span
select 40, 'disputes.count', (select count(*)::text from d)
union all
select 41, 'disputes.min_initiated_at', (select min(initiated_at)::text from d)
union all
select 42, 'disputes.max_initiated_at', (select max(initiated_at)::text from d)
union all
select 43, 'disputes.pct_null_phase',
       (select round(100.0*sum((phase is null)::int)/greatest(count(*),1),1)::text from d)
union all
select 44, 'disputes.pct_null_final_outcome',
       (select round(100.0*sum((final_outcome is null)::int)/greatest(count(*),1),1)::text from d)
union all
select 45, 'disputes.pct_final_outcome_won_or_lost',
       (select round(100.0*sum((final_outcome in ('won','lost','partially_won'))::int)/greatest(count(*),1),1)::text from d)
union all
select 46, 'disputes.pct_submitted_at_present',
       (select round(100.0*sum((submitted_at is not null)::int)/greatest(count(*),1),1)::text from d)
union all
select 47, 'disputes.pct_network_code_direct_or_derived',
       (select round(100.0*sum((network_reason_code_confidence in ('direct','derived'))::int)/greatest(count(*),1),1)::text from d)
union all
select 48, 'disputes.pct_orphan_no_order_gid',
       (select round(100.0*sum((order_gid is null)::int)/greatest(count(*),1),1)::text from d)
union all
select 49, 'disputes.count_with_outcome_amount',
       (select count(*)::text from d where outcome_amount_recovered is not null or outcome_amount_lost is not null)
order by ord;
