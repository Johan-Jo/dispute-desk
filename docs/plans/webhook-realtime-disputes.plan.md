# Real-time Disputes via Webhook Direct-Processing

## Context

Audit finding: DisputeDesk **already has** `/api/webhooks/disputes-create` and `/api/webhooks/disputes-update` registered with Shopify, HMAC-verified via the shared `handleDisputeWebhook()` helper, and idempotency-guarded by a `(shop_id, "sync_disputes", queued|running)` job dedup check. They are wired during OAuth in `lib/shopify/registerDisputeWebhooks.ts:40-107`.

**The current behavior is suboptimal**: both webhooks do exactly the same thing — enqueue a full `sync_disputes` job for the entire shop. That means:
- Webhook latency is **not real-time**: handler returns in <100ms, but the actual data change waits for the next job poller pickup (~30s) AND a full shop-wide sync (~5–60s depending on dispute count).
- Effective latency: **30–90 seconds**, not the <10s we'd want from webhooks.
- Cron still runs every 5 minutes redundantly, doing the same work the webhook just queued.
- The merchant-visible payload (`disputes/create` carries the full dispute object including `dispute_evidence`, `network_reason_code`, `currency`, `amount`, `evidence_due_by`, etc.) is **thrown away** — the handler immediately fetches everything fresh via GraphQL.

This plan promotes both webhooks from "fire a sync job" to **direct event processing**: parse the payload, write to the `disputes` table, fire the right downstream effect, in <2 seconds end-to-end. Keep the cron as a once-an-hour safety net.

## Architectural decisions

1. **Webhooks become the primary path**; cron drops from `*/5 * * * *` to `0 * * * *` (hourly). Cron's job is now reconciliation, not latency reduction.
2. **Payload-first, GraphQL-fallback**. Webhook payloads carry most fields. Where a field is missing or ambiguous, do a single targeted GraphQL fetch for that one dispute (cheap, sub-second). Avoid shop-wide refetches.
3. **Idempotency by event ID, not by job dedup.** Shopify includes `X-Shopify-Webhook-Id` (a UUID, stable across retries). Store seen IDs in a new `webhook_events` table (7-day retention) keyed by `(shop_id, event_id)`. Reject duplicates with 200 immediately.
4. **Single shared processor**, two thin route handlers. The diff-application logic (new dispute? status change? evidenceSentOn flipped? outcome posted?) lives in one module both webhooks call, with a `mode: "create" | "update"` parameter. Same module the cron loop calls per-dispute, so reconciliation behavior stays consistent.
5. **Downstream effects unchanged**. Pack build, email alerts, audit events, rules evaluation, automation pipeline — all fire from the same hooks that `syncDisputes.ts` fires today. We're moving the trigger, not the effect.
6. **`SUBMITTED_TO_NETWORK` becomes reachable instantly.** When `disputes/update` carries a non-null `evidence_sent_on`, the resolver flips `normalized_status` immediately. The Regenerate gate and outcome countdown UX (already wired in code) light up within seconds of Shopify forwarding to the network.
7. **No app-review re-submission needed**. `disputes/create` and `disputes/update` topics are already approved and active. We're changing *what we do with them*, not adding new scopes.
8. **Observability first.** A new admin panel (`/admin/webhooks`) shows the last 100 received events with latency, processor outcome, and any errors. Webhook silent-failure is the biggest risk; surfacing it makes the risk knowable.

## Implementation — 7 commits

Each commit leaves `npm test`, `npx tsc --noEmit`, and `npm run build` green.

### Commit 1 — `feat(webhooks): webhook_events table for event-id idempotency`

**Migration:** `supabase/migrations/<timestamp>_webhook_events.sql`

