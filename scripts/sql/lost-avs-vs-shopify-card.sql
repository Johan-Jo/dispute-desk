-- The specific loss signals on #349145, matching Shopify's stated reason.
select
  d.order_name, d.network_reason_code,
  f->'value'->>'fieldKey'  as field,
  f->'value'->>'avsResult' as avs,
  f->'value'->>'cvvResult' as cvv,
  f->'value'->>'proofType' as proof,
  f->'value'->>'signedByName' as signed_by,
  f->'value'->>'locationMatch' as ip_match
from disputes d
join defence_packages p on p.dispute_id=d.id and p.status='submitted'
cross join lateral jsonb_array_elements(p.facts_json) f
where d.order_name='#349145'
  and f->'value'->>'fieldKey' in ('avs_cvv_match','delivery_proof','ip_location_check');
