-- Atomic write for the store-wide automation switch.
--
-- THE BUG: `writeStoreAutomation` (lib/rules/storeAutomation.ts) did
-- delete → delete → insert as three separate round-trips with no
-- transaction. Two failure modes:
--
--   1. CRASH BETWEEN THEM — the deletes commit, the insert never runs. The
--      shop is left with NO setup rules at all: `pickAutomationAction` finds
--      no catch-all and returns "review" for every dispute, while
--      `shop_settings.auto_save_enabled` keeps its previous value. That is
--      exactly the mirror drift the store-wide redesign claimed to make
--      structurally impossible.
--
--   2. CONCURRENT WRITES — two PUTs can interleave as
--      delete-A → delete-B → insert-A → insert-B, leaving TWO
--      `__dd_setup__:fallback:default` rows. `readStoreAutomation` then picks
--      one arbitrarily via .find(), and `seedDefaultStoreAutomation`'s
--      .maybeSingle() THROWS on the duplicates, permanently breaking
--      install-time seeding for that shop.
--
-- This function does the whole swap in one statement-level transaction.
-- Merchant-authored custom rules are never touched: every delete is scoped to
-- the setup-owned name prefix / the legacy safeguard name.

create or replace function public.write_store_automation(
  p_shop_id uuid,
  p_mode text,
  p_safeguard_enabled boolean,
  p_safeguard_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_mode not in ('auto', 'review') then
    raise exception 'write_store_automation: invalid mode %', p_mode;
  end if;

  -- Lock the shop row so concurrent PUTs serialise instead of interleaving.
  perform 1 from public.shops where id = p_shop_id for update;

  -- Clear setup-owned rows. The prefix delete also self-heals leftover
  -- pack:/coverage: rows from the per-dispute-type era.
  delete from public.rules
   where shop_id = p_shop_id
     and left(name, 12) = '__dd_setup__';

  -- Legacy safeguard name written by the old /app/rules page.
  delete from public.rules
   where shop_id = p_shop_id
     and name = '__dd_safeguard__:high_value';

  insert into public.rules (shop_id, enabled, name, match, action, priority)
  values (
    p_shop_id, true, '__dd_setup__:fallback:default',
    '{}'::jsonb,
    jsonb_build_object('mode', p_mode, 'pack_template_id', null),
    100000
  );

  if p_safeguard_enabled and p_safeguard_amount is not null and p_safeguard_amount > 0 then
    insert into public.rules (shop_id, enabled, name, match, action, priority)
    values (
      p_shop_id, true, '__dd_setup__:safeguard:high_value',
      jsonb_build_object('amount_range', jsonb_build_object('min', p_safeguard_amount)),
      '{"mode":"review"}'::jsonb,
      5
    );
  end if;
end;
$$;

comment on function public.write_store_automation is
  'Atomic replace of the two setup-owned rules rows (store-wide switch + high-value safeguard). Never touches merchant custom rules. Called only by lib/rules/storeAutomation.ts.';
