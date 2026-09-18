-- Did the ops notification for a merchant reply actually go out?
--
-- The reply itself is stored the moment the merchant submits, but the
-- email is best-effort: sendAdminEmail never throws and returns void,
-- so a missing RESEND_API_KEY (dev) or a Resend rejection was
-- previously invisible — the merchant saw "thank you" and ops saw
-- nothing, with no way to tell the two cases apart.
--
-- NULL = not attempted yet / legacy row.
alter table public.merchant_messages
  add column if not exists response_notified_at timestamptz,
  add column if not exists response_notify_error text;

comment on column public.merchant_messages.response_notified_at is
  'When the ops notification email for this reply was accepted by Resend. NULL means it was never sent — check response_notify_error.';
