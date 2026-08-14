-- Class check: open disputes whose TOP defence package is failed/no-PDF while an
-- earlier version was validation_status='ok' with a PDF (i.e. a rebuild replaced
-- a fileable package with an unfileable one).
with ranked as (
  select
    dp.dispute_id,
    dp.version,
    dp.status,
    dp.validation_status,
    dp.pdf_path,
    dp.created_at,
    row_number() over (partition by dp.dispute_id order by dp.version desc) as rn
  from defence_packages dp
),
top as (
  select * from ranked where rn = 1
)
select
  s.shop_domain,
  d.dispute_gid,
  d.reason,
  d.due_at,
  d.status,
  top.version as top_version,
  top.status as top_status,
  top.validation_status as top_validation,
  (top.pdf_path is not null) as top_has_pdf,
  top.created_at as top_created_at,
  (
    select max(r2.version) from ranked r2
    where r2.dispute_id = top.dispute_id
      and r2.validation_status = 'ok'
      and r2.pdf_path is not null
  ) as last_good_version
from top
join disputes d on d.id = top.dispute_id
join shops s on s.id = d.shop_id
where (top.validation_status is distinct from 'ok' or top.pdf_path is null)
  and exists (
    select 1 from ranked r3
    where r3.dispute_id = top.dispute_id
      and r3.version < top.version
      and r3.validation_status = 'ok'
      and r3.pdf_path is not null
  )
  and d.evidence_saved_to_shopify_at is null
order by d.due_at nulls last;
