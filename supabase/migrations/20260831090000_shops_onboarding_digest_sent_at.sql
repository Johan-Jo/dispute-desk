-- Dedupe marker for the onboarding analysis digest.
--
-- The digest fires when the historical order import transitions to
-- `historical_import_status = 'complete'`. That transition is NOT a
-- one-shot event: `backfillShopOrders` resumes by cursor and its job is
-- retried by the worker on failure, so the completion branch can execute
-- more than once for one shop. Without a claim a merchant would be emailed
-- again on every re-run, and a re-import of an existing shop would re-send
-- the "we just analysed your store" email months later.
--
-- Claimed with a conditional `UPDATE ... WHERE onboarding_digest_sent_at IS
-- NULL` before the send, so a retry or two concurrent workers cannot both
-- send. Same shape as shops.welcome_email_sent_at.
--
-- Backfilled for shops that already completed their import: this email was
-- built in May 2026 but never wired to a caller, so four prod shops finished
-- their import without it. Marking them as sent means enabling the trigger
-- does not suddenly email long-established merchants a "welcome, here is
-- your first analysis" digest about orders they imported months ago.
alter table shops add column if not exists onboarding_digest_sent_at timestamptz;

comment on column shops.onboarding_digest_sent_at is
  'When the onboarding analysis digest was sent. Claimed atomically before sending so a backfill retry cannot double-send. NULL = never sent.';

-- Suppress for shops whose import already finished before the trigger
-- existed. New shops (status not yet complete) keep NULL and will receive it.
update shops
   set onboarding_digest_sent_at = coalesce(historical_import_completed_at, now())
 where historical_import_status = 'complete'
   and onboarding_digest_sent_at is null;
