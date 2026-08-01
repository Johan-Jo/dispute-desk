select jsonb_pretty(ep.pack_json::jsonb->'case_strength') as strength,
       ep.pack_json::jsonb->'fatal_loss'->>'triggered' as fatal
from evidence_packs ep
where ep.dispute_id = '162042cd-e256-443b-8c11-da9ad507f039';
