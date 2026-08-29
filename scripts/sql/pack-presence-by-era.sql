-- Are pack rows missing because of deletion, or because they were never created?
-- Split by when the dispute was created.
select
  date_trunc('quarter', d.initiated_at)::date as quarter,
  count(*) as disputes,
  count(*) filter (where d.submission_state='submitted_confirmed') as we_filed,
  count(dp.id) as has_defence_pkg,
  count(ep.id) as has_evidence_pack
from disputes d
left join defence_packages dp on dp.dispute_id=d.id
left join evidence_packs ep on ep.dispute_id=d.id
where d.normalized_status in ('won','lost')
group by 1 order by 1 desc limit 14;
