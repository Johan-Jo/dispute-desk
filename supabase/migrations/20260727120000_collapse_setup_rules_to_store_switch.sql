-- Collapse per-dispute-type automation rules into a single store-wide switch.
--
-- BEFORE: setup owned up to a dozen rows per shop —
--   __dd_setup__:pack:{packId}            per-pack routing, priority 20+i*5
--   __dd_setup__:pack:{packId}:inquiry    phase-paired sibling
--   __dd_setup__:coverage:{familyId}      wizard family rules, priority 10
--   __dd_setup__:fallback:default         catch-all, priority 100000
--   __dd_setup__:safeguard:high_value     wizard amount safeguard, priority 5
--   __dd_safeguard__:high_value           the SAME safeguard under a second
--                                         name, written by /app/rules — and
--                                         only the __dd_setup__ one ever
--                                         triggered the high-value email
--
-- AFTER: exactly two setup-owned rows per shop —
--   __dd_setup__:fallback:default         action.mode IS the store-wide switch
--   __dd_setup__:safeguard:high_value     the one canonical safeguard
--
-- Merchant-authored custom rules (any name not matching the two prefixes
-- below) are NEVER touched. Every statement here is keyed on those prefixes.
--
-- Behaviour preservation: the per-type mode only ever governed the clean-Strong
-- slice (coverage / fatal-loss / moderate / weak / product-family park or block
-- regardless), and `shop_settings.auto_save_enabled` was already derived
-- all-or-nothing, so a mixed-family shop was not auto-saving anything. Reading
-- mixed => review is therefore behaviour-preserving, not a downgrade.
--
-- NOTE ON `like`: `_` is a LIKE wildcard, and these names are all underscores.
-- We use left(name, 12) = '__dd_setup__' throughout to avoid escaping bugs.

begin;

-- ── 1) Derive each shop's store-wide mode ────────────────────────────────
-- Conservative: auto ONLY if every enabled setup rule resolved to auto.
-- The safeguard is EXCLUDED from the vote — it is always mode=review by
-- definition, so including it would force every shop that ever set a
-- threshold to "review everything".
create temporary table _dd_shop_mode on commit drop as
select r.shop_id,
       case when bool_and(r.action->>'mode' = 'auto') then 'auto' else 'review' end as mode
  from public.rules r
 where left(r.name, 12) = '__dd_setup__'
   and r.name <> '__dd_setup__:safeguard:high_value'
   and r.enabled
 group by r.shop_id;

-- ── 2) Snapshot the unified safeguard BEFORE deleting ────────────────────
-- Materialised into a real temp table because the DELETE below would
-- invalidate a CTE reading the same rows.
-- Lower threshold wins: a merchant who set $200 on /app/rules and left the
-- wizard's $500 in place expects $200 to be the one that parks.
create temporary table _dd_safeguard_snapshot on commit drop as
select shop_id,
       min((match->'amount_range'->>'min')::numeric) as min_amount,
       bool_or(enabled) as enabled
  from public.rules
 where name in ('__dd_setup__:safeguard:high_value', '__dd_safeguard__:high_value')
   and match ? 'amount_range'
   and (match->'amount_range'->>'min') is not null
 group by shop_id;

-- ── 3) Drop every setup-owned row (both prefixes) ────────────────────────
delete from public.rules where left(name, 12) = '__dd_setup__';
delete from public.rules where name = '__dd_safeguard__:high_value';

-- ── 4) Reinsert exactly one fallback per shop ────────────────────────────
insert into public.rules (shop_id, enabled, name, match, action, priority)
select m.shop_id,
       true,
       '__dd_setup__:fallback:default',
       '{}'::jsonb,
       jsonb_build_object('mode', m.mode, 'pack_template_id', null),
       100000
  from _dd_shop_mode m;

-- ── 5) Reinsert the unified safeguard ────────────────────────────────────
-- pack_template_id is intentionally absent: a tier-0 amount safeguard only
-- forces review; the template is resolved via reason_template_mappings.
insert into public.rules (shop_id, enabled, name, match, action, priority)
select s.shop_id,
       s.enabled,
       '__dd_setup__:safeguard:high_value',
       jsonb_build_object('amount_range', jsonb_build_object('min', s.min_amount)),
       '{"mode":"review"}'::jsonb,
       5
  from _dd_safeguard_snapshot s
 where s.min_amount is not null
   and s.min_amount > 0;

-- ── 6) Bring the shop-level auto-save gate into lockstep ─────────────────
-- Fixes two long-standing drift bugs in one shot:
--   (b) the wizard's rule writer never set auto_save_enabled at all, so a
--       merchant who chose all-auto in onboarding still hit a false gate;
--   (c) auto_save_enabled was derived all-or-nothing from per-pack modes, so
--       one family on review disabled auto-save for every family.
-- From here it is a strict 1:1 mirror of the switch, written only by
-- lib/rules/storeAutomation.ts.
update public.shop_settings s
   set auto_save_enabled = (m.mode = 'auto'),
       updated_at = now()
  from _dd_shop_mode m
 where s.shop_id = m.shop_id;

commit;
