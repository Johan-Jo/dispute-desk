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

### UI toolkit split

| Surface | CSS / Components | Icons |
|---------|-----------------|-------|
| Embedded | Polaris (Shopify design system) | Polaris built-in |
| Portal + Marketing + Auth | Tailwind CSS + `components/ui/*` (CVA) | lucide-react |

The shared component library lives in `components/ui/` and uses
`class-variance-authority` for type-safe variants plus `clsx` /
`tailwind-merge` for conditional class merging. Design tokens are defined
as CSS custom properties in `app/globals.css` (prefixed `--dd-*`).
See [`docs/technical.md`](technical.md) for the full component catalog.

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

All heavy operations run as async jobs to avoid serverless function
timeouts:

| Job type | Trigger | Handler |
|----------|---------|---------|
| `sync_disputes` | Cron (every 2–5 min) or manual | Fetch disputes from Shopify, upsert, trigger automation pipeline |
| `build_pack` | Automation pipeline or manual | Collect sources, score completeness, evaluate auto-save gate |
| `render_pdf` | Manual request | Render PDF, upload to Storage |
| `save_to_shopify` | Auto-save gate or manual approve | Push evidence to Shopify via GraphQL |

### Execution model

1. Trigger creates the resource and enqueues a job row.
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

## Data Flow (V1) — Automation-First

DisputeDesk operates as an **automation-first** pipeline. The default
behavior is fully automatic; merchants configure gates and thresholds.

### Automatic flow (default)

1. **Sync** — `sync_disputes` cron job (or manual trigger) fetches disputes
   from Shopify GraphQL, upserts into `disputes` table.
2. **Auto-build** — for each new/updated dispute, `runAutomationPipeline()`
   checks `shop_settings.auto_build_enabled`. If ON, creates an
   `evidence_packs` row and enqueues a `build_pack` job.
3. **Build** — worker collects sources (order, fulfillment, policies),
   writes `evidence_items` + `audit_events`, runs the completeness engine
   (per-reason templates → score + blockers + recommended actions).
4. **Auto-save gate** — `evaluateAndMaybeAutoSave()` checks:
   - `auto_save_enabled` on store settings
   - `completeness_score >= auto_save_min_score`
   - `blockers == 0` (if `enforce_no_blockers`)
   - `require_review_before_save` (parks pack for manual approval)
5. **Save** — if gates pass, enqueues `save_to_shopify` job → worker
   calls `disputeEvidenceUpdate` with evidence GID → logs audit event →
   updates pack status to `saved_to_shopify`.
6. **Review queue** — if review is required, pack stays in `ready`
   status. Merchant clicks "Approve & Save" → triggers save job.
7. **Submit** — merchant finalizes in Shopify Admin (or Shopify
   auto-submits on the dispute due date).

### Manual overrides

Merchants can always:
- Trigger a manual sync (`POST /api/disputes/sync`)
- Generate a pack manually (existing `build_pack` flow)
- Approve a parked pack (`POST /api/packs/:packId/approve`)

### Pack status flow

```
queued → building → ready → saved_to_shopify
                  → blocked (missing required evidence)
                  → ready (parked for review) → approve → saved_to_shopify
                  → failed
```

### Automation settings (per store)

| Setting | Default | Description |
|---------|---------|-------------|
| auto_build_enabled | true | Auto-create packs on new disputes |
| auto_save_enabled | false | Auto-push evidence to Shopify |
| require_review_before_save | true | Park packs for manual approval |
| auto_save_min_score | 80 | Min completeness score for auto-save |
| enforce_no_blockers | true | Block save if required items missing |

Settings are stored in `shop_settings` (010_automation.sql) with
auto-upsert via `ensure_shop_settings()` RPC.

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
