select dp.id, dp.status, jsonb_pretty(f) as refund_fact
from defence_packages dp, jsonb_array_elements(dp.facts_json::jsonb) f
where dp.dispute_id = '162042cd-e256-443b-8c11-da9ad507f039'
  and dp.status = 'draft'
  and f->>'category' = 'refund_record';
