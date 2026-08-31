-- Who is affected by the tier change: facts that were `supporting` and become
-- `moderate` — i.e. clean same_country with the collector's gate passed.
select
  count(*)                                        as facts_promoted,
  count(distinct dp.dispute_id)                   as disputes_affected,
  count(distinct dp.id)                           as packages_affected,
  count(*) filter (where d.final_outcome is null) as on_OPEN_disputes,
  count(*) filter (where d.final_outcome in ('won','lost')) as on_decided,
  count(distinct d.shop_id)                       as shops
from defence_packages dp
join disputes d on d.id = dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where f->>'category'='ip_location'
  and f->'value'->>'locationMatch' = 'same_country'
  and nullif(f->'value'->>'bankLocationSummary','') is not null;
