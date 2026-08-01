-- EXACT replica of the request the fixed page sends when landing on
-- /app/disputes?normalized_status=new,action_needed,needs_review :
--   normalized_status IN (...) AND closed_at IS NULL
--   ORDER BY due_at ASC NULLS LAST, created_at DESC  LIMIT 25 (page 1)
select
  d.order_name,
  d.customer_display_name,
  d.normalized_status,
  d.status,
  d.final_outcome,
  d.due_at::date as due,
  d.closed_at is not null as closed
from disputes d
join shops s on s.id = d.shop_id
where s.shop_domain = 'blume-box.myshopify.com'
  and d.normalized_status in ('new','action_needed','needs_review')
  and d.closed_at is null
order by d.due_at asc nulls last, d.created_at desc
limit 25;
