-- Diagnose stuck rebuild for dispute 5e63afa7-af68-4eba-a92f-5ba11605aab7
select d.id, d.dispute_gid, d.status as dispute_status, d.normalized_status, d.reason, d.due_at, d.shop_id
from disputes d
where d.id = '5e63afa7-af68-4eba-a92f-5ba11605aab7';

-- All jobs for this dispute (entity_id), recent first
select j.id, j.job_type, j.status, j.priority, j.attempts, j.max_attempts,
       j.run_at, j.locked_at, j.locked_by, j.created_at, j.updated_at,
       left(coalesce(j.last_error,''), 400) as last_error
from jobs j
where j.entity_id = '5e63afa7-af68-4eba-a92f-5ba11605aab7'
order by j.created_at desc
limit 30;

-- Queue overview for this shop
select j.job_type, j.status, count(*) as n, min(j.created_at) as oldest, max(j.created_at) as newest
from jobs j
where j.shop_id = (select shop_id from disputes where id = '5e63afa7-af68-4eba-a92f-5ba11605aab7')
  and j.status in ('queued','running','failed')
group by j.job_type, j.status
order by j.job_type, j.status;
