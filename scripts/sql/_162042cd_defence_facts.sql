select dp.id, dp.status, dp.created_at, dp.updated_at, jsonb_pretty(f) as acct_fact
from defence_packages dp, jsonb_array_elements(dp.facts_json::jsonb) f
where dp.dispute_id = '162042cd-e256-443b-8c11-da9ad507f039'
  and f->'value'->>'fieldKey' = 'customer_account_info';
