-- Of disputes marked submitted_confirmed, how many were decided BEFORE the shop installed?
select
  case when d.closed_at < s.created_at then 'decided before install'
       when d.closed_at is null then 'still open'
       else 'decided after install' end as era,
  count(*) as disputes,
  count(*) filter (where d.submission_state='submitted_confirmed') as marked_submitted,
  count(dp.id) as has_defence_pkg
from disputes d
join shops s on s.id=d.shop_id
left join defence_packages dp on dp.dispute_id=d.id
where d.normalized_status in ('won','lost')
group by 1 order by disputes desc;
