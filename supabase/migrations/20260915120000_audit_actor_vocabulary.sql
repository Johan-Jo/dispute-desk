-- 20260915120000: widen audit_events.actor_type to merchant|admin|script|system
--
-- WHY. `audit_events` could not answer "what did this merchant do?". Two of
-- the four actors it needs to distinguish had no spelling:
--
--   * An operator using SuperAdmin "View as merchant" arrives as an ordinary
--     embedded request. Only app/api/automation/settings/route.ts resolved the
--     impersonation cookie; every other write site recorded the operator's
--     action as `merchant`.
--   * An operator-run script (scripts/build-one-pack.mjs) had to choose
--     between two lies and picked `merchant`, because `system` would have
--     claimed the pipeline acted on its own.
--
-- Observed: shop ea035a1b (Mein Maison) showed 14 `merchant` rows, 8 of which
-- were build-one-pack.mjs runs. The merchant did not do those things.
--
-- The CHECK is what makes the honest label unavailable, so it moves first:
-- nothing may write `admin` or `script` until this lands.
alter table audit_events
  drop constraint if exists audit_events_actor_type_check;

alter table audit_events
  add constraint audit_events_actor_type_check
  check (actor_type in ('merchant','admin','script','system'));

comment on column audit_events.actor_type is
  'Who acted. merchant = a human in the merchant''s own Shopify session. '
  'admin = a human on our side via View-as-merchant impersonation '
  '(actor_id = adminUserId). script = an operator-run script '
  '(actor_id = script filename). system = autonomous: cron, job handlers, '
  'webhooks. Widened from merchant|system on 2026-09-15.';
