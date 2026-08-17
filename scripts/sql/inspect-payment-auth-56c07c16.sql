-- Why is 11143315649 (#351237) rated strong? Inspect the payment-auth facts.
select jsonb_pretty(
  jsonb_path_query_array(dp.facts_json, '$[*] ? (@.category == "payment_authentication")')
) as payment_facts,
dp.version, dp.prompt_version, dp.status
from defence_packages dp
where dp.dispute_id = '56c07c16-5649-427b-af02-278a9347a69a'
order by dp.version desc limit 1;
