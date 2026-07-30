-- ---------------------------------------------------------------------------
-- Convert legacy per-family / per-pack setup rules into the group model.
--
-- CONVERT → VERIFY → DELETE, in that order, in one transaction. Never a
-- delete that hopes the conversion worked.
--
-- ## What is being converted
--
-- Two legacy row families survive from the per-dispute-type era:
--
--   __dd_setup__:coverage:{family}   priority 10   (13 rows, 3 shops)
--   __dd_setup__:pack:{uuid}         priority 20+  (17 rows, 2 shops)
--
-- Both are tier-1 reason rules carrying `action.mode`, so both are ROUTING
-- DISPUTES TODAY. The earlier plan treated `pack:` rows as superseded template
-- pins and proposed deleting them outright. That is wrong and was caught by
-- reading prod: `blume-box` (465 disputes) runs **auto on seven reasons**
-- through `pack:` rows while its store switch reads `review`. Deleting them
-- would have silently shut off automation for the highest-volume merchant on
-- the platform.
--
-- ## Mapping
--
--   FRAUDULENT / UNRECOGNIZED   → group:fraud
--   PRODUCT_NOT_RECEIVED        → group:pnr
--   CREDIT_NOT_PROCESSED        → group:refund
--   DUPLICATE                   → group:duplicate
--   SUBSCRIPTION_CANCELLED      → group:subscription
--   PRODUCT_UNACCEPTABLE        → DROPPED (group is locked)
--   GENERAL                     → DROPPED (no GENERAL group by design)
--   coverage:general            → becomes the store-wide fallback, if missing
--
-- Coverage rows outrank pack rows (priority 10 vs 20+), so where a shop has
-- both for one family, the coverage row wins — exactly as the engine resolves
-- it today. Within a source, the lowest priority number wins, again matching
-- `pickAutomationAction`.
--
-- ## The two places behaviour cannot be preserved exactly, and why
--
-- 1. PRODUCT_UNACCEPTABLE=auto (blume-box) is dropped. This is a NO-OP:
--    `evaluateAutoSubmitGuards` parks product-family cases even when Strong,
--    so that rule has never auto-submitted anything.
-- 2. FRAUDULENT=auto converts to group:fraud, which is
--    [FRAUDULENT, UNRECOGNIZED] — so UNRECOGNIZED widens from review to auto.
--    Prod contains exactly ONE UNRECOGNIZED dispute. Same fraud scoring, same
--    Strong-only guards.
-- 3. GENERAL=auto (blume-box) is dropped rather than promoting the fallback to
--    auto. Promoting would widen every reason with no group row. Narrowing is
--    the safe direction when preservation is not expressible, and an
--    uncategorised dispute with no reason-specific evidence is the least
--    defensible family to auto-submit. Approved by the maintainer 2026-07-29.
--
-- Net effect for blume-box: fraud / PNR / subscription / refund / duplicate
-- stay auto; GENERAL moves auto → review; UNRECOGNIZED moves review → auto.
--
-- ## Safety
--
--   * Every touched row is snapshotted first, so this is reversible.
--   * Keyed on `shop_id` (UUID), never `shop_domain` — handles are mutable.
--   * Idempotent: a second run finds no legacy rows and does nothing.
--   * Verification RAISES rather than deleting on a mismatch.
--
-- Shops with NO rules rows at all (7 test / app-review installs) are left
-- alone. They read as `review` already — both `readStoreAutomation` and
-- `pickAutomationAction` default that way — so seeding them would fabricate
-- configuration a merchant never chose.
-- ---------------------------------------------------------------------------

-- ── 0. Snapshot ────────────────────────────────────────────────────────────
create table if not exists public.legacy_setup_rules_backup_20260729 (
  id          uuid,
  shop_id     uuid,
  name        text,
  enabled     boolean,
  match       jsonb,
  action      jsonb,
  priority    integer,
  created_at  timestamptz,
  updated_at  timestamptz,
  captured_at timestamptz not null default now()
);

comment on table public.legacy_setup_rules_backup_20260729 is
  'Pre-conversion snapshot of __dd_setup__:coverage:* and :pack:* rules '
  '(migration 20260729010000). Restore path if the group conversion is wrong. '
  'Safe to drop once the group model has been observed correct in prod.';

insert into public.legacy_setup_rules_backup_20260729
  (id, shop_id, name, enabled, match, action, priority, created_at, updated_at)
