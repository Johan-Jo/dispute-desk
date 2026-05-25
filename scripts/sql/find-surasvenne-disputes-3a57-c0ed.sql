-- The short id "#xxxx" in the embedded UI is order_gid's last 4 chars when order_name is null.
-- Find disputes for surasvenne whose order_gid ends in 3a57 or c0ed.
select
  d.id,
  d.dispute_gid,
  d.order_gid,
  d.order_name,
  d.amount,
  d.reason,
  d.normalized_status,
  d.due_at,
  d.created_at
from disputes d
join shops s on s.id = d.shop_id
where s.shop_domain = 'surasvenne.myshopify.com'
  and (
       d.order_gid ilike '%3a57'
    or d.order_gid ilike '%c0ed'
  )
order by d.created_at desc;
