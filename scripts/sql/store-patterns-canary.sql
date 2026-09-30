-- Canary rows for store-patterns: 3 lost not-received "never shipped" + 3 lost fraud "high risk shipped" on blume-box,
-- plus how many orders anywhere claim a shipped status with no fulfilled_at (would be miscounted as unshipped).
(select 'inr_unshipped' k, right(o.shopify_order_id,14), d.phase, d.initiated_at::date opened, o.created_at_shopify::date ordered, o.fulfillment_status, o.fulfilled_at::date, o.cancelled_at::date, o.risk_recommendation_initial
 from disputes d join shops s on s.id=d.shop_id join shopify_orders o on o.shop_id=d.shop_id and o.shopify_order_id=d.order_gid
 where s.shop_domain='blume-box.myshopify.com' and d.reason='PRODUCT_NOT_RECEIVED' and d.normalized_status='lost' and o.fulfilled_at is null
 order by d.initiated_at desc limit 3)
union all
(select 'fraud_hr_shipped', right(o.shopify_order_id,14), d.phase, d.initiated_at::date, o.created_at_shopify::date, o.fulfillment_status, o.fulfilled_at::date, o.cancelled_at::date, o.risk_recommendation_initial
 from disputes d join shops s on s.id=d.shop_id join shopify_orders o on o.shop_id=d.shop_id and o.shopify_order_id=d.order_gid
 where s.shop_domain='blume-box.myshopify.com' and d.reason='FRAUDULENT' and d.normalized_status='lost' and o.fulfilled_at is not null and upper(o.risk_recommendation_initial) in ('CANCEL','INVESTIGATE')
 order by d.initiated_at desc limit 3)
union all
(select 'shipped_no_ts', fulfillment_status, null, null, null, null, null, null, count(*)::text from shopify_orders
 where fulfilled_at is null and fulfillment_status in ('FULFILLED','PARTIALLY_FULFILLED') group by fulfillment_status);
