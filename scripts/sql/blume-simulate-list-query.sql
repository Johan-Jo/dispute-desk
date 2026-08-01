-- Reproduce the EXACT list query the page issues for:
--   normalized_status IN (new,action_needed,needs_review), sort=due_at asc, page 1
-- The API does NOT add a closed filter unless the client passes closed=false.
-- The "Needs action" preset sets activeTab='active' (closed=false) — BUT let's
-- check what page-1 looks like with sort=due_at asc and NO closed filter,
-- which is the bug surface.
select
  d.order_name, d.customer_display_name, d.normalized_status, d.status,
  d.final_outcome, d.closed_at, d.due_at, d.initiated_at
from disputes d
join shops s on s.id = d.shop_id
where s.shop_domain='blume-box.myshopify.com'
  and d.normalized_status in ('new','action_needed','needs_review')
order by d.due_at asc nulls last, d.created_at desc
limit 8;