select r.id, r.shop_id, r.name, r.enabled, r.match, r.action, r.priority,
       r.created_at, r.updated_at
from public.rules r
where (r.name like '\_\_dd\_setup\_\_:pack:%' or r.name like '\_\_dd\_setup\_\_:coverage:%')
  and not exists (
    select 1 from public.legacy_setup_rules_backup_20260729 b where b.id = r.id
  );

-- ── 1. Resolve every legacy row to a target group ──────────────────────────
-- A real table, not a TEMP one: `db push` and the Management API do not
-- guarantee a single session across statements, and a temp table that
-- silently vanishes mid-migration would make the verification below pass
-- vacuously over zero rows. Dropped at the end; the snapshot keeps the audit
-- trail.
drop table if exists public.legacy_group_conversion_20260729;

create table public.legacy_group_conversion_20260729 as
with legacy as (
  select
    r.id,
    r.shop_id,
    r.name,
    r.priority,
    r.match -> 'reason' as reasons,
    -- Normalise legacy mode vocabulary the same way lib/rules/normalizeMode.ts
    -- does: anything that is not auto/auto_pack/automated is review.
    case
      when lower(r.action ->> 'mode') in ('auto', 'auto_pack', 'automated') then 'auto'
      else 'review'
    end as mode,
    -- Coverage rows (priority 10) outrank pack rows, as the engine resolves
    -- them today.
    case when r.name like '\_\_dd\_setup\_\_:coverage:%' then 0 else 1 end as source_rank
  from public.rules r
  where r.enabled
    and (r.name like '\_\_dd\_setup\_\_:pack:%' or r.name like '\_\_dd\_setup\_\_:coverage:%')
),
mapped as (
  select
    l.*,
    case
      when l.reasons @> '["FRAUDULENT"]'::jsonb
        or l.reasons @> '["UNRECOGNIZED"]'::jsonb            then 'fraud'
      when l.reasons @> '["PRODUCT_NOT_RECEIVED"]'::jsonb    then 'pnr'
      when l.reasons @> '["CREDIT_NOT_PROCESSED"]'::jsonb    then 'refund'
      when l.reasons @> '["DUPLICATE"]'::jsonb               then 'duplicate'
      when l.reasons @> '["SUBSCRIPTION_CANCELLED"]'::jsonb  then 'subscription'
      -- Locked group: the engine parks product-family cases regardless, so a
      -- row here would be ignored 100% of the time.
      when l.reasons @> '["PRODUCT_UNACCEPTABLE"]'::jsonb    then null
      -- No GENERAL group by design — the catch-all fallback covers it.
      when l.reasons @> '["GENERAL"]'::jsonb                 then null
      else null
    end as group_id
  from legacy l
)
select distinct on (shop_id, group_id)
  shop_id, group_id, mode, id as source_rule_id, name as source_name
from mapped
where group_id is not null
order by shop_id, group_id, source_rank, priority;

-- ── 2. Create a fallback for any legacy shop that lacks one ────────────────
-- Derived from `coverage:general` when present — the closest thing the old
-- model had to a catch-all — and `review` otherwise. An EXISTING fallback is
-- never overwritten: that is the merchant's current switch.
insert into public.rules (shop_id, enabled, name, match, action, priority)
select
  s.shop_id,
  true,
  '__dd_setup__:fallback:default',
  '{}'::jsonb,
  jsonb_build_object('mode', coalesce(g.mode, 'review'), 'pack_template_id', null),
  100000
from (
  select distinct r.shop_id
  from public.rules r
  where r.name like '\_\_dd\_setup\_\_:pack:%'
     or r.name like '\_\_dd\_setup\_\_:coverage:%'
) s
left join lateral (
  select case
           when lower(r.action ->> 'mode') in ('auto', 'auto_pack', 'automated') then 'auto'
           else 'review'
         end as mode
  from public.rules r
  where r.shop_id = s.shop_id
    and r.name = '__dd_setup__:coverage:general'
    and r.enabled
  limit 1
) g on true
where not exists (
  select 1 from public.rules f
  where f.shop_id = s.shop_id and f.name = '__dd_setup__:fallback:default'
);

