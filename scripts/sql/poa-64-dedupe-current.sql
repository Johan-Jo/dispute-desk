-- One current analysis per dispute.
--
-- 48 disputes were re-analysed at the same analyzer version against a better
-- snapshot (the evidence file GID arrived), and the superseding rule only
-- covered LOWER versions, so both rows stayed current: 98 current rows for 50
-- disputes. Keep the newest per dispute, point every earlier one at it.
-- Nothing is deleted.
with ranked as (
  select id, dispute_id,
         row_number() over (
           partition by dispute_id
           order by analyzer_version desc, created_at desc
         ) as rn,
         first_value(id) over (
           partition by dispute_id
           order by analyzer_version desc, created_at desc
         ) as keeper
  from post_outcome_analyses
  where analysis_status <> 'SUPERSEDED'
)
update post_outcome_analyses a
set superseded_by_id = r.keeper,
    analysis_status = 'SUPERSEDED'
from ranked r
where a.id = r.id and r.rn > 1
returning a.id;
