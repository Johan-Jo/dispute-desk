-- payment_gateway is NOT the payment method. Compare both, by month.
select
  to_char(date_trunc('month', o.processed_at), 'YYYY-MM') as month,
  count(*) filter (where lower(o.payment_gateway)='paypal')      as gw_paypal,
  count(*) filter (where o.payment_gateway='shopify_payments')   as gw_shopify_pay,
  count(*) filter (where lower(o.payment_method) like '%paypal%') as pm_paypal,
  count(*) filter (where o.payment_method is null)                as pm_null,
  count(*) filter (where o.payment_method is not null
                     and lower(o.payment_method) not like '%paypal%') as pm_other,
  count(*) as total
from shopify_orders o
where o.shop_id='ea035a1b-8aec-4305-ba2b-27713a6aeff3'
  and o.processed_at >= '2026-01-01'
group by 1 order by 1;
