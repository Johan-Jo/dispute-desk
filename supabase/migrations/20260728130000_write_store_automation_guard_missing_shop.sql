-- Harden write_store_automation against a non-existent shop.
--
-- THE GAP: 20260728120100 used
--     perform 1 from public.shops where id = p_shop_id for update;
-- `perform` with zero rows sets FOUND = false but raises NOTHING, so the
-- function carried on and inserted a `__dd_setup__:fallback:default` row for
-- a shop_id that does not exist — either erroring obscurely on the FK, or
-- silently creating an orphan rule row.
--
-- Fail loudly instead. Everything else is byte-identical to 20260728120100.

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

  -- Lock the shop row so concurrent PUTs serialise instead of interleaving
  -- into duplicate fallback rows.
  perform 1 from public.shops where id = p_shop_id for update;
  if not found then
    raise exception 'write_store_automation: shop % does not exist', p_shop_id;
  end if;

  -- Clear setup-owned rows. The prefix delete also self-heals leftover
  -- pack:/coverage: rows from the per-dispute-type era. Merchant custom
  -- rules are never in scope.
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
  'Atomic replace of the two setup-owned rules rows (store-wide switch + high-value safeguard). Raises if the shop does not exist. Never touches merchant custom rules. Called only by lib/rules/storeAutomation.ts.';
