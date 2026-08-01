select ep.id, ep.status, ep.created_at, ep.updated_at,
       jsonb_pretty(ep.pack_json::jsonb->'case_strength') as strength,
       ep.pack_json::jsonb->'fatal_loss'->>'reason' as fatal,
       jsonb_pretty(ep.pack_json::jsonb->'risk_weakness') as risk,
       (select jsonb_pretty(sec->'data')
          from jsonb_array_elements(ep.pack_json::jsonb->'sections') sec
         where sec->'labelToken'->>'key' = 'packs.section.customerAccountDetails') as acct
from evidence_packs ep
where ep.dispute_id = '0f53431d-177c-46b7-b199-e7a766f28a88';
