-- Restore per-reason automation the collapse vote switched off.
--
-- Reads `setup_rules_pre_collapse_20260729` (captured by 20260727110000, which
-- sorts before the collapse) and re-expresses, as group rows in the NEW model,
-- any per-reason mode that the store-wide switch does not already give the
-- shop. Runs after 20260729010000 so it composes with — rather than races —
-- the legacy conversion.
--
-- The shape of the repair:
--
--   pre-collapse:  pack:fraud=auto … pack:duplicate=auto, fallback=review
--   post-collapse: fallback=review                       ← automation gone
--   post-restore:  fallback=review + group:fraud=auto … group:duplicate=auto
--
-- The fallback stays `review` because that IS what the merchant's catch-all
-- said. Only the per-reason intent is restored, and it lands in exactly the
-- rows /app/rules renders — so the merchant can now see and edit what was
-- previously invisible tier-1 configuration.
--
-- ON DEV this is a no-op: the snapshot tables are empty there.

begin;

-- ── 1) Re-derive the group mapping from the snapshot ───────────────────────
-- The CASE mirrors 20260729010000 exactly, with ONE addition: the snapshot was
-- taken before 20260728160000 normalised the spelling, so it still holds
-- Shopify's non-existent single-L `SUBSCRIPTION_CANCELED`. Left unhandled,
-- blume-box's subscription row would map to null and be silently dropped —
-- the very failure mode this file exists to prevent.
create temporary table _dd_restore_target on commit drop as
with snap as (
  select
    s.shop_id,
    s.name,
    s.priority,
    s.match -> 'reason' as reasons,
    case
      when lower(s.action ->> 'mode') in ('auto', 'auto_pack', 'automated') then 'auto'
      else 'review'
    end as mode,
    -- Coverage rows (priority 10) outrank pack rows, as the old engine
    -- resolved them.
    case when s.name like '\_\_dd\_setup\_\_:coverage:%' then 0 else 1 end as source_rank
  from public.setup_rules_pre_collapse_20260729 s
  where s.enabled
    and (s.name like '\_\_dd\_setup\_\_:pack:%' or s.name like '\_\_dd\_setup\_\_:coverage:%')
),
mapped as (
  select
    snap.*,
    case
      when snap.reasons @> '["FRAUDULENT"]'::jsonb
        or snap.reasons @> '["UNRECOGNIZED"]'::jsonb            then 'fraud'
      when snap.reasons @> '["PRODUCT_NOT_RECEIVED"]'::jsonb     then 'pnr'
      when snap.reasons @> '["CREDIT_NOT_PROCESSED"]'::jsonb     then 'refund'
      when snap.reasons @> '["DUPLICATE"]'::jsonb                then 'duplicate'
      when snap.reasons @> '["SUBSCRIPTION_CANCELLED"]'::jsonb
        or snap.reasons @> '["SUBSCRIPTION_CANCELED"]'::jsonb    then 'subscription'
      -- Locked group: the engine parks product-family cases even when Strong,
      -- so a row here would be ignored 100% of the time.
      when snap.reasons @> '["PRODUCT_UNACCEPTABLE"]'::jsonb      then null
      -- No GENERAL group by design — the catch-all fallback covers it, and
      -- promoting it would widen every uncovered reason.
      when snap.reasons @> '["GENERAL"]'::jsonb                   then null
      else null
    end as group_id
  from snap
)
select distinct on (shop_id, group_id)
       shop_id, group_id, mode
  from mapped
 where group_id is not null
 order by shop_id, group_id, source_rank, priority;

-- ── 2) Only shops whose automation was actually RUNNING ────────────────────
-- `auto_save_enabled` was the gate. A shop with auto rules and a null/false
-- gate never auto-saved anything, so the collapse takes nothing away from it —
-- and writing groups + flipping the gate would START automation for a merchant
-- who has never seen it run. On prod that is `sharpdesk` (fraud + INR on auto,
-- gate null, Scale plan). Deliberately excluded: preserving observed behaviour
-- is the promise, not honouring configuration that never took effect.
create temporary table _dd_restore_shops on commit drop as
select shop_id
  from public.shop_auto_save_pre_collapse_20260729
 where auto_save_enabled is true;