```sql
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  event_id text not null,                       -- X-Shopify-Webhook-Id header value
  topic text not null,                          -- "disputes/create", "disputes/update", etc.
  shopify_object_id text,                       -- dispute_gid for disputes/* topics
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text,                                 -- "applied", "skipped_duplicate", "skipped_unchanged", "error"
  error_message text,
  payload_excerpt jsonb,                        -- first 2KB of payload for debugging; full payload never stored
  processing_ms integer,
  constraint webhook_events_event_id_unique unique (shop_id, event_id)
);

create index idx_webhook_events_shop_received on webhook_events (shop_id, received_at desc);
create index idx_webhook_events_object on webhook_events (shopify_object_id) where shopify_object_id is not null;

-- 7-day retention cleanup, runs daily via cron.
-- Lives here as a comment so the cleanup query is colocated with the schema.
-- delete from webhook_events where received_at < now() - interval '7 days';
```

**New file:** `lib/webhooks/eventIdempotency.ts`
- `checkAndClaim(shopId, eventId, topic, shopifyObjectId, payloadExcerpt): "fresh" | "duplicate"` — atomic insert; on unique-violation returns `"duplicate"`.
- `markProcessed(eventRowId, outcome, processingMs, errorMessage?)` — updates the row after the handler finishes.

**Test:** `lib/webhooks/__tests__/eventIdempotency.test.ts` — 4 tests: fresh insert returns "fresh"; duplicate event-id returns "duplicate"; concurrent insertion is safe (uses unique constraint); markProcessed updates correctly.

**Cron cleanup:** Add a daily cron entry `0 3 * * *` calling a new `/api/cron/cleanup-webhook-events` route that runs the 7-day delete. Wire it in `vercel.json`.

### Commit 2 — `feat(webhooks): disputeWebhookProcessor — payload-first diff engine`

**New file:** `lib/webhooks/disputeWebhookProcessor.ts`

```ts
export type DisputeWebhookMode = "create" | "update";

export interface DisputeWebhookPayload {
  // Shopify's disputes webhook payload schema. Documented at
  // https://shopify.dev/docs/api/admin-rest/2026-01/resources/dispute
  id: number;                                   // numeric dispute id
  admin_graphql_api_id: string;                 // dispute_gid
  order_id: number;
  order_admin_graphql_api_id?: string;
  status: string;                               // "open", "won", "lost", "needs_response", etc.
  reason?: string | null;
  network_reason_code?: string | null;
  initiated_at?: string;
  evidence_due_by?: string | null;
  evidence_sent_on?: string | null;
  finalized_on?: string | null;
  amount?: string | null;
  currency?: string | null;
  type?: string;
  // ... other fields per Shopify schema
}

export interface ProcessorResult {
  outcome: "applied" | "skipped_unchanged" | "skipped_no_change_detected";
  events: DisputeEvent[];           // matches syncDisputes.emitDisputeEvent shape
  disputeId: string | null;         // local disputes.id, null when shop unknown
  followUpEffects: string[];        // human-readable list for audit/observability
}

export async function processDisputeWebhook(args: {
  shopId: string;
  mode: DisputeWebhookMode;
  payload: DisputeWebhookPayload;
}): Promise<ProcessorResult>;
```

Behavior:
1. Resolve existing dispute by `(shop_id, dispute_gid)`.
2. If `mode === "create"` AND no existing row → **new dispute path**:
   - Build the same row shape `syncDisputes.ts:204-249` upserts.
   - For optional fields the webhook payload doesn't carry (rare but possible — `dispute_evidence_gid` is set via a separate `dispute_evidence` object Shopify includes but the schema isn't 100% predictable), do **one targeted GraphQL fetch** by dispute id to backfill. Reuse the existing `getDisputeById()` helper if it exists; if not, extract a small one from `syncDisputes.ts` into `lib/shopify/queries/disputes.ts` so both code paths share it.
   - Insert; emit `DISPUTE_OPENED`.
3. If `mode === "update"` OR row exists for `mode === "create"` → **diff-apply path**:
   - Same diff logic `syncDisputes.ts:263-377` runs today: compare status, due_at, submission_state, final_outcome. Emit events for each meaningful change.
   - Critically: **`evidence_sent_on` flipping from null to a timestamp** must emit a `SUBMISSION_CONFIRMED` event AND flip `normalized_status` to `"submitted_to_bank"`. This is the SUBMITTED_TO_NETWORK trigger.
   - Update the dispute row with `last_synced_at = now()`.