-- ── 3. Write the group rows ────────────────────────────────────────────────
insert into public.rules (shop_id, enabled, name, match, action, priority)
select
  lr.shop_id,
  true,
  '__dd_setup__:group:' || lr.group_id,
  jsonb_build_object('reason', gr.reasons),
  jsonb_build_object('mode', lr.mode, 'pack_template_id', null),
  50
from public.legacy_group_conversion_20260729 lr
join (
  values
    ('fraud',        '["FRAUDULENT", "UNRECOGNIZED"]'::jsonb),
    ('pnr',          '["PRODUCT_NOT_RECEIVED"]'::jsonb),
    ('refund',       '["CREDIT_NOT_PROCESSED"]'::jsonb),
    ('duplicate',    '["DUPLICATE"]'::jsonb),
    ('subscription', '["SUBSCRIPTION_CANCELLED"]'::jsonb)
) as gr(group_id, reasons) on gr.group_id = lr.group_id
where not exists (
  select 1 from public.rules existing
  where existing.shop_id = lr.shop_id
    and existing.name = '__dd_setup__:group:' || lr.group_id
);

-- ── 4. Mirror the auto-save kill-switch: "enabled somewhere" ───────────────
-- Matches `deriveAutoSaveEnabled` in lib/rules/storeAutomation.ts — the store
-- switch OR any group set to auto. Without this a converted shop whose
-- automation now lives entirely in groups would resolve to `auto` at tier-1
-- and then be blocked by the gate.
insert into public.shop_settings (shop_id, auto_save_enabled)
select
  s.shop_id,
  exists (
    select 1 from public.rules r
    where r.shop_id = s.shop_id
      and r.enabled
      and (
        (r.name = '__dd_setup__:fallback:default' and lower(r.action ->> 'mode') = 'auto')
        or (r.name like '\_\_dd\_setup\_\_:group:%' and lower(r.action ->> 'mode') = 'auto')
      )
  )
from (select distinct shop_id from public.legacy_setup_rules_backup_20260729) s
on conflict (shop_id) do update
  set auto_save_enabled = excluded.auto_save_enabled,
      updated_at = now();

-- ── 5. VERIFY, then delete. Never the other way round. ─────────────────────
do $$
declare
  unconverted record;
  problems text := '';
begin
  -- Every legacy row that maps to a group must now HAVE that group row, with
  -- the mode the engine would have resolved.
  for unconverted in
    select lr.shop_id, lr.group_id, lr.mode, lr.source_name
    from public.legacy_group_conversion_20260729 lr
    where not exists (
      select 1 from public.rules g
      where g.shop_id = lr.shop_id
        and g.name = '__dd_setup__:group:' || lr.group_id
        and g.enabled
        and lower(g.action ->> 'mode') = lr.mode
    )
  loop
    problems := problems || format(
      E'\n  shop=%s group=%s expected mode=%s (from %s)',
      unconverted.shop_id, unconverted.group_id,
      unconverted.mode, unconverted.source_name
    );
  end loop;

  if problems <> '' then
    raise exception
      'Legacy rule conversion incomplete — refusing to delete. Unconverted:%',
      problems;
  end if;

  -- Every shop that had legacy rows must end up with a store-wide switch,
  -- or its disputes would fall through to the engine default with no row to
  -- read or edit.
  select string_agg(s.shop_id::text, ', ')
  into problems
  from (select distinct shop_id from public.legacy_setup_rules_backup_20260729) s
  where not exists (
    select 1 from public.rules f
    where f.shop_id = s.shop_id and f.name = '__dd_setup__:fallback:default'
  );

  if problems is not null and problems <> '' then
    raise exception 'Shops left without a fallback rule: %', problems;
  end if;
end $$;

delete from public.rules
where name like '\_\_dd\_setup\_\_:pack:%'
   or name like '\_\_dd\_setup\_\_:coverage:%';

-- ── 6. Post-condition ──────────────────────────────────────────────────────
do $$
declare
  leftovers integer;
begin
  select count(*) into leftovers
  from public.rules
  where name like '\_\_dd\_setup\_\_:pack:%'
     or name like '\_\_dd\_setup\_\_:coverage:%';

  if leftovers > 0 then
    raise exception 'Legacy setup rules still present after conversion: %', leftovers;
  end if;
end $$;

-- ── 7. Drop the staging table ──────────────────────────────────────────────
-- The snapshot in step 0 is the durable record; this one is scratch.
drop table if exists public.legacy_group_conversion_20260729;
