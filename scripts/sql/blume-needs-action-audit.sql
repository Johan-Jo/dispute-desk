-- What does the "Needs action" filter (normalized_status IN new,action_needed,needs_review)
-- actually return for blume-box, and are these rows really open?
select
  d.normalized_status,
  d.status,
  d.final_outcome,
  d.closed_at is not null as is_closed,
  d.due_at,
  count(*) as n
from disputes d
join shops s on s.id = d.shop_id
where s.shop_domain = 'blume-box.myshopify.com'
  and d.normalized_status in ('new','action_needed','needs_review')
group by 1,2,3,4,5
order by n desc
limit 40;