4. Return `ProcessorResult`. Caller dispatches `followUpEffects`.

**Refactor in same commit:** Extract the per-dispute diff logic out of `syncDisputes.ts:204-377` into this new processor, then have `syncDisputes.ts` call `processDisputeWebhook({ mode: existing ? "update" : "create", ... })` per dispute. This keeps cron + webhooks consistent without duplicating logic.

**Tests:** `lib/webhooks/__tests__/disputeWebhookProcessor.test.ts` — 10 tests covering: new dispute insert, status change emits STATUS_CHANGED, evidenceSentOn null→set emits SUBMISSION_CONFIRMED, finalizedOn flip emits OUTCOME_DETECTED + DISPUTE_CLOSED, due_at change emits DUE_DATE_CHANGED, no-change payload returns "skipped_unchanged", unknown shop returns null disputeId, malformed payload validates and rejects, GraphQL backfill when dispute_evidence_gid missing, idempotent repeat application produces no duplicate events.

### Commit 3 — `feat(webhooks): downstream effects dispatcher`

**New file:** `lib/webhooks/disputeEffectsDispatcher.ts`

After `processDisputeWebhook()` returns events, this module fires the same downstream effects `syncDisputes.ts:382-602` does today:
- Rules evaluation → automation mode resolution
- `build_pack` job enqueue (auto or review+enabled)
- `sendNewDisputeAlert()` (deferred-or-immediate logic, claim guard intact)
- `claimAndSendDeferredNewDisputeAlert()` for `SUBMISSION_CONFIRMED` events
- `sendDefenceDeadlineFallbackAlert()` and other event-driven emails
- `logAuditEvent()` for every state transition
- `updateAdaptiveCronSchedule()` (cron auto-tunes its cadence based on activity — keep this hook)

Extract from `syncDisputes.ts` into this module so the cron + both webhooks call the same dispatcher. The cron loops over disputes, calls `processDisputeWebhook` per dispute, then `dispatchEffects(result)`.

**Tests:** 6 tests covering each event type firing the right effect, the `new_dispute_alert_sent_at` claim guard still works, the deferred-alert path still fires when build completes.

### Commit 4 — `feat(webhooks): wire disputes-create + disputes-update to the new processor`

**Modify:** `lib/webhooks/handleDisputeWebhook.ts`

Replace the current "enqueue sync_disputes" behavior with direct processing:

```ts
export async function handleDisputeWebhook(
  rawBody: string,
  hmacHeader: string | null,
  shopDomainFromHeader: string | null,
  shopDomainFromPayload: string | null | undefined,
  eventIdHeader: string | null,
  topic: "disputes/create" | "disputes/update",
): Promise<DisputeWebhookResult> {
  // 1. HMAC verification — unchanged.
  if (!verifyShopifyWebhook(rawBody, hmacHeader ?? "")) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  // 2. Parse payload upfront — needed for event-id idempotency and processor.
  let payload: DisputeWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as DisputeWebhookPayload;
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }

  // 3. Resolve shop. Unknown shop → 200 (no retry).
  const shopId = await resolveShopId(shopDomainFromHeader, payload);
  if (!shopId) return { status: 200, body: { ok: true, skipped: "unknown_shop" } };

  // 4. Event-id idempotency check.
  const idempotency = await checkAndClaim({
    shopId,
    eventId: eventIdHeader ?? `nohdr-${Date.now()}-${randomUUID()}`,
    topic,
    shopifyObjectId: payload.admin_graphql_api_id,
    payloadExcerpt: rawBody.slice(0, 2048),
  });
  if (idempotency.outcome === "duplicate") {
    return { status: 200, body: { ok: true, skipped: "duplicate_event" } };
  }

  // 5. Process + dispatch.
  const start = Date.now();
  try {
    const result = await processDisputeWebhook({
      shopId,
      mode: topic === "disputes/create" ? "create" : "update",
      payload,
    });
    await dispatchEffects({ shopId, result, topic });
    await markProcessed(idempotency.eventRowId, result.outcome, Date.now() - start);
    return { status: 200, body: { ok: true, outcome: result.outcome, events: result.events.length } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markProcessed(idempotency.eventRowId, "error", Date.now() - start, msg);
    // Return 500 so Shopify retries. Webhook handlers should be safe to retry.
    return { status: 500, body: { error: "Processing failed" } };
  }
}
```

