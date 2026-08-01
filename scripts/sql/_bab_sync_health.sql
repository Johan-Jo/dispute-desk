-- Is the sync pipeline for blume-box alive? Latest sync touches + recent sync/reconcile jobs
with s as (select id from shops where shop_domain = 'blume-box.myshopify.com')
select 'latest_dispute_sync' as check, max(last_synced_at)::text as val, count(*)::text as extra
from disputes where shop_id = (select id from s)
union all
select 'sync_health_breakdown', coalesce(sync_health,'null'), count(*)::text
from disputes where shop_id = (select id from s) and closed_at is null
group by 2
union all
select 'recent_jobs_' || job_type || '_' || status, max(created_at)::text, count(*)::text
from jobs
where shop_id = (select id from s)
  and created_at >= now() - interval '4 days'
group by job_type, status;
