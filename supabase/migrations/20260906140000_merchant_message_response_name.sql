-- Who replied, not just how to reach them.
--
-- These messages typically ask "who is responsible for the account?",
-- so a name is the most useful field of the three — it tells ops who
-- they are actually about to speak to. Nullable: the banner treats
-- name/email/phone as optional individually, and a reply is valid as
-- long as at least one contact channel is present.
alter table public.merchant_messages
  add column if not exists response_name text;

comment on column public.merchant_messages.response_name is
  'Name the merchant gave when replying to an in-app message. Optional.';
