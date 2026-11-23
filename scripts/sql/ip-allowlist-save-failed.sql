-- READ-ONLY. Packs whose Shopify save failed recently, with the dispute deadline,
-- so an operator can decide what to re-queue after an IP-allowlist correction.
-- Run: npm run db:query:prod -- --file scripts/sql/ip-allowlist-save-failed.sql --output table
-- Change the interval below to the enforcement window.
--
-- Re-queue only rows where: dispute status is still open (needs_response), due_at is in
-- the future, and saved_to_shopify_at is null. The save_to_shopify handler itself refuses
-- to call Shopify when the response window is closed, and a pack already saved is not
-- re-filed, so a re-queue is safe to repeat.
select
  p.id            as pack_id,
  p.shop_id,
  p.dispute_id,
  p.status        as pack_status,
  p.saved_to_shopify_at,
  d.status        as dispute_status,
  d.due_at,
  (d.due_at - now()) as time_left,
  j.attempts,
  j.max_attempts,
  j.status        as job_status,
  left(j.last_error, 160) as last_error,
  (j.last_error ilike '%shopify-ip-403%' or j.last_error ilike '%HTTP 403%') as looks_like_ip_403
from evidence_packs p
join disputes d on d.id = p.dispute_id
left join lateral (
  select * from jobs
  where job_type = 'save_to_shopify' and entity_id = p.id::text
  order by updated_at desc limit 1
) j on true
where p.status = 'save_failed'
  and p.updated_at > now() - interval '24 hours'
order by d.due_at asc nulls last;
