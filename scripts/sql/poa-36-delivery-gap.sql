with pk as (
  select dp.id, d.order_gid, d.shop_id, d.order_name,
         (select count(*) from jsonb_array_elements(
            case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
          where f->>'category' in ('delivery_proof','shipping_tracking')) as delivery_facts
  from defence_packages dp join disputes d on d.id=dp.dispute_id
  where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
)
select
  case when pk.delivery_facts > 0 then 'has delivery evidence' else 'NO delivery evidence' end as bucket,
  count(*) as packages,
  count(*) filter (where o.fulfillment_status = 'fulfilled')      as order_fulfilled,
  count(*) filter (where o.fulfillment_status is distinct from 'fulfilled') as not_fulfilled,
  count(*) filter (where o.id is null)                            as no_order_row,
  count(*) filter (where o.delivery_status is not null)           as has_delivery_status
from pk left join shopify_orders o
  on o.shop_id = pk.shop_id and o.shopify_order_id = pk.order_gid
group by 1;