**Modify:** `app/api/webhooks/disputes-create/route.ts` and `disputes-update/route.ts`
- Pass `req.headers.get("x-shopify-webhook-id")` and the topic string into `handleDisputeWebhook`.
- Otherwise unchanged.

**Tests:** `lib/webhooks/__tests__/handleDisputeWebhook.test.ts` — 8 tests covering: HMAC fail returns 401, invalid JSON returns 400, unknown shop returns 200, duplicate event_id returns 200 with skipped flag, fresh event proceeds to processor, processor exception returns 500 (Shopify retry), webhook with no X-Shopify-Webhook-Id header generates a fallback id, payload excerpt is truncated to 2048 chars.

### Commit 5 — `chore(cron): drop sync-disputes cadence to hourly`

**Modify:** `vercel.json`
- Change `*/5 * * * *` → `0 * * * *` for `/api/cron/sync-disputes`.
- Cron is now a reconciliation safety net, not the primary path.

**Modify:** `lib/disputes/syncDisputes.ts` JSDoc header
- Add explicit "webhook is primary, cron is fallback" note so future maintainers don't add 5-min poll logic back in.

**Modify:** `lib/automation/adaptiveCronSchedule.ts` (if it exists per audit)
- Adaptive cron can still tune itself, but the ceiling is now hourly. The adaptive logic was useful when cron was the primary signal; with webhooks primary, the adaptive layer just adds noise. Either keep it bounded to `[1h, 6h]` or short-circuit it for shops with healthy webhook delivery.

**Modify:** `docs/architecture.md`
- Add a "Dispute event flow" section documenting: webhook is primary path with <2s latency; cron is hourly reconciliation; idempotency layer is `webhook_events` keyed by `(shop_id, X-Shopify-Webhook-Id)`.

**No test changes required** — sync flow tests already pass against the refactored processor.

### Commit 6 — `feat(admin): /admin/webhooks observability panel`

**New page:** `app/admin/webhooks/page.tsx`

Server component. Reads the last 100 rows from `webhook_events` joined to `shops` for shop domain. Renders a table with:

| column | source |
|---|---|
| Received at | `received_at` (relative time + absolute on hover) |
| Shop | `shops.shop_domain` |
| Topic | `topic` |
| Object ID | `shopify_object_id` (truncated GID; click to open dispute) |
| Outcome | `outcome` badge (success / skipped / error) |
| Latency | `processing_ms` (color-coded: <500ms green, 500–2000 amber, >2000 red, error grey) |
| Error | `error_message` (truncated, expandable) |

Filters: `topic`, `outcome`, `shop_id`. Date range. Search by `shopify_object_id` (dispute GID).

Below the table: aggregate cards for the **last 24 hours**:
- Total events received
- % successfully applied (vs duplicate / unchanged / error)
- p50 / p95 processing latency
- Topic breakdown (pie chart? simple list)
- Top errors by count

**New API:** `app/api/admin/webhooks/route.ts` with pagination, filtering, and aggregate-stats subroute.

**Modify:** `app/admin/layout.tsx` or nav source — add "Webhooks" to the admin sidebar.

**Tests:** 3 tests covering the API route's filter parsing, pagination cursor handling, and aggregate-query SQL shape.

### Commit 7 — `docs(webhook-flow): runbook + Shopify Partner notes`

**New file:** `docs/runbooks/webhook-delivery.md`

Single page covering:
- How webhook delivery works end-to-end (Shopify → /api/webhooks/disputes-X → processor → dispatcher → DB + email + cron-tuning)
- The idempotency contract (event_id-based, 7-day retention)
- Latency expectations (<2s p50, <5s p95)
- What to check when webhooks appear slow or missing
  - `/admin/webhooks` panel
  - Shopify Partner dashboard → "Recent webhook deliveries"
  - `webhook_events` table direct query for a specific dispute GID
  - The hourly cron as fallback — if it caught something the webhook missed, that's a webhook delivery bug to investigate
