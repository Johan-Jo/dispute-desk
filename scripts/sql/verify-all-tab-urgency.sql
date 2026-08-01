-- Replica of the fixed unfiltered "All status" + urgency sort request:
-- ORDER BY closed_at DESC NULLS FIRST, due_at ASC NULLS LAST, created_at DESC
select
  d.order_name,
  d.normalized_status,
  d.due_at::date as due,
  d.closed_at::date as closed,
  d.final_outcome
from disputes d
join shops s on s.id = d.shop_id
where s.shop_domain = 'blume-box.myshopify.com'
order by d.closed_at desc nulls first, d.due_at asc nulls last, d.created_at desc
limit 10;
