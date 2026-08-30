with dp_dispute as (
  select d.id, d.shop_id, d.reason, d.final_outcome, d.closed_at, d.phase,
         max(dp.submitted_at) as pkg_submitted_at,
         count(dp.id)         as pkgs
  from disputes d
  join defence_packages dp on dp.dispute_id = d.id
  where d.final_outcome in ('won','lost')
  group by 1,2,3,4,5,6
)
select reason, final_outcome,
       count(*)                                                as disputes,
       count(*) filter (where pkg_submitted_at is not null)     as with_submitted_pkg,
       count(*) filter (where closed_at > now() - interval '90 days') as closed_last_90d,
       count(distinct shop_id)                                  as shops
from dp_dispute
group by 1,2
order by disputes desc;
