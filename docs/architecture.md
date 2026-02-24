# Architecture — DisputeDesk (Dispute Ops)

## Overview

DisputeDesk is a Shopify chargeback evidence governance app with **two surfaces**:

1. **Embedded App** — lives inside Shopify Admin (Polaris + App Bridge).
2. **External Portal** — standalone SaaS web app + marketing landing page.

Both share the same Next.js codebase, Supabase database, and API routes.

## Two Surfaces

| Surface | Route group | Auth model | UI toolkit | Purpose |
|---------|-------------|------------|------------|---------|
| Marketing | `(marketing)` — `/` | None (public) | Tailwind | Acquisition landing page |
| Portal Auth | `(auth)` — `/auth/*` | None (public) | Tailwind | Sign in / sign up / reset |
| Portal App | `(portal)` — `/portal/*` | Supabase Auth | Tailwind | SaaS web for merchants + team |
| Embedded App | `(embedded)` — `/app/*` | Shopify session | Polaris + App Bridge | Inside Shopify Admin |
| API | `/api/*` | Mixed (see below) | — | Backend routes |

### Why two surfaces?

The embedded app is the primary experience for merchants who install from the
Shopify App Store. The external portal serves:
- Team members who don't have Shopify Admin access.
- Merchants who prefer a standalone SaaS experience.
- Multi-store operators who want a single dashboard across shops.
- Public marketing and acquisition (hero landing page).

### Route group isolation

Next.js App Router route groups ensure:
- Marketing pages never load Polaris or App Bridge scripts.
- Portal pages use Supabase Auth (email/password, magic link).
- Embedded pages use Shopify session tokens.
- Each group has its own `layout.tsx` with appropriate providers.

## System Diagram

```
┌─────────────────────────────────┐    ┌──────────────────────────────────┐
│  Marketing (/)                  │    │    Shopify Admin (embedded UI)   │
│  Public landing, Tailwind       │    │    Polaris + App Bridge React    │
└──────────────┬──────────────────┘    └──────────────┬───────────────────┘
               │                                      │
┌──────────────▼──────────────────┐                   │
│  Portal (/portal/*)             │                   │
│  Supabase Auth, Tailwind        │                   │
└──────────────┬──────────────────┘                   │
               │                                      │
               └──────────┬──────────────────────────-┘
                          │ HTTPS
               ┌──────────▼───────────────────┐
               │    Next.js Node Runtime      │
               │                              │
               │  ┌──────────┐  ┌───────────┐ │
               │  │ OAuth /  │  │ API Routes│ │
               │  │ Session  │  │ /api/*    │ │
               │  │ Middleware│  │           │ │
               │  └──────────┘  └─────┬─────┘ │
               │                      │       │
               │  ┌───────────────────▼─────┐ │
               │  │   Job Worker            │ │
               │  │   (cron → claim → exec) │ │
               │  └─────────────────────────┘ │
               └──────────────┬───────────────┘
                              │
                  ┌───────────┼────────────┐
                  │           │            │
                  ▼           ▼            ▼
            ┌──────┐    ┌────────┐   ┌──────────────────┐
            │Shopify│    │Supabase│   │Supabase Storage  │
            │GraphQL│    │Postgres│   │(evidence-packs,  │
            │Admin  │    │+ Auth  │   │ evidence-uploads)│
            │API    │    │(RLS)   │   │                  │
            └──────┘    └────────┘   └──────────────────┘
```

## Auth Model

### Shopify OAuth (Embedded App)

- **Offline session** (shop-wide): used for background sync, job execution,
  and all read operations. Stored encrypted with key versioning.
- **Online session** (user-scoped): required for `disputeEvidenceUpdate`
  (Epic 5) which operates in merchant-user context. Stored with `user_id`
  and `expires_at`.

### Supabase Auth (External Portal)

- Portal users authenticate via Supabase Auth (email/password or magic link).
- Session is stored as an HTTP-only cookie by Supabase SSR helpers.
- Portal users connect Shopify stores via OAuth. This creates:
  - A `shops` row (or finds existing).
  - An offline session (same as embedded).
  - A `portal_user_shops` row linking the portal user to the shop.

### Supabase DB Access

Supabase is **server-only** for data access. All database queries go through
Next.js API routes using the service role key.

- The anon key is used ONLY for Supabase Auth (portal sign-in/sign-up).
- RLS is enabled on all tables as a defense-in-depth backstop.
- Shop isolation is enforced in application code by verifying the Shopify
  session (embedded) or the `portal_user_shops` link (portal).

### Portal → Shop Access Flow

1. Portal user signs up / signs in (Supabase Auth).
2. User clicks "Connect Shopify Store" → triggers Shopify OAuth with `source=portal`.
3. OAuth callback creates shop + offline session + `portal_user_shops` row.
4. User selects active shop from dropdown → stored in `active_shop_id` cookie.
5. All portal data queries scope to `active_shop_id` via the user's linked shops.

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

## Cross-Cutting: Two-Surface UX Copy Compliance

Both surfaces (embedded + portal) must use "Save evidence" language — never
"submit response" or "submit dispute". The CI `forbidden-copy` grep check
covers all source files and translation files.

Portal always deep-links to Shopify Admin for final submission.

## Audit Log

`audit_events` table is append-only:
- Database triggers reject UPDATE and DELETE.
- `logAuditEvent()` is the only writer in application code.
- Events are never deleted (regulatory/compliance requirement).
