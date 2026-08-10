select job_type, status, count(*) as n, min(created_at) as oldest, max(updated_at) as newest
from jobs
where created_at > now() - interval '30 minutes'
group by job_type, status
order by job_type, status;
