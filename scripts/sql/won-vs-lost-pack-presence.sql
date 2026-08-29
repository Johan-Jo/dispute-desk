-- Is the missing-pack pattern specific to wins, or true of losses too?
select
  d.normalized_status,
  count(*) as total,
  count(*) filter (where d.submission_state='submitted_confirmed') as we_submitted,
  count(dp.id) as has_defence_pkg,
  count(ep.id) as has_evidence_pack,
  round(100.0*count(dp.id)/nullif(count(*) filter (where d.submission_state='submitted_confirmed'),0),1) as pct_pkg_of_submitted
from disputes d
left join defence_packages dp on dp.dispute_id=d.id and dp.status='submitted'
left join evidence_packs ep on ep.dispute_id=d.id
where d.normalized_status in ('won','lost')
group by 1;
