-- Q2 / window-open verification for the AVS citation plan.
-- Closure is submission_state='submitted_confirmed' (backed by Shopify
-- evidenceSentOn), NOT saved_to_shopify. Re-run before relying on any row.
select d.order_name, d.network_reason_code, d.status, d.due_at,
  d.due_at > now() as window_open,
  round(extract(epoch from (d.due_at - now()))/3600, 1) as hours_to_due,
  d.evidence_saved_to_shopify_at, d.submitted_at, d.submission_state,
  d.normalized_status,
  (select dp.version from defence_packages dp where dp.dispute_id=d.id and dp.submitted_at is not null order by dp.submitted_at desc limit 1) as version_saved,
  (select count(*) from defence_packages dp2 where dp2.dispute_id=d.id
     and dp2.narrative_json::text ilike '%billing address matched%') as pkgs_with_standalone_avs
from disputes d
where d.shop_id='6648353c-422a-4ee5-8bba-d75fee284b09'
  and d.order_name in ('#347617','#345459');
