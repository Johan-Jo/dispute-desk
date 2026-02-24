# Architecture — DisputeDesk (Dispute Ops)

## Overview

DisputeDesk is a Shopify public embedded app for chargeback evidence governance. It
generates structured evidence packs from Shopify Payments disputes, renders PDFs,
and saves evidence back to Shopify — without ever claiming to programmatically submit
dispute responses to card networks.

## System Diagram

```
┌──────────────────────────────────┐
│    Shopify Admin (embedded UI)   │
│    Polaris + App Bridge React    │
└──────────────┬───────────────────┘
               │ HTTPS
┌──────────────▼───────────────────┐
│    Next.js Node Runtime          │
│                                  │
│  ┌──────────┐  ┌──────────────┐  │
│  │ OAuth /  │  │ API Routes   │  │
│  │ Session  │  │ /api/*       │  │
│  │ Middleware│  │              │  │
│  └──────────┘  └──────┬───────┘  │
│                       │          │
│  ┌────────────────────▼───────┐  │
│  │   Job Worker               │  │
│  │   (cron → claim → execute) │  │
│  └────────────────────────────┘  │
└──────────────┬───────────────────┘
               │
   ┌───────────┼────────────┐
   │           │            │
   ▼           ▼            ▼
┌──────┐  ┌────────┐  ┌──────────────────┐
│Shopify│  │Supabase│  │Supabase Storage  │
│GraphQL│  │Postgres│  │(evidence-packs,  │
│Admin  │  │(RLS)   │  │ evidence-uploads)│
│API    │  │        │  │                  │
└──────┘  └────────┘  └──────────────────┘
```

## Auth Model

### Shopify OAuth

- **Offline session** (shop-wide): used for background sync, job execution,
  and all read operations. Stored encrypted with key versioning.
- **Online session** (user-scoped): required for `disputeEvidenceUpdate`
  (Epic 5) which operates in merchant-user context. Stored with `user_id`
  and `expires_at`.

### Supabase Access

Supabase is **server-only**. All database access goes through Next.js API
routes using the service role key.

- The anon key is NOT used by any client code.
- RLS is enabled on all tables as a defense-in-depth backstop.
- Shop isolation is enforced in application code by verifying the Shopify
  session and scoping all queries to `shop_id`.

### Why no JWT shop_id claims?

V1 does not rely on custom Supabase JWT claims for shop isolation. The
Shopify session (offline or online) is the source of truth for the
authenticated shop. This avoids complexity around claim issuance and
keeps the auth surface small.

## Async Job Architecture

Pack building and PDF rendering run as async jobs to avoid serverless
function timeouts:

1. API route creates the resource (pack row, etc.) and enqueues a job.
2. Route returns `202 Accepted` with `jobId` for polling.
3. Vercel Cron calls `POST /api/jobs/worker` every 2 minutes.
4. Worker claims queued jobs using `SELECT ... FOR UPDATE SKIP LOCKED`.
5. Handler executes the work, updates status, writes audit events.
6. UI polls `GET /api/jobs/:id` until `succeeded` or `failed`.

Per-shop concurrency: 1 running job at a time (V1).
Retry: up to 3 attempts with 30s × attempt backoff.

## Shopify API Version

Pinned centrally in `lib/shopify/client.ts`:

```
SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-01"
```

All GraphQL calls go through `requestShopifyGraphQL()` which uses this
version, implements retry with exponential backoff + jitter for throttling
(429, THROTTLED errors, 5xx), and never logs access tokens.

## Data Flow (V1)

1. UI requests dispute list → API route → Shopify GraphQL (paginated).
2. Dispute sync upserts into `disputes` table, including `dispute_evidence_gid`.
3. "Generate Pack" → API creates pack row + enqueues `build_pack` job.
4. Worker collects sources (order, fulfillment, policies) → writes
   `evidence_items` + `audit_events` → updates pack status to `ready`.
5. "Render PDF" → enqueues `render_pdf` job → worker renders, uploads
   to Storage, updates `pdf_path`.
6. "Save Evidence to Shopify" → uses online session + `dispute_evidence_gid`
   → calls `disputeEvidenceUpdate` → logs audit event.
7. User clicks deep-link to open dispute in Shopify Admin to finalize.

## Audit Log

`audit_events` table is append-only:
- Database triggers reject UPDATE and DELETE.
- `logAuditEvent()` is the only writer in application code.
- Events are never deleted (regulatory/compliance requirement).
