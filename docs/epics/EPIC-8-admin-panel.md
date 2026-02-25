# EPIC 8 — Internal Admin Panel

> **Status:** Done
> **Week:** 6–7
> **Dependencies:** EPIC 0, EPIC 6, EPIC 7

## Goal

Provide an internal operator dashboard for monitoring shops, jobs, billing, and support investigations — separate from the merchant-facing embedded app.

## Implementation Summary

### 8.1 — Admin Auth
- **V1 approach:** env-based `ADMIN_SECRET` with HTTP-only cookie session (8h TTL).
- `lib/admin/auth.ts` — `validateAdminCredentials`, `createAdminSession`, `hasAdminSession`, `clearAdminSession`.
- `app/api/admin/login/route.ts` — POST endpoint for login.
- `app/api/admin/logout/route.ts` — GET endpoint clears session and redirects.
- `middleware.ts` — extended to protect `/admin/*` routes (redirects unauthenticated to `/admin/login`).

### 8.2 — Admin Layout & Dashboard
- `app/admin/layout.tsx` — dark sidebar shell with nav links (Dashboard, Shops, Jobs, Audit Log, Billing). Login page bypasses layout.
- `app/admin/page.tsx` — metrics dashboard: active shops, disputes, packs, job queue status, plan distribution, pack status breakdown.
- `app/api/admin/metrics/route.ts` — aggregates all metrics from Supabase.

### 8.3 — Shop Overview & Overrides
- `app/admin/shops/page.tsx` — searchable shop list with domain, plan, install date, status.
- `app/admin/shops/[id]/page.tsx` — shop detail with dispute/pack counts + admin overrides panel (plan, pack limit, notes).
- `app/api/admin/shops/route.ts` — list shops with search/filter.
- `app/api/admin/shops/[id]/route.ts` — GET detail, PATCH overrides (logs `admin_override` audit event).
- `supabase/migrations/013_shops_admin_overrides.sql` — adds `pack_limit_override`, `auto_pack_enabled`, `admin_notes` columns.

### 8.4 — Job Monitoring
- `app/admin/jobs/page.tsx` — filterable job table with status badges, stale detection (>10min running), error display.
- Actions: Retry failed jobs (reset to queued), Cancel queued/running jobs.
- `app/api/admin/jobs/route.ts` — list with stale enrichment.
- `app/api/admin/jobs/[id]/route.ts` — PATCH retry/cancel.

### 8.5 — Audit Log Viewer
- `app/admin/audit/page.tsx` — searchable by shop ID and event type, expandable payload viewer.
- CSV export button.
- `app/api/admin/audit/route.ts` — filterable query with `?format=csv` option.

### 8.6 — Billing Dashboard
- `app/admin/billing/page.tsx` — MRR display, plan distribution cards, per-shop usage table with progress bars.
- `app/api/admin/billing/route.ts` — calculates MRR from PLANS definitions, aggregates monthly pack usage.

## Audit Event Types Added
- `admin_override` — logged when admin modifies shop plan/limits/notes.
- `billing_activated`, `billing_declined`, `data_retained` — future-proofed types.

## Key Files
- `lib/admin/auth.ts`
- `app/admin/layout.tsx`, `app/admin/page.tsx`
- `app/admin/shops/page.tsx`, `app/admin/shops/[id]/page.tsx`
- `app/admin/jobs/page.tsx`
- `app/admin/audit/page.tsx`
- `app/admin/billing/page.tsx`
- `app/api/admin/{login,logout,metrics,shops,jobs,audit,billing}/*`
- `middleware.ts` (admin guard)
- `supabase/migrations/013_shops_admin_overrides.sql`

## UI Stack
- Tailwind CSS (standalone internal tool, not Polaris).
- Functional tables, filters, and action buttons.
- Dark sidebar with light content area.

## Acceptance Criteria
- [x] Admin routes protected by separate auth (not accessible to merchants).
- [x] Shop list with search, filter, and drill-down.
- [x] Job monitoring with retry/cancel actions.
- [x] Audit log searchable by shop, event type, with CSV export.
- [x] Billing dashboard shows MRR and plan distribution.
- [x] Manual plan overrides work and are logged in audit_events.
