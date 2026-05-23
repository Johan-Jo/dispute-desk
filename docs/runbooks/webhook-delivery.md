# Runbook — Webhook Delivery (Disputes + Orders)

Owns end-to-end behavior of the `disputes/create`, `disputes/update`, `orders/create`, and `orders/updated` webhooks. Use when:

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

Webhook topics are subscribed during OAuth:
- `lib/shopify/registerDisputeWebhooks.ts` — `disputes/create` + `disputes/update`.
- `lib/shopify/registerOrderWebhooks.ts` — `orders/create` + `orders/updated`. `orders/delete` is intentionally NOT subscribed; deleted orders remain in `shopify_orders` as historical commercial events.

To force re-subscription:

1. Uninstall + reinstall the app in the dev store, OR
2. Manually re-run `registerDisputeWebhooks()` / `registerOrderWebhooks()` via an admin tool — both registrations are idempotent (Shopify dedups by `topic + endpoint`).

## Orders webhook ingest (Phase 2 fraud intel)

The `orders/create` + `orders/updated` handlers funnel through `lib/webhooks/handleOrderWebhook.ts`. Same idempotency model as disputes (Layer A delivery dedup via `webhook_events`), but the persist path adds a **risk-payload-hash dedup gate**:

- `lib/fraudIntel/riskPayloadHash.ts` computes a deterministic SHA-256 over the canonicalized risk JSON (`recommendation` + per-assessment `riskLevel` + `provider` + sorted `facts[]`).
- The shared `persistOrders` writer (`lib/shopify/persistOrders.ts`) appends a new `shopify_order_risk_assessments` row ONLY when the hash differs from the latest stored row for `(shop, order)`.
- Otherwise the webhook returns 200 + `outcome:"skipped_unchanged"` and only mutable columns on `shopify_orders` move.

Without this gate, every fulfillment / tag / note / address edit would inflate assessment history. The `webhook_events.outcome = 'skipped_unchanged'` rate on `orders/updated` deliveries should sit at roughly 80-90% in steady state — the majority of edits don't touch risk.

### Daily reconciliation

`/api/cron/orders-reconciliation` runs daily at 01:15 UTC. For each active shop with `historical_import_status = 'complete'`:
1. Fetches the trailing 26h window of order GIDs from Shopify.
2. Diffs against `shopify_orders.shopify_order_id`.
3. Enqueues `reconcile_missing_order` jobs (max 100/shop/run) for any missing GID.

**Circuit breaker.** `shops.reconciliation_failure_streak` increments on each failed run for a shop and resets to 0 on next success. After 5 consecutive failures the cron skips that shop and emits a single `orders_reconciliation_circuit_breaker_tripped` audit_events row. Prevents a broken shop (revoked token, billing lapsed) from looping the cron indefinitely.

### Diagnosing missing orders

If a merchant reports an order missing from `/admin/fraud-intel`:

1. **Check the webhook delivery.** `/admin/webhooks` filtered by `topic=orders/create` + the shop's domain. Row missing → Shopify never delivered, or delivered but our shop lookup rejected it.
2. **Check `webhook_events.outcome`** for the corresponding `event_id`. `applied` means we wrote the row; `skipped_unchanged` is rare on orders/create (only happens if the same order GID was reconciled before the webhook arrived); `error` carries the failure reason.
3. **Check the reconciliation cron.** Look at the most recent `/api/cron/orders-reconciliation` execution. If `shopsSkippedCircuitBreaker > 0`, query `shops.reconciliation_failure_streak` for the affected shop and unblock manually.
4. **Last resort: query Shopify directly.** Use the order GID against `ORDER_FOR_INGEST_QUERY` to confirm the order exists. If it does, run the `reconcile_missing_order` job manually via the admin jobs panel.

## Privacy rule

The `webhook_events.payload_excerpt` column stores ONLY the allowlisted fields in `lib/webhooks/eventIdempotency.ts#ALLOWLISTED_PAYLOAD_FIELDS`. **Never** persist the raw body anywhere — not in logs, not in audit, not in console output. The allowlist has zero PII fields by construction; widening it requires a security review.

If you need to debug the raw payload for a single incident, capture it transiently in the Shopify Partner dashboard ("Replay") rather than persisting it.

## Related files

### Disputes pipeline
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

### Orders pipeline (Phase 2 fraud intel)
- `lib/webhooks/handleOrderWebhook.ts` — pipeline orchestrator
- `lib/shopify/orderIngest.ts` — fetch + normalize + persist orchestrator
- `lib/shopify/queries/orderForIngest.ts` — single-order GraphQL projection
- `lib/shopify/persistOrders.ts` — shared insert/update + hash-dedup writer
- `lib/fraudIntel/riskPayloadHash.ts` — canonical hash gate
- `lib/fraudIntel/signalWriter.ts` — structured-over-parsed signal-row writer
- `lib/fraudIntel/factParser.ts` — pure parser for Shopify risk facts
- `app/api/cron/orders-reconciliation/route.ts` — daily sweep
- `lib/jobs/handlers/reconcileMissingOrderJob.ts` — per-order reconcile
- `app/admin/fraud-intel/page.tsx` — v0 intelligence surface
- `supabase/migrations/20260523111200_risk_assessments_payload_hash.sql`
- `supabase/migrations/20260523111300_shops_reconciliation_failure_streak.sql`
- `supabase/migrations/20260523111400_shopify_order_risk_signals.sql`
