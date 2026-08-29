select d.reason,
  count(*) filter (where d.normalized_status='won') as won,
  count(*) filter (where d.normalized_status='lost') as lost,
  round(100.0*count(*) filter (where d.normalized_status='won')/count(*),1) as win_pct,
  count(*) as total
from disputes d
left join defence_packages dp on dp.dispute_id=d.id and dp.status='submitted'
where d.normalized_status in ('won','lost') and dp.id is null
group by 1 order by total desc;
