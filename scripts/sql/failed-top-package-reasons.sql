-- Why the newest defence package failed, for every open dispute whose newest
-- package is failed while an earlier version was validation ok + PDF.
select
  s.shop_domain,
  d.dispute_gid,
  d.due_at,
  ae.created_at,
  ae.event_payload -> 'version' as version,
  jsonb_path_query_array(ae.event_payload, '$.validationErrors[*].rule') as rules,
  jsonb_path_query_array(ae.event_payload, '$.validationErrors[*].section') as sections
from audit_events ae
join disputes d on d.id = ae.dispute_id
join shops s on s.id = d.shop_id
where ae.event_type = 'defence_package_validation_failed'
  and d.evidence_saved_to_shopify_at is null
  and ae.created_at > now() - interval '30 days'
order by ae.created_at desc
limit 60;
