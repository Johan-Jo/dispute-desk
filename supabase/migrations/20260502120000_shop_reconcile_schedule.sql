-- Per-shop reconcile schedule. Replaces the fan-out cron pattern (loop every
-- shop on every tick) with a due-queue: each shop carries its own
-- next_reconcile_at and the cron claims the N oldest-due shops with
-- FOR UPDATE SKIP LOCKED. Bounded work per tick regardless of tenant count.
--
-- Rationale: webhooks are the primary sync path (disputes/create,
-- disputes/update). The cron is a reconciliation safety net for missed
-- webhooks, so default cadence drops from 5 min to 1 hour.

alter table shops
  add column if not exists next_reconcile_at      timestamptz not null default now(),
  add column if not exists reconcile_interval_seconds int     not null default 3600,
  add column if not exists last_reconciled_at     timestamptz;

-- Partial index supports `WHERE uninstalled_at IS NULL ORDER BY next_reconcile_at LIMIT N`.
create index if not exists idx_shops_due_reconcile
  on shops (next_reconcile_at)
  where uninstalled_at is null;

-- Spread initial reconcile times across one cadence window so the first tick
-- after deploy doesn't claim every active shop at once.
update shops
  set next_reconcile_at = now() + (random() * interval '1 hour')
  where uninstalled_at is null;

-- Atomically claim N shops whose reconcile is due.
-- Uses FOR UPDATE SKIP LOCKED so concurrent cron invocations never claim
-- the same shop. Updates next_reconcile_at in the same statement so a
-- claimed shop can't be re-claimed for one full interval.
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
      and s.next_reconcile_at <= now()
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

comment on column shops.next_reconcile_at is
  'When this shop is next due for a reconcile cron pull. Spread across the cadence window to avoid stampede.';
comment on column shops.reconcile_interval_seconds is
  'Per-shop cadence in seconds. Default 3600 (1h). Adaptive: halved on drift, multiplied 1.5x on clean runs, clamped to [900, 86400].';
comment on column shops.last_reconciled_at is
  'Timestamp of the last completed reconcile. Updated by the syncDisputes job on success.';
comment on function claim_due_shops(int) is
  'Atomically claim up to N shops whose next_reconcile_at <= now(). Updates next_reconcile_at in the same statement (lazy scheduling). Used by /api/cron/sync-disputes.';
