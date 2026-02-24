# EPIC 1 — Dispute Sync

> **Status:** Pending
> **Week:** 1–2
> **Dependencies:** EPIC 0

## Goal

Merchants see their Shopify Payments disputes in the embedded app with filtering, detail views, and the ability to manually trigger a sync.

## Tasks

### 1.1 — Shopify GraphQL Dispute Queries
- `lib/shopify/queries/disputes.ts` with paginated list and detail queries.
- List query returns `disputeEvidence { id }` (critical for Epic 5).
- Pin API version 2026-01 in client config.

### 1.2 — Dispute Sync Service
- `lib/disputes/syncDisputes.ts` — fetches all disputes from Shopify, upserts into `disputes` table, stores `dispute_evidence_gid`, updates `last_synced_at`.
- Normalize `raw_snapshot` to strip PII (redact cardholder name, last-4 only for card).
- Handle cursor-based pagination through all pages.

### 1.3 — API Routes
- `GET /api/disputes` — query with filters: `status` (open, won, lost, pending), `dueBefore` (ISO date), pagination.
- `GET /api/disputes/:id` — single dispute with all columns.
- `POST /api/disputes/:id/sync` — re-fetch one dispute from Shopify and upsert.
- `POST /api/disputes/sync-all` — bulk sync for all disputes.

### 1.4 — Disputes List UI
- `app/disputes/page.tsx` — Polaris `IndexTable` showing: dispute reason, status badge, amount, due date, order link, last synced.
- Filters: status dropdown, due-date range picker.
- "Sync Now" button triggers bulk sync, shows loading state, refreshes list.
- Pagination controls.

### 1.5 — Dispute Detail UI
- `app/disputes/[id]/page.tsx` — Polaris `Page` with:
  - Summary card: reason, status, amount, initiated date, due date countdown.
  - Linked order card: order number with deep-link to Shopify Admin order page.
  - Actions area: "Generate Pack" button (placeholder, wired in EPIC 2), "Sync" button.

### 1.6 — Scheduled Sync
- `sync_disputes` job handler runs automatically via Vercel Cron (every 2–5 min).
- Each sync triggers the automation pipeline (`runAutomationPipeline()`) for new/updated disputes.
- Manual "Sync Now" button also available as override.
- See EPIC-A1 for the full automation pipeline details.

## Key Files
- `lib/shopify/queries/disputes.ts`
- `lib/disputes/syncDisputes.ts`
- `app/api/disputes/route.ts`, `app/api/disputes/[id]/route.ts`, `app/api/disputes/[id]/sync/route.ts`
- `app/disputes/page.tsx`, `app/disputes/[id]/page.tsx`

## Acceptance Criteria
- [ ] Disputes page loads in < 2 seconds for 100 disputes.
- [ ] Each dispute has a stable route at `/disputes/:id`.
- [ ] `disputes` table reflects Shopify state after sync; `last_synced_at` updated.
- [ ] `dispute_evidence_gid` populated when present.
- [ ] Filters narrow the list correctly by status and due date.
- [ ] No PII stored in `raw_snapshot` beyond what's needed for evidence.
