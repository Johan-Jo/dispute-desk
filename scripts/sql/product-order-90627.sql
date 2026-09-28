-- Not-as-described plan, PR 0 (read-only). Locate the external review's
-- order #90627 (regression fixture only — never refiled).
select s.shop_domain, d.id as dispute_id, d.reason, d.status, d.final_outcome,
       d.due_at, d.order_gid, d.order_name
from disputes d
join shops s on s.id = d.shop_id
where d.order_name in ('#90627', '90627');
