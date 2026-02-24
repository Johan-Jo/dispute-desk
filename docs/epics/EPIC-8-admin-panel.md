# EPIC 8 — Internal Admin Panel

> **Status:** Pending
> **Week:** 6–7
> **Dependencies:** EPIC 0, EPIC 6, EPIC 7

## Goal

Provide an internal operator dashboard for monitoring shops, jobs, billing, and support investigations — separate from the merchant-facing embedded app.

## Tasks

### 8.1 — Admin Auth
- Separate auth system (NOT Shopify OAuth — this is for us, not merchants).
- Options: Supabase Auth (email/password or magic link) or a simple env-based admin secret for V1.
- Protect all `/admin/*` routes with admin session middleware.
- Role support: `super_admin`, `support` (read-only). V1 can start with single role.

### 8.2 — Shop Overview
- `/admin/shops` — list all shops: domain, plan, install date, uninstalled_at, session status.
- Search by domain. Filter by plan, active/uninstalled.
- Click into shop detail: sessions, disputes count, packs count, last activity.

### 8.3 — Dispute & Pack Metrics
- `/admin/metrics` — aggregate dashboard:
  - Total shops (active / uninstalled).
  - Total disputes synced, packs generated, PDFs rendered.
  - Success/failure rates for pack builds and PDF renders.
  - Packs per day/week trend.

### 8.4 — Job Monitoring
- `/admin/jobs` — list jobs with filters: status, job_type, shop.
- See queued/running/failed jobs with error details.
- Actions: retry failed job, cancel queued job.
- Stale job detection: flag jobs locked for > 10 minutes.

### 8.5 — Audit Log Viewer
- `/admin/audit` — search audit events across all shops.
- Filter by shop, event_type, date range.
- Full event_payload display for support investigations.
- Export to CSV.

### 8.6 — Billing Dashboard
- `/admin/billing` — MRR summary, plan distribution (free/starter/pro), upgrade/downgrade history.
- Per-shop usage: packs this month vs limit.
- Manual overrides: upgrade/downgrade a shop's plan, extend limits for trial.

### 8.7 — Feature Flags / Overrides
- `/admin/shops/:id/overrides` — per-shop toggles:
  - Force plan tier (bypass billing for beta testers).
  - Extend monthly pack limit.
  - Disable/enable auto-pack.
  - Add admin notes (internal only).

## Key Files
- `app/admin/layout.tsx` (admin shell with sidebar nav)
- `app/admin/page.tsx` (dashboard)
- `app/admin/shops/page.tsx`, `app/admin/shops/[id]/page.tsx`
- `app/admin/jobs/page.tsx`
- `app/admin/audit/page.tsx`
- `app/admin/billing/page.tsx`
- `app/admin/metrics/page.tsx`
- `lib/admin/auth.ts` (admin session management)
- `middleware.ts` (extend to protect `/admin/*` routes)

## UI Notes
- This is NOT an embedded Shopify app — it's a standalone internal tool.
- Use shadcn/ui or plain Tailwind (not Polaris) since it's operator-facing.
- Keep it functional, not fancy. Tables, filters, action buttons.

## Acceptance Criteria
- [ ] Admin routes protected by separate auth (not accessible to merchants).
- [ ] Shop list with search, filter, and drill-down.
- [ ] Job monitoring with retry/cancel actions.
- [ ] Audit log searchable by shop, event type, date range.
- [ ] Billing dashboard shows MRR and plan distribution.
- [ ] Manual plan overrides work and are logged in audit_events.
