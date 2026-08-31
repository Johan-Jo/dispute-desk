select d.id, d.order_name, d.phase,
       d.due_at,
       d.raw_snapshot->>'evidenceSentOn'                    as sent_on,
       d.raw_snapshot->>'evidenceDueBy'                     as raw_due_by,
       d.initiated_at,
       d.shopify_updated_at,
       round(extract(epoch from (
         (d.raw_snapshot->>'evidenceSentOn')::timestamptz - d.due_at))/86400.0, 1) as days_late,
       d.last_synced_at
from disputes d
join defence_packages dp on dp.dispute_id=d.id and dp.submitted_at is not null
where d.final_outcome in ('won','lost')
  and (d.raw_snapshot->>'evidenceSentOn')::timestamptz > d.due_at
order by days_late desc
limit 6;
