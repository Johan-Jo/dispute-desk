-- Idempotency stamp for the high-value review email alert.
-- Set when sendHighValueReviewAlert successfully delivers — read by
-- the same sender to suppress duplicate emails on pack rebuilds.

alter table disputes
  add column if not exists high_value_alert_sent_at timestamptz;

comment on column disputes.high_value_alert_sent_at is
  'Set when the high-value review email alert was successfully sent for this dispute. Used to suppress duplicate alerts on pack rebuilds. Nullable.';
