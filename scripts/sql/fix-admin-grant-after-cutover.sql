-- One-shot: repoint the stale internal_admin_grants row at the current
-- oi@johan.com.br auth user. The pre-cutover user_id (46423efa-…) does
-- not exist in this project's auth.users; the new oi@ user was created
-- on 2026-05-29 after the cutover. Run once; idempotent if re-run.

update public.internal_admin_grants
set user_id = (select id from auth.users where email = 'oi@johan.com.br')
where user_id = '46423efa-cc36-4816-8e94-4c94d0306268'
  and exists (select 1 from auth.users where email = 'oi@johan.com.br');

select g.user_id, g.is_active, u.email, u.email_confirmed_at
from public.internal_admin_grants g
join auth.users u on u.id = g.user_id;
