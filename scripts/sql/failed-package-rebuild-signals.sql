-- Do FAILED packages record the signals a "has anything changed?" guard needs?
--   prompt_version  — the generator version that produced the failure
--   evidence_hash   — the evidence the failure was produced from
-- Compared against the CURRENT pack's evidence hash, to see whether a rebuild
-- would in fact be a new attempt rather than a repeat.
select
  left(dp.dispute_id::text, 8)                          as dispute,
  d.order_name,
  dp.version,
  dp.status,
  dp.failure_code,
  dp.prompt_version                                     as failed_prompt_version,
  (dp.evidence_hash is not null)                        as failed_has_evidence_hash,
  dp.created_at                                         as failed_at,
  d.due_at::date                                        as due
from defence_packages dp
join disputes d on d.id = dp.dispute_id
where dp.status = 'failed'
  and dp.version = (
    select max(v.version) from defence_packages v where v.dispute_id = dp.dispute_id
  )
  and d.evidence_saved_to_shopify_at is null
order by d.due_at asc nulls last;
