-- Most recent evidence_packs row touching fraud_risk_screening — check
-- whether the persisted section payload already has negativeFacts (post-fix)
-- or still has only positiveFacts:[] (pre-fix, needs regeneration).
select
  ep.id,
  ep.dispute_id,
  ep.created_at,
  ep.updated_at,
  jsonb_path_query(
    ep.pack_json::jsonb,
    '$.sections[*] ? (@.fieldsProvided[*] == "fraud_risk_screening")'
  ) as fraud_screening_section
from evidence_packs ep
where ep.pack_json::jsonb @? '$.sections[*] ? (@.fieldsProvided[*] == "fraud_risk_screening")'
order by ep.created_at desc
limit 5;
