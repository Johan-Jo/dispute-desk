-- Dedupe marker for the App Store install welcome email.
--
-- The email fires from onNewShopCreated, which is gated on the shops row being
-- created for the first time — but a merchant who uninstalls and reinstalls
-- gets a fresh row only if the old one was deleted; in practice we clear
-- uninstalled_at and reuse it. This column makes the send idempotent
-- independent of that: claimed with a conditional UPDATE ... WHERE
-- welcome_email_sent_at IS NULL, so two concurrent installs cannot both send.
alter table shops add column if not exists welcome_email_sent_at timestamptz;

comment on column shops.welcome_email_sent_at is
  'When the App Store install welcome email was sent. Claimed atomically before sending so a retry or concurrent install cannot double-send. NULL = never sent.';