-- ── 3) Write only what the store switch does not already provide ───────────
-- A group row that merely repeats the switch is noise: absence already means
-- "inherit". We write a row only where the pre-collapse mode DIFFERS from the
-- post-collapse switch, which is precisely the behaviour the vote dropped.
insert into public.rules (shop_id, enabled, name, match, action, priority)
select
  t.shop_id,
  true,
  '__dd_setup__:group:' || t.group_id,
  jsonb_build_object('reason', gr.reasons),
  jsonb_build_object('mode', t.mode, 'pack_template_id', null),
  50
from _dd_restore_target t
join _dd_restore_shops live on live.shop_id = t.shop_id
join (
  values
    ('fraud',        '["FRAUDULENT", "UNRECOGNIZED"]'::jsonb),
    ('pnr',          '["PRODUCT_NOT_RECEIVED"]'::jsonb),
    ('refund',       '["CREDIT_NOT_PROCESSED"]'::jsonb),
    ('duplicate',    '["DUPLICATE"]'::jsonb),
    ('subscription', '["SUBSCRIPTION_CANCELLED"]'::jsonb)
) as gr(group_id, reasons) on gr.group_id = t.group_id
join public.rules f
  on f.shop_id = t.shop_id
 and f.name = '__dd_setup__:fallback:default'
where t.mode <> (case when f.action ->> 'mode' = 'auto' then 'auto' else 'review' end)
  -- `rules` has no unique index on (shop_id, name), and 20260729010000 may
  -- have written a group row already on a database where the legacy rows
  -- survived. Never write a second one.
  and not exists (
        select 1 from public.rules x
         where x.shop_id = t.shop_id
           and x.name = '__dd_setup__:group:' || t.group_id
      );

-- ── 4) Put the auto-save gate back in step with the model ──────────────────
-- The new derivation is `mode = auto OR any group = auto`
-- (lib/rules/storeAutomation.ts → deriveAutoSaveEnabled). The collapse set the
-- flag false for these shops when it read their switch as review; with the
-- groups restored, false would leave the rows in place and block every one of
-- them — automation that renders perfectly and does nothing. This restores the
-- value these shops already had; it never enables a shop that was off.
update public.shop_settings s
   set auto_save_enabled = true,
       updated_at = now()
  from _dd_restore_shops live
 where s.shop_id = live.shop_id
   and s.auto_save_enabled is distinct from true
   and exists (
         select 1 from public.rules r
          where r.shop_id = live.shop_id
            and r.name like '\_\_dd\_setup\_\_:group:%'
            and r.enabled
            and r.action ->> 'mode' = 'auto'
       );

-- ── 5) Verify, and refuse to commit a half-repair ──────────────────────────
-- Every reason that resolved to auto before the collapse must resolve to auto
-- now — via the switch or via a restored group. Anything else means a live
-- merchant lost automation, which is the entire failure this file prevents.
do $$
declare
  regressions text;
begin
  select string_agg(format('%s/%s', sh.shop_domain, t.group_id), ', ')
    into regressions
    from _dd_restore_target t
    join _dd_restore_shops live on live.shop_id = t.shop_id
    join public.shops sh on sh.id = t.shop_id
    left join public.rules f
      on f.shop_id = t.shop_id and f.name = '__dd_setup__:fallback:default'
    left join public.rules g
      on g.shop_id = t.shop_id
     and g.name = '__dd_setup__:group:' || t.group_id
     and g.enabled
   where t.mode = 'auto'
     and coalesce(g.action ->> 'mode', f.action ->> 'mode') is distinct from 'auto';

  if regressions is not null then
    raise exception
      'Automation still lost after restore for: %. Refusing to commit.', regressions;
  end if;
end $$;

-- The gate must agree with the rows, or the restored groups are decoration.
do $$
declare
  gated text;
begin
  select string_agg(sh.shop_domain, ', ')
    into gated
    from _dd_restore_shops live
    join public.shops sh on sh.id = live.shop_id
    left join public.shop_settings ss on ss.shop_id = live.shop_id
   where exists (
           select 1 from public.rules r
            where r.shop_id = live.shop_id
              and r.name like '\_\_dd\_setup\_\_:group:%'
              and r.enabled
              and r.action ->> 'mode' = 'auto'
         )
     and ss.auto_save_enabled is distinct from true;

  if gated is not null then
    raise exception
      'Auto groups restored but auto_save_enabled still off for: %.', gated;
  end if;
end $$;

commit;
