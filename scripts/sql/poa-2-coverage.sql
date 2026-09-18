with decided as (
  select d.* from disputes d where d.final_outcome in ('won','lost')
),
pkg as (
  select dp.dispute_id,
         count(*)                                                as pkgs,
         count(*) filter (where dp.submitted_at is not null)      as pkgs_submitted,
         count(*) filter (where dp.pdf_path is not null)          as pkgs_with_pdf,
         count(*) filter (where dp.evidence_hash is not null)     as pkgs_with_hash
  from defence_packages dp group by 1
),
ep as (
  select p.dispute_id,
         count(*)                                                    as epacks,
         count(*) filter (where p.saved_to_shopify_at is not null)    as epacks_saved,
         count(*) filter (where p.pdf_path is not null)               as epacks_pdf
  from evidence_packs p group by 1
),
sl as (
  select dispute_id,
         count(*)                                              as logs,
         count(*) filter (where confirmation_id is not null)    as logs_confirmed
  from submission_logs group by 1
),
sa as (select dispute_id, count(*) as attempts from submission_attempts group by 1)
select
  decided.final_outcome,
  count(*)                                                              as decided_n,
  count(*) filter (where decided.submitted_at is not null)              as d_submitted_at,
  count(*) filter (where decided.evidence_saved_to_shopify_at is not null) as d_saved_to_shopify,
  count(*) filter (where coalesce(pkg.pkgs,0)      > 0)                 as has_defence_pkg,
  count(*) filter (where coalesce(pkg.pkgs_submitted,0) > 0)            as defence_pkg_submitted,
  count(*) filter (where coalesce(pkg.pkgs_with_pdf,0)  > 0)            as defence_pkg_pdf,
  count(*) filter (where coalesce(pkg.pkgs_with_hash,0) > 0)            as defence_pkg_hash,
  count(*) filter (where coalesce(ep.epacks,0)     > 0)                 as has_evidence_pack,
  count(*) filter (where coalesce(ep.epacks_saved,0) > 0)               as evidence_pack_saved,
  count(*) filter (where coalesce(sl.logs,0)       > 0)                 as has_submission_log,
  count(*) filter (where coalesce(sl.logs_confirmed,0) > 0)             as submission_confirmed,
  count(*) filter (where coalesce(sa.attempts,0)   > 0)                 as has_submission_attempt,
  count(*) filter (where decided.network_reason_code is not null)       as has_network_code
from decided
left join pkg on pkg.dispute_id = decided.id
left join ep  on ep.dispute_id  = decided.id
left join sl  on sl.dispute_id  = decided.id
left join sa  on sa.dispute_id  = decided.id
group by 1 order by 1;
