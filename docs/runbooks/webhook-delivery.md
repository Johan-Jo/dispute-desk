# Runbook — Dispute Webhook Delivery

Owns end-to-end behavior of the `disputes/create` and `disputes/update` webhooks. Use when:

- New disputes aren't appearing in `/portal/disputes` or `/app/disputes` within seconds of opening in Shopify.
- `/admin/webhooks` shows a non-zero "Cron-only catch-ups" stat.
- A merchant reports receiving a duplicate "new dispute" email, or no email at all.

## End-to-end flow

1. Shopify POSTs the webhook to `/api/webhooks/disputes-create` or `/api/webhooks/disputes-update`.
2. Route hands `(rawBody, headers)` to `handleDisputeWebhook()` in `lib/webhooks/handleDisputeWebhook.ts`.
3. HMAC verified against `SHOPIFY_API_SECRET`.
4. Shop resolved by `x-shopify-shop-domain` header (preferred — signed) → falls back to payload `myshopify_domain`. Unknown → 200 + `skipped:"unknown_shop"`.
5. **Layer A delivery dedup** — `checkAndClaim` inserts a `webhook_events` row keyed on `(shop_id, X-Shopify-Webhook-Id)`. Duplicate → 200 + `skipped:"duplicate_event"`.
6. Payload normalized into a `DisputeSnapshot` via strict Zod. Failure → 200 + `outcome:"error_schema_validation"` (no retry storm; cron picks up).
7. `applyDisputeSnapshot` runs the shared diff engine: upsert, monotonic guards, `dispute_events` ledger emit.
8. `dispatchDisputeEffects` fires downstream effects (pipeline, alerts) under **Layer B effect dedup** (claim via `audit_events.dispute_event_key` unique index).
9. `markProcessed` stamps `webhook_events.outcome` + `processing_ms` + `processed_at`.

Latency target: **p50 <500ms, p95 <2s**. If real-world p95 trends above 5s, move the dispatcher to a background job (out of scope today; see plan).

## Two-layer idempotency

Both layers are required.

- **Layer A (delivery):** `webhook_events.event_id` unique per shop. Catches Shopify retrying the same delivery (the 19× / 48h envelope).
- **Layer B (effect):** `audit_events.dispute_event_key` unique per `(dispute_id, key)`. Catches cron + webhook independently observing the same Shopify state change.

If you remove Layer B, a missed webhook + the next cron tick can both fire the new-dispute email (one direct, one via the cron path), because each layer's claim is local to its observer.

## Latency targets

| Metric | Target | Alarm |
|--------|--------|-------|
| `webhook_events.processing_ms` p50 | <500ms | >1000ms sustained |
| `webhook_events.processing_ms` p95 | <2000ms | >5000ms sustained |
| Cron-only reconciliations (24h) | 0 | >5/day at steady state |

`/admin/webhooks` shows all three live.

## Diagnostic flowchart

When merchant reports "new dispute not showing":

1. **Check `/admin/webhooks` for a recent row** matching the dispute's `shopify_object_id`. Filter by `topic=disputes/create`.
   - **No row found.** Did Shopify ever deliver? Check the Shopify Partner dashboard for the shop's webhook deliveries. If Shopify shows delivered + 2xx, our shop lookup may have rejected the event — investigate `unknown_shop` skips. If Shopify shows failed delivery, our endpoint may be down — check `/admin/jobs` for unrelated error spikes.
   - **Row exists.** Continue.
2. **Inspect the row's `outcome` column.**
   - `applied` → state propagated. Investigate the consumer (UI, email).
   - `duplicate_event` → Shopify retried; the original delivery's row holds the truth.
   - `error_schema_validation` → Shopify payload shape drifted. The hourly cron will reconcile within 1h. Open a follow-up to extend the Zod normalizer.
   - `skipped_stale` → an earlier snapshot with newer `shopify_updated_at` already won. The dispute IS up to date.
   - `error` → check `error_message`. Most causes are transient DB; Shopify retried automatically.
3. **If `applied` but the UI still doesn't show it:** query `disputes` directly by `dispute_gid` and confirm the row exists. If yes, investigate the workspace API / UI rendering layer — that's no longer a webhook problem.
4. **If "Cron-only catch-ups" is non-zero in the aggregate panel:** the webhook is silently failing for some shops. Check `webhook_events` for the shop's recent deliveries — any `outcome IS NULL` rows mean `markProcessed` failed and the row was never finalized. Often a downstream DB issue.
5. **If duplicate emails:** confirm Layer B is wired correctly. Run `select count(*) from audit_events where event_type = 'effect:send_new_dispute_alert' and dispute_id = '<id>'`. Should be exactly 1.

## Manual replay

Shopify's Partner dashboard provides "Replay" for the last 48h of deliveries. To replay locally:

1. Capture the original payload + the original `X-Shopify-Webhook-Id` from the Shopify Partner dashboard.
2. Delete the corresponding `webhook_events` row to clear Layer A dedup:
   ```sql
   delete from webhook_events where shop_id = '<id>' and event_id = '<event-id>';
   ```
3. Optionally clear Layer B claims for the affected dispute_event_keys (only if you want effects to re-fire):
   ```sql
   delete from audit_events where dispute_id = '<id>' and dispute_event_key like '<dispute-id>:%';
   ```
   **Warning:** audit_events has an immutability trigger. Replay via the cron path instead — schedule the next reconcile by setting `shops.next_reconcile_at = now()`.
4. Replay the webhook from the Shopify Partner dashboard.

## Re-subscription

Webhook topics are subscribed during OAuth in `lib/shopify/registerDisputeWebhooks.ts`. To force re-subscription:

1. Uninstall + reinstall the app in the dev store, OR
2. Manually re-run `registerDisputeWebhooks()` via an admin tool — the registration is idempotent (Shopify dedups by `topic + endpoint`).

## Privacy rule

The `webhook_events.payload_excerpt` column stores ONLY the allowlisted fields in `lib/webhooks/eventIdempotency.ts#ALLOWLISTED_PAYLOAD_FIELDS`. **Never** persist the raw body anywhere — not in logs, not in audit, not in console output. The allowlist has zero PII fields by construction; widening it requires a security review.

If you need to debug the raw payload for a single incident, capture it transiently in the Shopify Partner dashboard ("Replay") rather than persisting it.

## Related files

- `lib/webhooks/handleDisputeWebhook.ts` — pipeline orchestrator
- `lib/webhooks/eventIdempotency.ts` — Layer A claim + allowlist
- `lib/disputes/disputeSnapshot.ts` — normalizers (REST + GraphQL)
- `lib/disputes/applyDisputeSnapshot.ts` — diff engine + monotonic guards
- `lib/disputes/dispatchOnce.ts` — Layer B `withEffectDedup`
- `lib/disputes/disputeEffectsDispatcher.ts` — downstream effects
- `app/admin/webhooks/page.tsx` — observability panel
- `supabase/migrations/20260520120000_webhook_events.sql`
- `supabase/migrations/20260520120100_disputes_shopify_updated_at.sql`
- `supabase/migrations/20260520120200_audit_events_dispute_event_key.sql`
