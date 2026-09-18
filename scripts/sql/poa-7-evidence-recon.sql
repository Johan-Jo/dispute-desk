with analyzable as (
  select d.id, d.shop_id, min(dp.submitted_at) as first_submitted
  from disputes d
  join defence_packages dp on dp.dispute_id=d.id and dp.submitted_at is not null
  where d.final_outcome in ('won','lost')
  group by 1,2
)
select
  count(*)                                                              as analyzable_disputes,
  count(*) filter (where g.any_msg   > 0)                               as with_any_gorgias,
  count(*) filter (where g.approved_pre > 0)                            as with_approved_pre_submission,
  count(*) filter (where f.facts     > 0)                               as with_defence_facts,
  count(*) filter (where m.manual    > 0)                               as with_manual_evidence,
  count(*) filter (where e.events    > 0)                               as with_lifecycle_events,
  count(*) filter (where q.quals     > 0)                               as with_qualification,
  count(*) filter (where pol.snaps   > 0)                               as with_policy_snapshot
from analyzable a
left join lateral (select count(*) as any_msg,
         count(*) filter (where gm.review_status='approved' and gm.approved_at < a.first_submitted) as approved_pre
  from gorgias_evidence_messages gm where gm.dispute_id=a.id) g on true
left join lateral (select count(*) as facts from defence_evidence_facts df
  join defence_packages dp2 on dp2.id=df.package_id where dp2.dispute_id=a.id) f on true
left join lateral (select count(*) as manual from defence_manual_evidence dm
  join defence_packages dp3 on dp3.id=dm.package_id where dp3.dispute_id=a.id) m on true
left join lateral (select count(*) as events from dispute_events de where de.dispute_id=a.id) e on true
left join lateral (select count(*) as quals from dispute_qualifications dq where dq.dispute_id=a.id) q on true
left join lateral (select count(*) as snaps from policy_snapshots ps where ps.shop_id=a.shop_id) pol on true;
