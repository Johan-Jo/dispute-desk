-- claim_due_shops set next_reconcile_at = claim time + interval. The claim
-- runs a few seconds after the :00 cron tick, so the next tick one interval
-- later found every shop ~45 s short of due and skipped it: an "hourly" shop
-- actually synced every two hours (prod 2026-09-29: 09, 11, 12, 14, 16 UTC).
-- A 5-minute grace window claims anything due before the next tick's jitter.
create or replace function claim_due_shops(p_limit int default 200)
returns table (id uuid, shop_domain text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select s.id
    from shops s
    where s.uninstalled_at is null
      and s.next_reconcile_at <= now() + interval '5 minutes'
    order by s.next_reconcile_at
    limit p_limit
    for update skip locked
  )
  update shops s
    set next_reconcile_at =
          now() + (s.reconcile_interval_seconds || ' seconds')::interval
    from due
    where s.id = due.id
    returning s.id, s.shop_domain;
end;
$$;

revoke all on function claim_due_shops(int) from public, anon, authenticated;
grant execute on function claim_due_shops(int) to service_role;

comment on function claim_due_shops(int) is
  'Atomically claim up to N shops due within the next 5 minutes (grace for cron jitter). Updates next_reconcile_at in the same statement. Used by /api/cron/sync-disputes.';
