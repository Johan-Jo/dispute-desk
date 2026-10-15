-- No-orders gate admin alert (docs/plans/no-orders-install-gate.plan.md).
--
-- Every time the embedded app shows the no-orders lock screen, the admin is
-- emailed with the store's details. `orders_gate_notified_at` throttles that to
-- one email per shop per 24h: the send is claimed with a conditional UPDATE on
-- this column, so a merchant reloading the lock screen (or two concurrent
-- serverless instances) cannot produce a burst of duplicate emails.

alter table shops
  add column if not exists orders_gate_notified_at timestamptz;

comment on column shops.orders_gate_notified_at is
  'Last time the admin was emailed that this shop hit the no-orders lock screen. Throttles the alert to one per shop per 24h. NULL = never notified.';
