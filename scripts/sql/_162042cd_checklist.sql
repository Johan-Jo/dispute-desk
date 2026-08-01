select string_agg(c->>'field', ', ' order by c->>'field') as checklist_fields
from evidence_packs ep, jsonb_array_elements(ep.checklist_v2::jsonb) c
where ep.dispute_id = '162042cd-e256-443b-8c11-da9ad507f039';
