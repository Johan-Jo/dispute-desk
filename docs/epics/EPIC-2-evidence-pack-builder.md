# EPIC 2 — Evidence Pack Builder

> **Status:** Pending
> **Week:** 2–3
> **Dependencies:** EPIC 0, EPIC 1

## Goal

Evidence packs are generated **automatically** when disputes appear (via the
automation pipeline, see EPIC-A1). Manual "Generate Pack" remains as an override.
Packs include structured evidence JSON from Shopify data + policy snapshots,
with completeness scoring, blockers, and full audit trail.

## Tasks

### 2.1 — Evidence Source Collectors
- `lib/packs/sources/orderSource.ts` — fetch order via GraphQL: line items, billing/shipping address (redacted), amounts, discounts.
- `lib/packs/sources/fulfillmentSource.ts` — fetch fulfillments: carrier, tracking number, tracking URL, ship date, delivery status.
- `lib/packs/sources/policySource.ts` — read `policy_snapshots` table; if stale (>7 days) or missing, re-fetch from merchant URLs and store new snapshot with `content_hash`.
- `lib/packs/sources/manualSource.ts` — handle merchant-uploaded files from Supabase Storage.

### 2.2 — Pack Build Pipeline
- `lib/packs/buildPack.ts` orchestrator:
  1. Create `evidence_packs` row with status `building`.
  2. Run each source collector; insert `evidence_items` row per result.
  3. For each item write, insert `audit_events` row (`event_type: item_added`).
  4. Compute checklist and completeness score.
  5. Update pack: `status = ready`, `pack_json`, `checklist`, `completeness_score`.
  6. Insert `audit_events` (`event_type: pack_created`).
  7. On error: set `status = failed`, log event.
- Runs as async job (enqueued via `build_pack` job type).

### 2.3 — Checklist Engine
- `lib/packs/checklist.ts` — per dispute reason (fraudulent, product_not_received, unrecognized, etc.), return recommended evidence fields.
- Each item: `{ field, label, required: bool, present: bool }`.
- Completeness score = present / total * 100.
- Definitions stored as static config for V1.

### 2.4 — Policy Snapshot Management
- `app/settings/policies/page.tsx` — merchant enters URLs for refund, shipping, and terms policies.
- On save: fetch URL, extract text (HTML-to-text), hash content, store in `policy_snapshots`.
- Display last captured date + "Re-capture" button.

### 2.5 — API Routes
- `POST /api/disputes/:id/packs` — enqueues `build_pack` job, returns 202 with `{ packId, jobId }`.
- `GET /api/packs/:packId` — returns pack with evidence items, checklist, audit log, active job status.

### 2.6 — Pack Preview UI
- `app/packs/[packId]/page.tsx`:
  - Checklist with check/cross icons, overall completeness badge.
  - Expandable sections per evidence type (order, shipping, policies, uploads).
  - Source attribution for each item.
  - Audit log timeline at bottom.
  - Actions: "Render PDF" (EPIC 3), "Save to Shopify" (EPIC 5).
  - Job polling: shows "Building..." state until job completes.

### 2.7 — Manual File Upload
- On dispute detail or pack preview, merchant uploads supporting files (images, PDFs up to 10 MB).
- Stored in Supabase Storage `evidence-uploads/{shopId}/{packId}/`.
- Metadata added as `evidence_items` with `source: manual_upload`.

## Key Files
- `lib/packs/buildPack.ts`, `lib/packs/checklist.ts`
- `lib/packs/sources/orderSource.ts`, `fulfillmentSource.ts`, `policySource.ts`, `manualSource.ts`
- `lib/audit/logEvent.ts`
- `app/api/disputes/[id]/packs/route.ts`, `app/api/packs/[packId]/route.ts`
- `app/packs/[packId]/page.tsx`, `app/settings/policies/page.tsx`

## Acceptance Criteria
- [ ] "Generate Pack" with tracking produces pack with order, fulfillment, policy sections in < 30 seconds.
- [ ] Pack JSON saved in `evidence_packs.pack_json`.
- [ ] Each evidence item has a corresponding `evidence_items` row.
- [ ] Every item write produces an append-only `audit_events` entry.
- [ ] Checklist shows correct present/missing items for the dispute reason code.
- [ ] Completeness score displayed on pack preview.
- [ ] Manual uploads appear in pack as evidence items.
