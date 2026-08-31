with pk as (
  select dp.id, d.order_gid, d.shop_id,
         (select count(*) from jsonb_array_elements(
            case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
          where f->>'category' in ('delivery_proof','shipping_tracking')) as delivery_facts
  from defence_packages dp join disputes d on d.id=dp.dispute_id
  where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
)
select case when pk.delivery_facts > 0 then 'has delivery' else 'NO delivery' end as bucket,
       coalesce(o.fulfillment_status,'(null)') as fulfillment_status,
       count(*) as n,
       count(*) filter (where o.fulfilled_at is not null) as has_fulfilled_at,
       count(*) filter (where exists (select 1 from shopify_fulfillment_trackings t
                                       where t.shop_id=o.shop_id and t.shopify_order_id=o.shopify_order_id)) as has_tracking_row
from pk left join shopify_orders o
  on o.shop_id=pk.shop_id and o.shopify_order_id=pk.order_gid
group by 1,2 order by 1,3 desc;
