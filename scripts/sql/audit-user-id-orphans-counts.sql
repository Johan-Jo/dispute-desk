-- Count orphaned rows in each user-id-bearing table.
-- Orphan = user_id not present in auth.users on this project.

select 'internal_admin_grants' as tbl,
       count(*) as total,
       count(*) filter (where g.user_id not in (select id from auth.users)) as orphans
from public.internal_admin_grants g
union all
select 'portal_user_shops',
       count(*),
       count(*) filter (where p.user_id not in (select id from auth.users))
from public.portal_user_shops p
union all
select 'evidence_packs.approved_by_user_id',
       count(*) filter (where e.approved_by_user_id is not null),
       count(*) filter (where e.approved_by_user_id is not null and e.approved_by_user_id not in (select id from auth.users))
from public.evidence_packs e
union all
select 'reason_template_mappings.updated_by',
       count(*) filter (where r.updated_by is not null),
       count(*) filter (where r.updated_by is not null and r.updated_by not in (select id from auth.users))
from public.reason_template_mappings r;
