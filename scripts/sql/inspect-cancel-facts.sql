-- Inspect facts_json/fact_sentiments for the most recent risk assessments
-- that recommended CANCEL or REJECT — so we know exactly what Shopify
-- returns on the negative path. Used to design the "Kept internal" reason
-- text and the help-article parameters table.
select
  shopify_order_id,
  provider,
  risk_level,
  recommendation,
  assessed_at,
  jsonb_pretty(facts_json::jsonb) as facts_json_pretty,
  fact_sentiments
from shopify_order_risk_assessments
where upper(coalesce(recommendation, '')) in ('CANCEL', 'REJECT', 'INVESTIGATE')
   or upper(coalesce(risk_level, '')) in ('HIGH', 'MEDIUM')
order by assessed_at desc nulls last
limit 5;
