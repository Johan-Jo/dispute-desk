-- Can we classify historical (undefended) disputes from shopify_orders?
-- Join on the numeric order id embedded in dispute.order_gid.
select
  d.normalized_status,
  count(*) as disputes,
  count(o.id) as has_order,
  count(*) filter (where o.delivery_status is not null) as delivery,
  count(*) filter (where o.signed_by_name is not null) as signed,
  count(*) filter (where o.fulfillment_status is not null) as fulfil,
  count(*) filter (where o.risk_recommendation_initial is not null) as risk,
  count(*) filter (where o.three_ds_authenticated is not null) as tds,
  count(*) filter (where o.financial_status is not null) as fin,
  count(*) filter (where o.payment_method is not null) as paymethod
from disputes d
left join defence_packages dp on dp.dispute_id = d.id and dp.status = 'submitted'
left join shopify_orders o
  on o.shop_id = d.shop_id
 and o.shopify_order_id = d.order_gid
where d.normalized_status in ('won','lost') and dp.id is null
group by 1;
