# EPIC 7 — Hardening: Security, Observability, Data Retention

> **Status:** Pending
> **Week:** 5–6
> **Dependencies:** All previous epics

## Goal

Production-readiness: secure all endpoints, make the audit log truly immutable, add monitoring, and handle the full app lifecycle.

## Tasks

### 7.1 — Webhook Verification
- All `/api/webhooks/*` routes verify `X-Shopify-Hmac-SHA256` against app secret.
- Reject and log tampered requests.
- Register: `app/uninstalled`, `shop/update`. Attempt `disputes/create` or `disputes/update` if available for 2026-01.

### 7.2 — Rate Limiting
- Per-shop: 100 requests/minute for authenticated routes.
- Global: 1000 requests/minute for webhook routes.
- In-memory rate limiter (`rate-limiter-flexible`) for V1.

### 7.3 — Request Signing and Validation
- Verify embedded requests come from Shopify (shop param vs session).
- Zod schemas on all API route inputs.
- CSRF protection for state-changing operations.

### 7.4 — Immutable Audit Enforcement
- DB triggers reject UPDATE/DELETE on `audit_events` (deployed in EPIC 0).
- `logAuditEvent()` is the only writer in application code.
- Integration test: attempt UPDATE/DELETE and assert failure.

### 7.5 — App Uninstall Cleanup
- On `app/uninstalled` webhook:
  - Delete all `shop_sessions`.
  - Set `shops.uninstalled_at`.
  - Cancel queued/running jobs.
  - Do NOT delete dispute/pack/audit data (compliance retention).

### 7.6 — Data Retention
- `retention_days` on `shops` (default: 365).
- Background job: archive packs older than retention period (`status: archived`), delete PDF from Storage.
- Audit events are never deleted.

### 7.7 — Structured Logging and Error Monitoring
- Structured JSON: `{ shopId, disputeId, packId, requestId, action, duration }`.
- Sentry integration for unhandled exceptions.
- Log Shopify API errors with redacted metadata.

### 7.8 — Security Checklist
- [ ] No hardcoded secrets; all from env vars.
- [ ] Tokens encrypted at rest with key rotation.
- [ ] Minimum scopes: `read_orders`, `read_shopify_payments_disputes`, `write_shopify_payments_dispute_evidences`.
- [ ] SQL injection safe (Supabase parameterized queries).
- [ ] XSS safe (React auto-escapes).
- [ ] CORS restricted to Shopify domains.
- [ ] `npm audit` in CI, no critical vulnerabilities.

### 7.9 — Performance Baseline
- P95 disputes list load < 2s.
- P95 pack generation < 2 min.
- P95 PDF render < 30s.
- Timing middleware logs route response times.

## Key Files
- `lib/webhooks/verify.ts`
- `lib/middleware/rateLimit.ts`
- `lib/middleware/validate.ts`
- `lib/audit/logEvent.ts`
- `app/api/webhooks/app-uninstalled/route.ts`, `app/api/webhooks/shop-update/route.ts`
- `supabase/functions/retention-cleanup/` (Edge Function)
- `.github/workflows/ci.yml`

## Acceptance Criteria
- [ ] Tampered webhooks rejected (tested).
- [ ] Rate limiting returns 429 when exceeded.
- [ ] `audit_events` UPDATE/DELETE fails at DB level (integration test).
- [ ] Uninstall cleans sessions and cancels jobs; data retained.
- [ ] Structured logs include correlation IDs.
- [ ] Error monitoring captures unhandled exceptions.
- [ ] `npm audit` shows no critical vulnerabilities.
- [ ] P95 targets met: disputes list < 2s, PDF success > 95%.
