-- Snapshot the setup-owned rules BEFORE the collapse deletes them.
--
-- WHY THIS EXISTS, and why it is dated to run FIRST.
--
-- `20260727120000_collapse_setup_rules_to_store_switch.sql` reduces every shop
-- to one fallback + one safeguard by deleting every `__dd_setup__` row. It
-- derives the shop's new store-wide mode with:
--
--     bool_and(action->>'mode' = 'auto')      -- excluding the safeguard
--
-- That vote includes the OLD CATCH-ALL (`__dd_setup__:fallback:default`). A
-- shop that automated the reasons it had playbooks for and deliberately left
-- the catch-all on review therefore votes itself down to review — and step 6
-- of that migration then writes `auto_save_enabled = false`. On prod today that
-- is `blume-box` (seven reasons on auto, catch-all review, auto_save_enabled
-- true — it IS auto-saving) and `surasvenne` (fraud + item-not-received).
--
-- `20260729010000_convert_legacy_setup_rules_to_groups.sql` is exactly the
-- repair for this: it turns those per-reason rows into `__dd_setup__:group:*`
-- rows, which survive the new model. But migrations run in filename order, so
-- the collapse deletes its input first and the conversion finds nothing. Dev
-- only came out right because its legacy rows happened to exist when the
-- conversion ran; prod is the untouched ordering.
--
-- Rather than reorder an already-applied migration (checksum drift) or rely on
-- an operator remembering a pre-flight script, this migration is dated to sort
-- BEFORE the collapse and captures what the collapse is about to destroy.
-- `20260729020000_restore_live_group_rules_after_collapse.sql` reads it back.
--
-- ON DEV this is a no-op: the collapse ran on 2026-07-27, so there is nothing
-- left matching the prefixes and the tables are created empty. Being older than
-- dev's last applied version, it needs `supabase db push --include-all` there;
-- on prod it sorts naturally into place with the other three pending files.
--
-- Both tables are retained for audit. They are safe to drop once the prod run
-- is confirmed good.

begin;

-- ── 1) The rules themselves ────────────────────────────────────────────────
create table if not exists public.setup_rules_pre_collapse_20260729 (
  id          uuid primary key,
  shop_id     uuid not null,
  name        text,
  match       jsonb,
  action      jsonb,
  priority    integer,
  enabled     boolean,
  captured_at timestamptz not null default now()
);

comment on table public.setup_rules_pre_collapse_20260729 is
  'Setup-owned rules as they stood before 20260727120000 collapsed them to one '
  'store-wide switch. Read by 20260729020000 to restore per-reason automation '
  'that the collapse vote would otherwise silently switch off. Audit only.';

-- Keyed on the primary key, so re-running captures nothing twice.
insert into public.setup_rules_pre_collapse_20260729
  (id, shop_id, name, match, action, priority, enabled)
select r.id, r.shop_id, r.name, r.match, r.action, r.priority, r.enabled
  from public.rules r
 where (left(r.name, 12) = '__dd_setup__' or r.name = '__dd_safeguard__:high_value')
   and not exists (
         select 1 from public.setup_rules_pre_collapse_20260729 s where s.id = r.id
       );

-- ── 2) The auto-save gate, per shop ────────────────────────────────────────
-- Needed to tell "automation was LIVE" from "automation was configured but
-- inert". `sharpdesk` has fraud + item-not-received on auto with
-- `auto_save_enabled = null`, so it has never actually auto-saved; restoring
-- its groups and flipping the gate would START automation for a paying
-- merchant who never saw it run. The restore deliberately leaves such shops
-- alone — see that migration's §3.
create table if not exists public.shop_auto_save_pre_collapse_20260729 (
  shop_id           uuid primary key,
  auto_save_enabled boolean,
  captured_at       timestamptz not null default now()
);

comment on table public.shop_auto_save_pre_collapse_20260729 is
  'shop_settings.auto_save_enabled as it stood before 20260727120000 rewrote '
  'it to mirror the collapsed switch. Distinguishes live automation from '
  'configured-but-inert. Audit only.';

insert into public.shop_auto_save_pre_collapse_20260729 (shop_id, auto_save_enabled)
select s.shop_id, s.auto_save_enabled
  from public.shop_settings s
 where not exists (
         select 1 from public.shop_auto_save_pre_collapse_20260729 p
          where p.shop_id = s.shop_id
       );

commit;
