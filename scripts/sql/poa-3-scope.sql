select 'submission_logs rows (all)'        as metric, count(*)::text as v from submission_logs
union all select 'submission_attempts rows (all)', count(*)::text from submission_attempts
union all select 'defence_packages rows (all)',    count(*)::text from defence_packages
union all select 'evidence_packs rows (all)',      count(*)::text from evidence_packs
union all select 'shops installed (not uninstalled)', count(*)::text from shops where uninstalled_at is null
union all select 'gorgias_evidence_messages approved', count(*)::text from gorgias_evidence_messages where review_status='approved'
union all
select 'DECIDED+pkg reason='||d.reason||' / '||d.final_outcome, count(*)::text
from disputes d
join defence_packages dp on dp.dispute_id = d.id
where d.final_outcome in ('won','lost')
group by d.reason, d.final_outcome
order by 1;
