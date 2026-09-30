-- Sanity check for store-patterns-by-shop.sql: what "unshipped at open" is made of.
select s.shop_domain, d.reason, o.fulfillment_status, (o.fulfilled_at is null) no_fulfilled_at,
  count(*) n,
  min(d.initiated_at)::date first_opened, max(d.initiated_at)::date last_opened
from disputes d join shops s on s.id=d.shop_id
join shopify_orders o on o.shop_id=d.shop_id and o.shopify_order_id=d.order_gid
where d.normalized_status='lost' and (o.fulfilled_at is null or o.fulfilled_at > d.initiated_at)
group by 1,2,3,4 order by 1,2,5 desc;
