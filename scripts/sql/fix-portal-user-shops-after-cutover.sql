-- Repoint the surviving portal_user_shops row to the current oi@johan.com.br
-- auth user. The pre-cutover user_id has no row in the new project's auth.users.

update public.portal_user_shops
set user_id = (select id from auth.users where email = 'oi@johan.com.br')
where user_id = '46423efa-cc36-4816-8e94-4c94d0306268'
  and exists (select 1 from auth.users where email = 'oi@johan.com.br');

select p.user_id, p.shop_id, s.shop_domain, u.email
from public.portal_user_shops p
left join public.shops s on s.id = p.shop_id
left join auth.users u on u.id = p.user_id;
