-- 20260520120200: audit_events.dispute_event_key — Layer B effect idempotency
--
-- Each "effect" the dispatcher tries to run (build_pack enqueue, email send,
-- audit log of a transition) writes a deterministic dispute_event_key first.
-- The unique constraint guarantees the effect fires at most once even when
-- the cron and the webhook observe the same Shopify state change.
--
-- Layer A delivery idempotency (webhook_events table) catches Shopify
-- retries; Layer B catches independent observers. Both are required; neither
-- is sufficient alone.

alter table audit_events
  add column if not exists dispute_event_key text;

create unique index if not exists audit_events_dispute_event_key_unique
  on audit_events (dispute_id, dispute_event_key)
  where dispute_event_key is not null;

comment on column audit_events.dispute_event_key is
  'Deterministic key for effect-level idempotency. Built by lib/disputes/disputeEventKey.ts (e.g. "<disputeId>:STATUS_CHANGED:<from>_<to>"). Cron + webhook observing the same transition collide on this index.';
