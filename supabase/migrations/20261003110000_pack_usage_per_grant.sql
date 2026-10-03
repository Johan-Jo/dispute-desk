-- Pack accounting: every pack use is charged to the ONE grant it drew from.
--
-- The old `pack_balance` view was (unexpired grants) − (ALL usage, ever). An
-- expired monthly grant dropped out of the first term while the packs used
-- against it stayed in the second, so last month's usage was deducted again
-- from this month's allowance (blume-box, 2026-10-03: 19 packs short). The
-- same netting let an unexpiring grant carry forward indefinitely.
--
-- New model: `pack_usage_events.ledger_id` names the grant a use consumed.
-- A grant's remainder dies with it at `expires_at`, and so does the usage
-- charged to it. Nothing rolls over; nothing is charged twice.

alter table pack_usage_events
  add column if not exists ledger_id uuid null
    references pack_credits_ledger(id) on delete set null;

create index if not exists idx_pack_usage_ledger on pack_usage_events(ledger_id);

-- ── Data repair that must precede the backfill ──────────────────────────
-- A "void + reissue" pair was how a grant's expiry got extended under the
-- netting model (−N expiring with the original, +N with the new date). Per
-- grant, that reads as a fresh N on top of the original. Collapse it into
-- what it meant: the original grant, with the later expiry.
update pack_credits_ledger p
   set expires_at = r.expires_at
  from pack_credits_ledger r
 where r.shop_id = p.shop_id
   and r.reference like 'promo_30day_extension_reissue_%'
   and p.reference like 'promo_30day_free_100packs_%';

delete from pack_credits_ledger d
 where (d.reference like 'promo_30day_extension_void_%'
        or d.reference like 'promo_30day_extension_reissue_%')
   and exists (
     select 1 from pack_credits_ledger p
      where p.shop_id = d.shop_id
        and p.reference like 'promo_30day_free_100packs_%'
   );

-- ── Which grant does a use at time `p_at` draw from? ────────────────────
-- Soonest-to-expire first, so packs that are about to lapse are spent
-- before ones that are not. Only grants that were live at `p_at` qualify.
create or replace function pick_pack_grant(
  p_shop_id uuid,
  p_at timestamptz,
  p_packs integer default 1
) returns uuid
language sql
stable
set search_path = public
as $$
  select c.id
    from pack_credits_ledger c
   where c.shop_id = p_shop_id
     and c.packs > 0
     and c.created_at <= p_at
     and (c.expires_at is null or c.expires_at > p_at)
     and c.packs - coalesce(
           (select sum(u.packs) from pack_usage_events u where u.ledger_id = c.id),
           0
         ) >= p_packs
   order by c.expires_at asc nulls last, c.created_at asc, c.id
   limit 1
$$;

-- ── Backfill: replay history in order ───────────────────────────────────
-- A use with no grant live at the time stays unstamped and counts against
-- nothing (it predates the ledger, or its grant has since been removed).
do $$
declare
  ev record;
  g uuid;
begin
  for ev in
    select id, shop_id, created_at, packs
      from pack_usage_events
     where ledger_id is null
     order by created_at, id
  loop
    g := pick_pack_grant(ev.shop_id, ev.created_at, ev.packs);
    if g is not null then
      update pack_usage_events set ledger_id = g where id = ev.id;
    end if;
  end loop;
end $$;

-- ── blume-box: withdraw the 200-pack admin grant (2026-10-03) ───────────
-- Runs after the backfill so the 80 uses it absorbed in July are released
-- with it (on delete set null) instead of landing on the monthly allowance.
delete from pack_credits_ledger
 where reference = 'admin-grant:blume-box:200-free-packs';

-- ── New uses are stamped on insert ──────────────────────────────────────
-- A trigger rather than an RPC so every writer is covered, including code
-- deployed before this migration. The per-shop advisory lock serialises
-- concurrent consumers so a grant can never be over-drawn.
create or replace function stamp_pack_usage_grant() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ledger_id is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.shop_id::text, 0));
  new.ledger_id := pick_pack_grant(new.shop_id, coalesce(new.created_at, now()), new.packs);
  if new.ledger_id is null then
    raise exception 'PACK_LIMIT_REACHED: shop % has no live pack grant with capacity', new.shop_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_pack_usage_grant on pack_usage_events;
create trigger trg_stamp_pack_usage_grant
  before insert on pack_usage_events
  for each row execute function stamp_pack_usage_grant();

-- ── Views ───────────────────────────────────────────────────────────────
create or replace view pack_grant_balance
with (security_invoker = true) as
select
  c.id as ledger_id,
  c.shop_id,
  c.source,
  c.packs,
  c.expires_at,
  c.created_at,
  c.reference,
  (c.expires_at is null or c.expires_at > now()) as live,
  coalesce(u.used, 0)::bigint as used_packs,
  (c.packs - coalesce(u.used, 0))::bigint as remaining_packs
from pack_credits_ledger c
left join lateral (
  select sum(e.packs) as used from pack_usage_events e where e.ledger_id = c.id
) u on true;

-- Same columns as before; a shop whose grants have all expired still gets
-- a row (0 remaining) so the low-credit banner keeps working.
create or replace view pack_balance
with (security_invoker = true) as
select
  g.shop_id,
  coalesce(sum(g.remaining_packs) filter (where g.live), 0)::bigint as remaining_packs,
  coalesce(sum(g.packs) filter (where g.live), 0)::bigint as total_credits,
  coalesce(sum(g.used_packs) filter (where g.live), 0)::bigint as total_used
from pack_grant_balance g
group by g.shop_id;

-- ── billing_cycle_started_at never advanced on renewal ──────────────────
-- It stayed at the original subscription date. The reconciler now moves it
-- when it grants a cycle's packs; bring existing rows up to date.
update plan_entitlements e
   set billing_cycle_started_at = g.created_at
  from (
    select distinct on (shop_id) shop_id, created_at
      from pack_credits_ledger
     where source = 'monthly_included'
       and expires_at > now()
     order by shop_id, created_at desc
  ) g
 where g.shop_id = e.shop_id
   and (e.billing_cycle_started_at is null or e.billing_cycle_started_at < g.created_at);
