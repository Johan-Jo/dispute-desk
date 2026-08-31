select
  count(*) as packs_with_device_section,
  count(*) filter (where sec->'value' ? 'ipCity' or sec->'value' ? 'city') as has_city_field,
  (select jsonb_pretty(s2->'value')
     from evidence_packs p2, jsonb_array_elements(
       case when jsonb_typeof(p2.pack_json)='array' then p2.pack_json else '[]'::jsonb end) s2
    where s2->>'fieldKey' like '%ip%' or s2->>'fieldKey' like '%location%'
    limit 1) as sample
from evidence_packs p, jsonb_array_elements(
       case when jsonb_typeof(p.pack_json)='array' then p.pack_json else '[]'::jsonb end) sec
where sec->>'fieldKey' like '%ip%' or sec->>'fieldKey' like '%location%';
