-- Grant whj8db-1q 20 free packs (requested in-chat by Johan, 2026-10-09).
-- Plan stays 'free'; no expiry. The shop burned its 5 free_lifetime packs within
-- an hour of install and 14 further builds failed at consume with remaining=0.
with shop as (
  select id from shops
   where id = 'd595d90a-8130-4995-84e9-c8dd59db022b'
     and shop_domain = 'whj8db-1q.myshopify.com'
), grant_row as (
  insert into pack_credits_ledger (shop_id, source, packs, expires_at, reference)
  select id, 'admin_adjustment', 20, null,
         'admin-grant:whj8db-1q:2026-10-09:20-free-packs (approved in-chat by Johan)'
    from shop
   where not exists (
     select 1 from pack_credits_ledger
      where reference = 'admin-grant:whj8db-1q:2026-10-09:20-free-packs (approved in-chat by Johan)')
  returning id, shop_id, packs
), audit as (
  insert into audit_events (shop_id, actor_type, event_type, event_payload)
  select shop_id, 'system', 'admin_override',
         jsonb_build_object('admin', true, 'grant', jsonb_build_object('packs', 20, 'source', 'admin_adjustment', 'ledger_id', id))
    from grant_row
  returning id
)
select (select packs from grant_row) as packs_granted, (select id from grant_row) as ledger_id,
       (select count(*) from audit) as audit_rows;
