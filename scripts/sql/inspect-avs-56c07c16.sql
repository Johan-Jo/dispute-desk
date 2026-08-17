-- The verification values behind #351237's "strong" payment_auth signal.
select
  jsonb_pretty(ep.pack_json->'payment_context') as payment_context,
  jsonb_pretty(
    jsonb_path_query_array(
      ep.pack_json->'evidence_model',
      '$.** ? (@.fieldKey == "avs_cvv_match")'
    )
  ) as avs_record
from evidence_packs ep
where ep.dispute_id = '56c07c16-5649-427b-af02-278a9347a69a'
  and ep.status not in ('failed','queued','building')
order by ep.created_at desc limit 1;
