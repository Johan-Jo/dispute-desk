-- Not-as-described plan, PR 0 (read-only). Does each installed shop's
-- newest offline session carry `read_products`? Missing = the product
-- collector would return `inaccessible` for that shop.
-- Run: npm run db:query:prod -- --file scripts/sql/product-scope-grants.sql --output table
with latest as (
  select distinct on (ss.shop_id) ss.shop_id, ss.scopes, ss.created_at
  from shop_sessions ss
  where ss.session_type = 'offline' and ss.user_id is null
  order by ss.shop_id, ss.created_at desc
)
select s.shop_domain,
       (s.uninstalled_at is null) as installed,
       l.created_at::date as session_created,
       coalesce(l.scopes like '%read_products%', false) as has_read_products,
       (select count(*) from disputes d
         where d.shop_id = s.id and d.reason = 'PRODUCT_UNACCEPTABLE') as nad_disputes_all_time
from shops s
left join latest l on l.shop_id = s.id
where s.uninstalled_at is null
order by nad_disputes_all_time desc, s.shop_domain;
