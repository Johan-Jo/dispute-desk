# EPIC 2 — Evidence Pack Builder

> **Status:** Done
> **Week:** 2–3
> **Dependencies:** EPIC 0, EPIC 1

## Goal

Evidence packs are generated **automatically** when disputes appear (via the
automation pipeline, see EPIC-A1). Manual "Generate Pack" remains as an override.
Packs include structured evidence JSON from Shopify data + policy snapshots,
with completeness scoring, blockers, and full audit trail.

## Implementation

### 2.1 — Evidence Source Collectors

Four source collectors run in parallel during pack build:

| Collector | File | Data Collected | Fields Provided |
|-----------|------|----------------|-----------------|
| Order | `lib/packs/sources/orderSource.ts` | Line items, amounts, billing/shipping (city-level, PII redacted), customer tenure, refund history | `order_confirmation`, `billing_address_match` |
| Fulfillment | `lib/packs/sources/fulfillmentSource.ts` | Carrier, tracking numbers, URLs, delivery status, fulfilled items | `shipping_tracking`, `delivery_proof` |
| Policy | `lib/packs/sources/policySource.ts` | Most recent policy snapshots per type (shipping, refunds, terms) with text previews | `shipping_policy`, `refund_policy`, `cancellation_policy` |
| Manual | `lib/packs/sources/manualSource.ts` | Merchant-uploaded files already attached to the pack | `customer_communication` |

### 2.2 — Pack Build Pipeline

`lib/packs/buildPack.ts` orchestrates the full build:

1. Load dispute + shop + session data from DB.
2. Decrypt offline session access token (AES-256-GCM).
3. Run all four source collectors concurrently via `Promise.allSettled`.
4. For each collected section, insert `evidence_items` row + audit event.
5. Compute completeness score from collected fields.
6. Assemble `pack_json` with all sections, completeness data, and any collector errors.
7. Update pack row: `status` = `ready` | `blocked`, score, checklist, blockers.

Job handler (`lib/jobs/handlers/buildPackJob.ts`) delegates to `buildPack()`,
then calls `evaluateAndMaybeAutoSave()` for the automation gate.

### 2.3 — Checklist Engine

Implemented in `lib/automation/completeness.ts` (shipped in EPIC A1).
Per dispute reason templates define required vs optional evidence fields.
Score = present / total × 100. Blockers = missing required items.

### 2.4 — Policy Snapshot Management

`policy_snapshots` table stores captured policy text with content hashes.
The policy source collector reads the most recent snapshot per type.
Full policy management UI deferred to EPIC 6 (Governance).

### 2.5 — API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/disputes/:id/packs` | Create pack + enqueue `build_pack` job → 202 `{ packId, jobId }` |
| GET | `/api/disputes/:id/packs` | List all packs for a dispute |
| GET | `/api/packs/:packId` | Full pack detail: items, checklist, audit log, active jobs |
| POST | `/api/packs/:packId/upload` | Upload manual evidence file (10 MB max) |

### 2.6 — Pack Preview UI

**Embedded (Polaris):** `app/(embedded)/app/packs/[packId]/page.tsx`
- Completeness progress bar with score
- Evidence checklist with check/cross icons and required badges
- Collapsible evidence sections with JSON payload viewer
- Drag-and-drop file upload via Polaris `DropZone`
- Audit log timeline
- Auto-polls every 3s while building

**Portal (Tailwind):** `app/(portal)/portal/packs/[packId]/page.tsx`
- Same feature set with portal design system
- File upload via native file input
- "Approve & Save" action button for ready packs

Both pages link from the dispute detail page.

### 2.7 — Manual File Upload

- Endpoint: `POST /api/packs/:packId/upload` (multipart form)
- Storage: Supabase Storage bucket **`evidence-packs`** at `{shopId}/{packId}/manual-{timestamp}.{ext}` (shared with pack PDFs; payload stores `storageBucket`). Bucket MIME / size constraints are managed in-repo via migrations `20260424150000_evidence_uploads_bucket.sql` and `20260424170000_evidence_packs_bucket_mime.sql` (both set `allowed_mime_types = null`, `file_size_limit >= 10 MB`). Neither bucket restricts MIME types anymore — the API allowlist is the single source of truth.
- Validation: 10 MB max, allowed types (PNG, JPEG, GIF, WebP, PDF, TXT, CSV)
- Creates `evidence_items` row with `source: manual_upload`
- Logs audit event (`item_added`)
- **Error surfacing:** Supabase Storage errors (MIME / size / duplicate) are mapped to merchant-safe copy by `merchantUploadMessage`; raw SDK messages are logged only. The dispute workspace hook reads the JSON `error` field and renders it inline.

## Key Files

- `lib/packs/buildPack.ts` — orchestrator
- `lib/packs/types.ts` — shared types (EvidenceSection, BuildContext)
- `lib/packs/sources/orderSource.ts` — Shopify order data
- `lib/packs/sources/fulfillmentSource.ts` — fulfillment/tracking data
- `lib/packs/sources/policySource.ts` — policy snapshots from DB
- `lib/packs/sources/manualSource.ts` — merchant uploads
- `lib/shopify/queries/orders.ts` — ORDER_DETAIL_QUERY + types
- `lib/jobs/handlers/buildPackJob.ts` — job handler (updated)
- `app/api/disputes/[id]/packs/route.ts` — create + list packs
- `app/api/packs/[packId]/route.ts` — pack detail (updated)
- `app/api/packs/[packId]/upload/route.ts` — file upload
- `app/(embedded)/app/packs/[packId]/page.tsx` — Polaris preview
- `app/(portal)/portal/packs/[packId]/page.tsx` — portal preview

## Acceptance Criteria

- [x] "Generate Pack" enqueues `build_pack` job, returns 202 with packId + jobId
- [x] Pack build runs all source collectors concurrently
- [x] Order, fulfillment, policy, and manual sources produce evidence_items rows
- [x] Each evidence item write produces an append-only audit_events entry
- [x] Completeness score computed from collected fields vs reason template
- [x] pack_json contains all sections, checklist, score, blockers
- [x] Pack preview UI shows checklist, expandable sections, audit log
- [x] Manual uploads stored in Supabase Storage and recorded as evidence_items
- [x] Auto-polls while pack is building
- [x] TypeScript checks pass, production build succeeds
