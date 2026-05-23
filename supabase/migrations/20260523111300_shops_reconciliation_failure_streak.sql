-- 20260523111300: shops.reconciliation_failure_streak — circuit breaker
-- for the orders-reconciliation cron (PR-B).
--
-- Without this, a broken shop (revoked token, billing lapsed, scope
-- downgrade) would loop the cron indefinitely. After 5 consecutive
-- failed runs the cron skips that shop and emits a single audit_events
-- row. Reset to 0 on next success.

alter table shops
  add column if not exists reconciliation_failure_streak int not null default 0;

comment on column shops.reconciliation_failure_streak is
  'Circuit breaker for /api/cron/orders-reconciliation. Increments on each failed run; resets to 0 on success. >=5 means the cron skips this shop until next success.';
