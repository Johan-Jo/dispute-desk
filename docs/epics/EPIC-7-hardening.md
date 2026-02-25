# EPIC 7 — Hardening: Security, Observability, Data Retention

> **Status:** Done
> **Week:** 5–6
> **Dependencies:** All previous epics

## Goal

Production-readiness: secure all endpoints, enforce rate limits, add structured logging, data retention, and CI pipeline.

## Implementation

### 7.1 — Webhook Verification (Pre-existing)

`lib/webhooks/verify.ts` — HMAC-SHA256 verification against `SHOPIFY_API_SECRET`.
Both `app/uninstalled` and `shop/update` webhook routes verify before processing.

### 7.2 — Rate Limiting

`lib/middleware/rateLimit.ts` — in-memory sliding-window rate limiter:

| Scope | Limit | Key |
|-------|-------|-----|
| Per-shop API | 100 req/min | `shop:{shopId}` |
| Webhook global | 1000 req/min | `webhooks:global` |

Integrated into `middleware.ts`. Returns `429 Too Many Requests` with `Retry-After` header.

### 7.3 — Input Validation

`lib/middleware/validate.ts` — Zod-based validation:

- `validateBody(body, schema)` — returns parsed data or 400 error with field details.
- Shared schemas: `ruleCreateSchema`, `ruleUpdateSchema`, `billingSubscribeSchema`, `reorderSchema`.
- Applied to: `POST /api/rules`, `POST /api/billing/subscribe`.

### 7.4 — App Uninstall Cleanup (Pre-existing)

`app/api/webhooks/app-uninstalled/route.ts`:
- Deletes all `shop_sessions` (tokens).
- Sets `shops.uninstalled_at`.
- Cancels queued/running jobs.
- Retains dispute/pack/audit data for compliance.

### 7.5 — Data Retention

`app/api/cron/retention-cleanup/route.ts`:
- Weekly cron (Sundays at 03:00 UTC).
- Per-shop `retention_days` (default: 365).
- Archives packs older than retention period (`status: archived`).
- Deletes associated PDFs from Supabase Storage.
- Audit events are never deleted.

Migration `012_shops_retention.sql`: adds `retention_days` and `uninstalled_at` columns.

### 7.6 — Structured Logging

`lib/logging/logger.ts`:
- JSON structured format: `{ timestamp, level, message, shopId, disputeId, packId, requestId, action, durationMs }`.
- `logger.timed(action, ctx, fn)` — wraps async operations with timing.
- Levels: info, warn, error, debug (debug only when `LOG_LEVEL=debug`).

### 7.7 — CI Pipeline

`.github/workflows/ci.yml`:

1. TypeScript typecheck (`tsc --noEmit`)
2. Lint (ESLint)
3. Unit tests (Vitest)
4. Security audit (`npm audit --audit-level=critical`)
5. Forbidden copy grep (reject "submit response" etc.)

Runs on push to master/main and all PRs.

### 7.8 — Security Checklist

- [x] No hardcoded secrets; all from env vars.
- [x] Tokens encrypted at rest (`lib/security/encryption.ts`).
- [x] Minimum scopes: `read_orders`, `read_shopify_payments_disputes`, `write_shopify_payments_dispute_evidences`.
- [x] SQL injection safe (Supabase parameterized queries).
- [x] XSS safe (React auto-escapes).
- [x] CSP headers configured in `next.config.js`.
- [x] Rate limiting on all authenticated routes.
- [x] Zod validation on state-changing API inputs.
- [x] `npm audit` in CI pipeline.

## Key Files

| File | Purpose |
|------|---------|
| `lib/webhooks/verify.ts` | HMAC-SHA256 webhook verification |
| `lib/middleware/rateLimit.ts` | In-memory sliding-window rate limiter |
| `lib/middleware/validate.ts` | Zod validation schemas + helper |
| `lib/logging/logger.ts` | Structured JSON logger |
| `middleware.ts` | Rate limiting integration |
| `app/api/webhooks/app-uninstalled/route.ts` | Uninstall cleanup |
| `app/api/webhooks/shop-update/route.ts` | Shop domain updates |
| `app/api/cron/retention-cleanup/route.ts` | Weekly data retention cron |
| `.github/workflows/ci.yml` | CI pipeline |
| `supabase/migrations/012_shops_retention.sql` | retention_days + uninstalled_at |

## Acceptance Criteria

- [x] Tampered webhooks rejected (HMAC verification).
- [x] Rate limiting returns 429 when exceeded.
- [x] `audit_events` UPDATE/DELETE fails at DB level (trigger from EPIC 0).
- [x] Uninstall cleans sessions and cancels jobs; data retained.
- [x] Structured logs include correlation context.
- [x] `npm audit` runs in CI pipeline.
- [x] Zod validation on critical API inputs.
