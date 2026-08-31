with analyzable as (
  select distinct d.id, d.shop_id, d.reason, d.final_outcome, d.order_gid,
         d.network_reason_code, d.submission_state, d.evidence_saved_to_shopify_at, d.submitted_at
  from disputes d
  join defence_packages dp on dp.dispute_id = d.id and dp.submitted_at is not null
  where d.final_outcome in ('won','lost')
)
select
  s.shop_domain,
  a.reason,
  a.final_outcome,
  coalesce(o.payment_gateway,'(no order row)')          as gateway,
  count(*)                                              as n,
  count(*) filter (where a.network_reason_code is not null) as with_net_code,
  count(*) filter (where a.evidence_saved_to_shopify_at is not null) as saved_flag,
  count(distinct a.submission_state)                    as distinct_submission_states
from analyzable a
join shops s on s.id = a.shop_id
left join shopify_orders o
  on o.shop_id = a.shop_id
 and o.shopify_order_id = a.order_gid
group by 1,2,3,4
order by n desc;
