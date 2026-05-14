# EPIC LSE-6 — Direct Network Submission (Verifi + Ethoca)

> **Status:** Planned — partnership-gated
> **Phase / week target:** Phase 6 of Liability-Shift Engine — Weeks 33+ or whenever partnerships close (potentially year 2)
> **Dependencies:** EPIC LSE-2, EPIC LSE-3, **plus** signed commercial agreement with Verifi (for CE 3.0) and/or Ethoca (for FPT)
> **Track:** LSE (Liability-Shift Engine)
> **Source PRD:** [`docs/liability-shift-engine-prd.md`](../liability-shift-engine-prd.md) §6 (long-term submission strategy)

## Goal

When commercial partnerships are in place, route qualifying CE 3.0 packages directly to **Verifi VROL** and qualifying FPT packages directly to **Ethoca Consumer Clarity**, bypassing the best-effort Shopify dispute API path. Track outcomes per channel and migrate eligible merchants from best-effort to direct over time.

This epic exists in the plan so the architecture stays honest: the v1 LSE platform is a **readiness + best-effort** product, and direct network submission is the upgrade path that closes the loop.

## Non-goals (explicit)

- Building this **before** at least one partnership is signed. There is no value in the integration without the credentials.
- Replacing the Shopify dispute API path. Best-effort via Shopify continues to run *in parallel* — direct submission is an addition, not a swap, until win-rate data justifies otherwise.
- Mastercard 3DS Identity Check Insights (pre-auth FPT) — structurally unavailable to a Shopify app regardless of partnerships.

## Pre-conditions (partnership gates)

This epic does **not** start engineering until at least one of:

| Gate | What unlocks |
|------|--------------|
| Verifi VROL commercial agreement signed, app or app-merchant integration path defined | CE 3.0 sub-track |
| Ethoca Consumer Clarity data-partner enrollment completed, Merchant Transactions API credentials in hand | FPT sub-track |

Either gate independently unlocks the corresponding half of this epic. Both can be done in parallel once credentials are in hand. Until then, this epic stays in **planned** state and parallel commercial conversations continue (started in Phase 1, per PRD §10).

## Architecture (sub-track 1: Verifi VROL for CE 3.0)

```
qualifying ce30 pack ready (LSE-2 output)
            │
            ▼
submissionRouter (LSE-2 module, extended)
   ├─ if shop.lse.verifi_enabled → enqueue verifi_submit job
   │     └─ verifiClient.submitPreArbitration({
   │           dispute, package_pdf, ce30_match_summary
   │         })
   └─ keep shopify_dispute_api parallel submission for now

submission_logs row: channel = 'verifi'
   └─ outcome polled from Verifi API or webhook
```

**Touchpoints:**
- New module: `lib/liabilityShift/verifi/client.ts`
- New job handler: `lib/jobs/handlers/verifiSubmitJob.ts`
- New webhook endpoint: `POST /api/webhooks/verifi/outcome`
- Secrets: encrypted Verifi credentials per shop in `shop_secrets` table (existing infra)

## Architecture (sub-track 2: Ethoca Consumer Clarity for FPT)

```
ready fpt package (LSE-3 output)
            │
            ▼
submissionRouter (extended)
   ├─ if shop.lse.ethoca_enabled → enqueue ethoca_submit job
   │     └─ ethocaClient.submitMerchantTransaction({
   │           dispute, fpt_categories, package_pdf
   │         })
   └─ keep shopify_dispute_api parallel submission for now

submission_logs row: channel = 'ethoca'
   └─ outcome polled from Ethoca or webhook
```

**Touchpoints:**
- New module: `lib/liabilityShift/ethoca/client.ts`
- New job handler: `lib/jobs/handlers/ethocaSubmitJob.ts`
- New webhook endpoint: `POST /api/webhooks/ethoca/outcome`
- Secrets: encrypted Ethoca credentials per shop in `shop_secrets`

## Migration strategy (per-merchant)

When a partnership goes live:
1. **Opt-in beta** — 3–5 friendly merchants enable direct submission alongside best-effort
2. **A/B period** — run direct + best-effort in parallel for 60–90 days, log outcomes per channel
3. **Confidence threshold** — if `submission_logs` shows direct channel win rate ≥ best-effort by a defined margin, default to direct-only for new merchants
4. **Migration UI** — existing merchants see "Upgrade to direct submission" banner with explainer
5. **Sunset best-effort** — only after at least 6 months of direct-channel data and a deliberate decision; never silently

## Database changes

Migration: `supabase/migrations/NNN_lse_direct_submission.sql`

### Extend `shop_settings`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `lse_verifi_enabled` | boolean | false | Direct CE 3.0 via Verifi |
| `lse_verifi_credentials_id` | uuid | nullable | FK to encrypted credentials row |
| `lse_ethoca_enabled` | boolean | false | Direct FPT via Ethoca |
| `lse_ethoca_credentials_id` | uuid | nullable | FK to encrypted credentials row |
| `lse_keep_shopify_parallel` | boolean | true | Send via Shopify dispute API alongside direct, until trust is built |