- Manual replay: how to re-fire a webhook from Shopify Partner dashboard for one dispute, what to watch for
- Re-subscription flow on shop-update (which already exists at `app/api/webhooks/shop-update/route.ts:45`)

**Modify:** `docs/technical.md`
- Update "Dispute sync" section to lead with webhooks, cron secondary.
- Document `webhook_events` table schema + retention.
- Document `disputeWebhookProcessor` + `disputeEffectsDispatcher` boundary so future maintainers know where to extend behavior.

**Modify:** `docs/release-checklists/APP_STORE_TEMPLATE.md` (if applicable)
- Confirm the topics are listed as already-approved (no re-review needed).

## Files touched

**New:**
- `supabase/migrations/<timestamp>_webhook_events.sql`
- `lib/webhooks/eventIdempotency.ts` + test
- `lib/webhooks/disputeWebhookProcessor.ts` + test
- `lib/webhooks/disputeEffectsDispatcher.ts` + test
- `app/admin/webhooks/page.tsx`
- `app/api/admin/webhooks/route.ts` + test
- `app/api/cron/cleanup-webhook-events/route.ts`
- `docs/runbooks/webhook-delivery.md`

**Modified:**
- `lib/webhooks/handleDisputeWebhook.ts` (the big one — direct processing instead of job enqueue)
- `app/api/webhooks/disputes-create/route.ts` (pass event_id + topic)
- `app/api/webhooks/disputes-update/route.ts` (same)
- `lib/disputes/syncDisputes.ts` (extract per-dispute logic into processor, loop now calls processor + dispatcher per dispute)
- `vercel.json` (cron cadence 5min → 1h, add cleanup-webhook-events cron)
- `docs/technical.md` + `docs/architecture.md`

**Not touched:**
- `lib/shopify/registerDisputeWebhooks.ts` — registration is already correct
- `shopify.app.toml` — topics already declared (well, `disputes/create` and `disputes/update` are registered at runtime, not in TOML; that's fine and stays)
- `lib/webhooks/verify.ts` — HMAC code is correct
- All existing email senders, audit-event logging, build_pack pipeline — same hooks, just called from a faster trigger

## Risks + edge cases

1. **Webhook payload schema drift.** Shopify could change the payload shape between API versions. Mitigation: payload validation at the top of `processDisputeWebhook` with a strict Zod schema. On validation failure → 400 (the webhook handler catches and logs to `webhook_events` with `outcome: "error"`). The hourly cron acts as a safety net: even if a malformed payload is rejected, the next sync picks the dispute up.

2. **Lost webhook delivery.** Shopify retries 19 times with exponential backoff over ~48 hours. If our endpoint 5xx's persistently, we still get coverage from the hourly cron. Worst case: the merchant sees up to 1 hour of latency instead of <2s. Documented in the runbook.

3. **Race condition: webhook fires while cron is mid-sync.** Both call the same processor; processor reads-then-writes the dispute row. If both run concurrently, a small race exists where the diff calculation might use a stale `existing` snapshot. **Mitigation:** the upsert uses `onConflict: "shop_id,dispute_gid"`, so the last write wins — no data corruption, just a possibly-duplicated event emission. Since events are idempotent at the effect layer (alert claim guards, build_pack job dedup), the user-visible behavior is identical. Document and move on.

4. **`SUBMITTED_TO_NETWORK` UX downstream changes.** Activating it means: Regenerate gets disabled in `CompleteDefencePackageCard` (the `canRegenerate` gate we added today already handles this via `prompt_version` lag, but a clean separate gate on `presentationStatus === "SUBMITTED_TO_NETWORK"` is cleaner). Outcome countdown UX needs to render. Both are small follow-ups — out of scope for this plan but enabled by it.

5. **Cron cadence drop breaks the adaptive cron logic.** `updateAdaptiveCronSchedule()` may have heuristics keyed off 5-minute intervals. Audit before merging; if it explodes at 1-hour cadence, either neuter the adaptive layer or cap it. Won't know until we touch it — flagged as Commit 5 risk.

6. **Webhook handler timeout.** Vercel serverless functions on Node runtime get 10s (Pro) / 30s (Enterprise) timeouts. Direct processing including 1 GraphQL fetch + DB writes + email enqueue should be <2s p95. If processing ever pushes past 5s, the dispatcher should be deferred to a background job. Today: dispatch is sync. Add a timer log; if real-world p95 exceeds 3s, refactor to dispatch-via-queue in a follow-up.

7. **Privacy/PII in `payload_excerpt`.** Storing 2KB of webhook payload is mostly fine — dispute webhooks don't carry card numbers or full PII. But `payload_excerpt` MUST exclude raw PAN, CVV, full address, etc. The first-2KB-of-rawBody approach is naive. **Mitigation:** the excerpt is JSON-stringified after dropping a known-bad keys allowlist (none currently identified in Shopify's dispute schema, but the allowlist exists as a hook for future PII fields). Document the redaction rule in the migration comment.

