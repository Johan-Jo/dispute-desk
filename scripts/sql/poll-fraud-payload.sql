-- Poll the dispute 7f8247d3 pack payload to confirm the rebuild has
-- landed and negativeFacts is now populated.
select
  ep.updated_at,
  jsonb_path_query(
    ep.pack_json::jsonb,
    '$.sections[*] ? (@.fieldsProvided[*] == "fraud_risk_screening") . data'
  ) as fraud_data
from evidence_packs ep
where ep.dispute_id = '7f8247d3-4073-4258-bfb5-57897abcd00b'
order by ep.created_at desc
limit 1;