### Extend `submission_logs`

| Column | Type | Description |
|--------|------|-------------|
| `channel` | text | Add `verifi` and `ethoca` to allowed set |
| `retry_count` | int | Direct channels may need retry on transient errors |
| `partner_dispute_id` | text nullable | Verifi case ID or Ethoca dispute reference |

### New table: `lse_partner_credentials`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `shop_id` | uuid FK | |
| `partner` | text | `verifi`, `ethoca` |
| `credentials_encrypted` | bytea | AES-256-GCM via `lib/security/` |
| `valid_through` | timestamptz nullable | partner-issued expiry, if any |
| `created_at` | timestamptz | |
| `revoked_at` | timestamptz nullable | |

Strict RLS — even shop members can't read decrypted credentials, only server-side handlers.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/lse/partners/verifi/connect` | Initiate Verifi credential setup (likely OAuth or API-key paste, depending on what Verifi exposes) |
| POST | `/api/lse/partners/ethoca/connect` | Same for Ethoca |
| POST | `/api/lse/partners/:partner/disconnect` | Revoke credentials |
| POST | `/api/webhooks/verifi/outcome` | Verifi outcome callback (HMAC-verified) |
| POST | `/api/webhooks/ethoca/outcome` | Ethoca outcome callback |
| GET | `/api/lse/partners/status` | Connection state per partner |

## UI changes

### Settings → Integrations (new sub-tab)
- "Verifi VROL" connection card — connect / disconnect, status, last successful submission timestamp
- "Ethoca Consumer Clarity" connection card — same
- Toggle: "Send via Shopify dispute API in parallel" (default ON during A/B period; can be disabled after confidence is established)

### Dispute detail page (LSE-1 / LSE-2 / LSE-3 panels evolve)
- CE 3.0 panel: shows "Submitted via Verifi VROL — case ID …" when direct submission ran
- FPT panel: shows "Submitted via Ethoca Consumer Clarity — reference …" when direct submission ran
- Both panels honor the parallel-submission flag

### Dashboard
- New KPI: "Direct submissions this period" (split CE 3.0 / FPT)
- New chart: win-rate by channel over time (Shopify dispute API vs. direct)

## i18n keys

New namespace `liabilityShift.partners.*`: partner names, connection states, error codes, outcome labels. Translate across all 6 locales.

## Failure modes specific to direct submission

| Failure | Handling |
|---------|----------|
| Verifi API 5xx | Retry with exponential backoff up to 5 times; on final fail, log and fall back to Shopify dispute API if `keep_shopify_parallel` was disabled |
| Verifi rejects payload schema | Hard alert; do not retry; capture full response in `submission_logs.raw_response` |
| Ethoca rate-limited | Queue with backpressure; alert if backlog > 100 |
| Outcome webhook lost | Daily reconciliation job polls partner API for outstanding cases |
| Partner credential expires | Pre-expiry email warning; disable submission gracefully on expiry |

## Acceptance criteria

(Only meaningful once partnership credentials exist. List here for completeness.)

- [ ] Partnership prerequisite documented in `docs/lse-partnerships.md` (created during epic) — agreement signed and credentials in hand
- [ ] Migration applied via `npm run db:migrate` in the same session
- [ ] `lib/liabilityShift/verifi/client.ts` (or `ethoca/client.ts`) wraps the partner API with auth, retry, and idempotency
- [ ] Successful direct submission on at least one real dispute on a friendly beta shop, end-to-end
- [ ] Outcome webhook updates `submission_logs.final_outcome` on a real outcome
- [ ] Daily reconciliation job catches missing webhooks
- [ ] Settings UI lets a merchant connect and disconnect each partner
- [ ] A/B period dashboard shows per-channel win rate
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` all green
- [ ] `docs/technical.md` updated with §*Direct Network Submission* (partner integration, parallel-submission policy, migration plan)
- [ ] Help article in `lib/help/` updated explaining what changed for merchants and the trust-building parallel period
- [ ] Security review of credential storage and webhook verification

## What to do until the partnership lands

(Continuous work, not engineering on this epic.)

1. **Verifi outreach** — established in Phase 1; check-in monthly. Target inbound from a Verifi BD contact.
2. **Ethoca outreach** — established in Phase 1; check-in monthly. Mastercard owns Ethoca, so MA partner-channel introductions are the highest-leverage path.
3. **Volume + outcomes story** — by end of Phase 5 we should have several quarters of `submission_logs` data showing DisputeDesk-generated CE 3.0 / FPT package quality. That's the pitch deck for partnership BD.
4. **Shopify Partners conversation** — long-shot but worth ongoing: lobby for native CE 3.0 schema fields in the dispute evidence API. If Shopify adds them before partnerships land, this epic's CE 3.0 sub-track may become unnecessary (or much smaller).
