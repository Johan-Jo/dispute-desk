-- Not-as-described PR 1b (read-only). With delivery_proof / shipping_tracking
-- removed from product_unacceptable, what would each dispute's latest package
-- still argue from? A package left with only record context (order record,
-- policies) is skipped by the build (`hasArgumentBeyondRecordContext`).
with pkg as (
  select distinct on (dp.dispute_id) dp.dispute_id, dp.facts_json, dp.status
  from defence_packages dp
  order by dp.dispute_id, dp.version desc
), cats as (
  select p.dispute_id,
         array_agg(distinct f->>'category') filter (where f->>'category' not in ('delivery_proof', 'shipping_tracking')) as remaining,
         bool_or(f->>'category' in ('delivery_proof', 'shipping_tracking')) as had_delivery
  from pkg p, jsonb_array_elements(case when jsonb_typeof(p.facts_json) = 'array' then p.facts_json else '[]' end) f
  group by p.dispute_id
)
select case when d.final_outcome is null and d.closed_at is null then 'open' else 'decided' end as state,
       coalesce(array_to_string(c.remaining, ','), '(nothing)') as remaining_categories,
       count(*) as n,
       count(*) filter (where c.had_delivery) as had_delivery
from disputes d
join cats c on c.dispute_id = d.id
where d.reason = 'PRODUCT_UNACCEPTABLE'
group by 1, 2
order by 1 desc, n desc;