8. **Time-travel webhook (`evidence_sent_on` set to null after being non-null).** Shouldn't happen per Shopify's contract, but if it does, we'd flip `normalized_status` BACK from `submitted_to_bank` to `saved_to_shopify`. **Mitigation:** the processor refuses to walk back a terminal-ish status. Add explicit guard: `evidence_sent_on` is set-once; if it transitions from non-null to null, ignore the transition and log a warning.

## Verification

1. **`npm test`** — all 1031 existing tests pass; ~25 new tests for the processor/dispatcher/idempotency layer.
2. **`npx tsc --noEmit`** — clean.
3. **`npm run build`** — clean.
4. **Local smoke**: trigger a synthetic webhook via curl with a valid HMAC signature; verify event lands in `webhook_events`, dispute row updates, audit event logs.
5. **Staging smoke**: open a test dispute in a Shopify development store; observe webhook receipt in `/admin/webhooks` within ~5s; verify dispute appears in `/app/disputes/<id>` without waiting for cron.
6. **Latency benchmark**: collect 24h of `webhook_events.processing_ms` data; p50 should be <500ms, p95 <2000ms.
7. **Replay test**: re-deliver a webhook from the Shopify Partner dashboard; verify second delivery returns `skipped: "duplicate_event"` and doesn't double-fire alerts or jobs.
8. **Cron reconciliation test**: temporarily disable webhook receipt (return 500 from handler), let cron tick once at 1-hour cadence, verify it catches up the missed dispute correctly.

## Out-of-scope (follow-ups, NOT this plan)

- **Webhook subscription for `disputes/finalize`** (terminal-outcome push) — Shopify doesn't expose a separate topic for this today; `disputes/update` carries `finalized_on` so we already cover it.
- **Real-time push notifications to the merchant browser** (websockets / SSE on the embedded app). Webhook arrival is the trigger; surfacing in-browser without page reload is a separate UX project.
- **`SUBMITTED_TO_NETWORK` UI activation** (Regenerate gate refinement + outcome countdown). Enabled by this plan; UI delivery is a separate small PR.
- **Outcome-posted email notifications.** Once we know `finalized_on` in real-time, we can send "your dispute closed" emails. Worth doing but separate scope.
- **Other webhook topics** (orders/create for proactive sync, refunds/create for fatal-loss detection ahead of dispute opening). Different workstreams.
- **Webhook subscription management UI** for merchants (the "your real-time integration is healthy" view). Admin-only observability is enough for v1.

## Estimated effort

- Commits 1–4: ~1 day (the new processor + dispatcher + handler rewrite is the meat; ~25 new tests)
- Commit 5: ~1 hour (cron cadence + docs)
- Commit 6: ~3 hours (admin panel — query + table + filters + aggregate cards)
- Commit 7: ~1 hour (docs)

**Total: 1.5–2 days of focused work.** Most of the risk is in the syncDisputes.ts refactor where shared-logic extraction happens; if the existing tests are thorough (audit suggests they are), the refactor is safe.
