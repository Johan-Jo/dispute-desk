-- Which IP wording generation does each recent package carry?
--   v3 = "country recorded on this order"   (#537, the word "shipping" removed)
--   v2 = "country recorded for shipping"    (#535, still names shipping)
--   v1 = "geolocated to the same country as the billing and shipping address"
select
  left(dp.dispute_id::text, 8) as dispute,
  dp.version,
  dp.status,
  dp.created_at,
  case
    when dp.narrative_json::text ilike '%country recorded on this order%'   then 'v3_current'
    when dp.narrative_json::text ilike '%recorded for shipping%'            then 'v2_names_shipping'
    when dp.narrative_json::text ilike '%billing and shipping address%'     then 'v1_retired'
    else 'no_ip_sentence'
  end as ip_wording
from defence_packages dp
where dp.created_at >= '2026-08-11 00:00:00+00'
  and dp.narrative_json is not null
order by dp.created_at desc;
