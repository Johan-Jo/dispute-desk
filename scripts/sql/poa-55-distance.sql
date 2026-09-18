with f as (
  select d.id as dispute_id, d.reason,
         r.ip_ship_distance_km as km,
         (select fx->'value'->>'locationMatch'
            from jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array'
                                           then dp.facts_json else '[]'::jsonb end) fx
           where fx->>'category'='ip_location' limit 1) as location_match
  from disputes d
  join defence_packages dp on dp.dispute_id=d.id and dp.submitted_at is not null
  left join shopify_orders o on o.shop_id=d.shop_id and o.shopify_order_id=d.order_gid
  left join shopify_order_risk_signals r
    on r.shop_id=d.shop_id and r.shopify_order_id=o.shopify_order_id
  where d.final_outcome in ('won','lost')
)
select coalesce(location_match,'(none)') as location_match,
       count(*)                                        as packages,
       count(*) filter (where km is not null)          as have_distance,
       count(*) filter (where km <= 50)                as within_50km,
       count(*) filter (where km <= 150)               as within_150km,
       round(min(km)::numeric,0) as min_km,
       round(avg(km)::numeric,0) as avg_km,
       round(max(km)::numeric,0) as max_km
from f group by 1 order by packages desc;
