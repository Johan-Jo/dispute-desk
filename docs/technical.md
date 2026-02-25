# Technical Specification — DisputeDesk

## Tech Stack

| Layer              | Technology                                         |
|--------------------|----------------------------------------------------|
| Embedded UI        | React 18 + Polaris + App Bridge React              |
| Portal / Marketing | React 18 + Tailwind CSS + custom design system     |
| Server             | Next.js 15 App Router (Node runtime)               |
| Auth (Portal)      | Supabase Auth (`@supabase/ssr`)                    |
| Auth (Embedded)    | Shopify OAuth (offline + online sessions)          |
| Database           | Supabase Postgres with RLS                         |
| Storage            | Supabase Storage (private buckets)                 |
| PDF                | @react-pdf/renderer (deterministic, no browser)    |
| Deployment         | Vercel (serverless + cron)                         |
| CI/CD              | GitHub Actions                                     |

## Shopify API

### Scopes

```
read_orders
read_shopify_payments_disputes
write_shopify_payments_dispute_evidences
```

### API Version

Pinned to `2026-01` via `SHOPIFY_API_VERSION` env var. Default in code
if env var is unset. All queries go through `requestShopifyGraphQL()`.

### Permissions Note

**Saving evidence** (`disputeEvidenceUpdate`) requires the merchant user
to have the Shopify admin permission **"Manage orders information"** in
their staff account. This is NOT an OAuth scope — it is a Shopify Admin
permission.

**Troubleshooting "Access denied" errors on save:**
1. Verify the user has "Manage orders information" permission in Shopify Admin → Settings → Plan and permissions.
2. Ensure the app has `write_shopify_payments_dispute_evidences` scope.
3. Ensure the user is authenticated with an online session (not offline).

### GraphQL Throttle Handling

`lib/shopify/graphql.ts` wraps all calls with:
- Retry on HTTP 429, 5xx, and `THROTTLED` error extension.
- Exponential backoff with jitter (base 1s, up to 3 retries).
- Reads `extensions.cost.throttleStatus` when available.
- Never logs access tokens; includes correlation ID.

## Authentication

### Session Types

| Type    | Use Case                            | Token Lifetime |
|---------|-------------------------------------|----------------|
| Offline | Background sync, job execution, reads | Permanent      |
| Online  | Save evidence (user-context mutation) | Short-lived    |

Both stored in `shop_sessions` with encrypted access tokens (AES-256-GCM)
and key versioning for rotation.

### Encryption Key Rotation

- Keys named `TOKEN_ENCRYPTION_KEY_V1`, `TOKEN_ENCRYPTION_KEY_V2`, etc.
- `encrypt()` always uses the highest-numbered key.
- `decrypt()` reads `keyVersion` from stored payload and selects the right key.
- `TOKEN_ENCRYPTION_KEY` env var is a backward-compat alias for V1.

## Supabase Access Model

**Server-only for data access.** All data queries use `getServiceClient()`
with the service role key. Shop isolation is enforced by verifying the
Shopify session (embedded) or `portal_user_shops` link (portal), then
scoping all queries to `shop_id`.

The **anon key** is exposed as `NEXT_PUBLIC_SUPABASE_ANON_KEY` and used
**only** for Supabase Auth in the portal (sign-in, sign-up, password reset).
It never accesses application data tables.

RLS is enabled on all tables as defense-in-depth. Policies allow service
role full access. If a request somehow bypasses application code, RLS
prevents cross-shop data leakage.

## Async Jobs

### Architecture

Jobs table (`007_jobs.sql`) + claim RPC (`008_claim_jobs_rpc.sql`) +
worker endpoint (`/api/jobs/worker`).

### Job Types

| Type             | Trigger                              | Handler                                |
|------------------|--------------------------------------|----------------------------------------|
| sync_disputes    | Cron or POST /api/disputes/sync      | lib/jobs/handlers/syncDisputesJob.ts   |
| build_pack       | Automation pipeline or manual        | lib/jobs/handlers/buildPackJob.ts      |
| render_pdf       | POST /api/packs/:packId/render-pdf   | lib/jobs/handlers/renderPdfJob.ts      |
| save_to_shopify  | Auto-save gate or POST .../approve   | lib/jobs/handlers/saveToShopifyJob.ts  |

### Execution Flow

1. API route validates + creates resource → enqueues job → returns 202.
2. Vercel Cron hits worker every 2 minutes.
3. Worker claims jobs via `SELECT ... FOR UPDATE SKIP LOCKED`.
4. Per-shop concurrency: max 1 running job (V1).
5. Retry: 3 attempts, 30s × attempt backoff on failure.
6. UI polls `GET /api/jobs/:id` every 3 seconds until terminal state.

## Database Migrations

| File | Contents |
|------|----------|
| 001_core_shops_sessions.sql | shops + shop_sessions (online/offline, key_version) |
| 002_disputes.sql | disputes with dispute_evidence_gid |
| 003_evidence_packs_items.sql | evidence_packs + evidence_items |
| 004_audit_events.sql | audit_events + immutability triggers |
| 005_rules_policies.sql | rules + policy_snapshots |
| 006_rls_policies.sql | RLS policies (service role access) |
| 007_jobs.sql | jobs table for async work |
| 008_claim_jobs_rpc.sql | claim_jobs() RPC with SKIP LOCKED |
| 009_portal.sql | portal_user_profiles + portal_user_shops + RLS |
| 010_automation.sql | shop_settings + evidence_packs automation fields |

## Automation Pipeline

DisputeDesk is **automation-first**. The pipeline runs automatically
when disputes are detected:

### Flow

1. `sync_disputes` job fetches disputes from Shopify (cron or manual).
2. For each new dispute, `runAutomationPipeline()` checks `shop_settings`:
   - If `auto_build_enabled` → enqueue `build_pack` job.
3. `build_pack` collects evidence sources, evaluates completeness.
4. `evaluateAndMaybeAutoSave()` checks the auto-save gate:
   - `auto_save_enabled` + `score >= threshold` + `blockers == 0` + review status.
   - Decision: `auto_save` | `park_for_review` | `block`.
5. If `auto_save` → enqueue `save_to_shopify` job.

### Key modules

| Module | Path | Purpose |
|--------|------|---------|
| Settings | `lib/automation/settings.ts` | Read/write shop_settings with auto-upsert |
| Completeness | `lib/automation/completeness.ts` | Per-reason templates, score + blockers |
| Auto-Save Gate | `lib/automation/autoSaveGate.ts` | Decision logic for auto-save |
| Pipeline | `lib/automation/pipeline.ts` | Orchestrator: trigger build + evaluate gate |

### Pack Status Flow

```
queued → building → ready → saved_to_shopify
                  → blocked (missing required items)
                  → ready (parked for review → approve → saved_to_shopify)
                  → failed
```

## Evidence Pack Builder

### Build Pipeline (`lib/packs/buildPack.ts`)

1. Load dispute → shop → offline session from DB
2. Decrypt access token (AES-256-GCM)
3. Run 4 source collectors concurrently (`Promise.allSettled`)
4. Insert `evidence_items` rows + audit events per section
5. Compute completeness from collected fields
6. Assemble `pack_json`, update pack row

### Source Collectors (`lib/packs/sources/`)

| Collector | File | Fields Provided |
|-----------|------|-----------------|
| Order | `orderSource.ts` | `order_confirmation`, `billing_address_match` |
| Fulfillment | `fulfillmentSource.ts` | `shipping_tracking`, `delivery_proof` |
| Policy | `policySource.ts` | `shipping_policy`, `refund_policy`, `cancellation_policy` |
| Manual | `manualSource.ts` | `customer_communication` |

### GraphQL Queries

| Query | File | Purpose |
|-------|------|---------|
| `ORDER_DETAIL_QUERY` | `lib/shopify/queries/orders.ts` | Full order: line items, fulfillments, addresses, refunds, customer |
| `DISPUTE_LIST_QUERY` | `lib/shopify/queries/disputes.ts` | Paginated dispute list |
| `DISPUTE_DETAIL_QUERY` | `lib/shopify/queries/disputes.ts` | Single dispute with order + evidence |

### Manual Upload

- Endpoint: `POST /api/packs/:packId/upload` (multipart)
- Storage: Supabase Storage `evidence-uploads/{shopId}/{packId}/`
- Max 10 MB, types: PNG, JPEG, GIF, WebP, PDF, TXT, CSV
- Creates `evidence_items` row with `source: manual_upload`

## PDF Rendering & Storage

### Template (`lib/packs/pdf/`)

- `styles.ts` — `@react-pdf/renderer` stylesheet with project-branded tokens.
- `EvidencePackDocument.tsx` — Two-page React-PDF document:
  - **Cover**: Shop name, dispute ref, date, completeness score (color-coded), blockers.
  - **Content**: Checklist, blockers/recommended actions, order details, shipping/tracking, policies, manual attachments, audit trail.

### Render Pipeline

1. `POST /api/packs/:packId/render-pdf` enqueues `render_pdf` job (returns 202).
2. Job handler (`lib/jobs/handlers/renderPdfJob.ts`) loads pack + related data, calls `renderPackPdf()`.
3. `renderPackPdf()` (`lib/packs/renderPdf.tsx`) renders via dynamic imports.
4. PDF buffer uploaded to Supabase Storage `evidence-packs/{shopId}/{packId}/{timestamp}.pdf`.
5. `evidence_packs.pdf_path` updated; `pdf_rendered` audit event logged.

### Download

- `GET /api/packs/:packId/download` returns 1-hour signed URL from Supabase Storage.

### Dynamic Import Pattern (aligned with Estimate Pro)

`@react-pdf/renderer` has native dependencies (`yoga-layout`) that hang webpack if statically imported. The solution (matching the proven Estimate Pro pattern) uses a dedicated runtime module:

- **`lib/packs/pdf/reactPdfRuntime.ts`** — exports `getReactPdfRenderer()` and `getEvidencePackDocumentModule()` as async dynamic imports.
- **`lib/packs/renderPdf.tsx`** — calls the runtime module, uses `React.createElement()` + `renderToBuffer()`.
- **`export const runtime = "nodejs"`** — set on render-pdf, download, and worker API routes.
- **No `serverExternalPackages`** needed — dynamic imports keep the package out of webpack's static analysis graph entirely.

## API Surface

### Public
- `GET /api/health`
- `POST /api/webhooks/app-uninstalled` (HMAC verified)
- `POST /api/webhooks/shop-update` (HMAC verified)

### Portal Auth
- `POST /api/auth/portal/sign-out` — sign out portal user

### Shopify OAuth
- `GET /api/auth/shopify` — start OAuth (accepts `source=portal` + `return_to`)
- `GET /api/auth/shopify/callback` — complete OAuth, link portal user if portal source

### Automation
- `GET /api/automation/settings?shop_id=...` — read shop automation settings
- `PATCH /api/automation/settings` — update automation toggles
- `POST /api/disputes/sync` — enqueue dispute sync job
- `POST /api/packs/:packId/approve` — approve pack for save + enqueue job

### Authenticated (Shopify session required)
- `GET /api/disputes`
- `GET /api/disputes/:id`
- `POST /api/disputes/:id/sync`
- `POST /api/disputes/:id/packs` → 202 `{ packId, jobId }` (creates pack + enqueues build)
- `GET /api/disputes/:id/packs` → list packs for a dispute
- `GET /api/packs/:packId` → full pack: items, checklist, audit log, active jobs
- `POST /api/packs/:packId/upload` → multipart file upload (10 MB, creates evidence_item)
- `POST /api/packs/:packId/render-pdf` → 202 + jobId
- `POST /api/packs/:packId/save-to-shopify` (online session required)
- `GET /api/packs/:packId/download`
- `GET /api/jobs/:id`

### Internal (CRON_SECRET required)
- `POST /api/jobs/worker`

## Design System

The portal and marketing surfaces use a custom design system built on
Tailwind CSS with shared components in `components/ui/`.

### Design Tokens (CSS custom properties in `app/globals.css`)

| Token | Value | Usage |
|-------|-------|-------|
| `--dd-bg` | `#F6F8FB` | App background |
| `--dd-surface` | `#FFFFFF` | Card / panel background |
| `--dd-text` | `#0B1220` | Primary text |
| `--dd-text-muted` | `#64748B` | Secondary text |
| `--dd-border` | `#E5E7EB` | Borders and dividers |
| `--dd-primary` | `#1D4ED8` | Primary actions |
| `--dd-primary-deep` | `#4F46E5` | Focus rings, accents |
| `--dd-success` | `#22C55E` | Success indicators |
| `--dd-warning` | `#F59E0B` | Warning indicators |
| `--dd-danger` | `#EF4444` | Error / destructive |

### Shared Components (`components/ui/`)

| Component | File | Description |
|-----------|------|-------------|
| Button | `button.tsx` | CVA variants: primary, secondary, ghost, danger × sm/md/lg |
| Badge | `badge.tsx` | CVA variants: default, success, warning, danger, info, primary |
| AuthCard | `auth-card.tsx` | Centered card with title, subtitle, children, footer |
| TextField | `text-field.tsx` | Input with label, error, and helper text |
| PasswordField | `password-field.tsx` | Password input with toggle visibility + strength meter |
| OAuthButton | `oauth-button.tsx` | Shopify-branded OAuth button (green) |
| Divider | `divider.tsx` | Horizontal rule with optional label ("or") |
| InlineError | `inline-error.tsx` | Red alert banner with icon |
| InfoBanner | `info-banner.tsx` | Contextual banner: info, warning, success, danger |
| KPICard | `kpi-card.tsx` | Metric card with label, value, change indicator |
| cn() | `utils.ts` | `clsx` + `tailwind-merge` utility |

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `tailwindcss` | Utility-first CSS framework |
| `class-variance-authority` | Type-safe component variants |
| `lucide-react` | Icon library (consistent with design) |
| `clsx` + `tailwind-merge` | Conditional + deduplicated class names |

## Governance Controls & Review Queue

### Rule Engine

`lib/rules/evaluateRules.ts` — deterministic, first-match-wins evaluator:

1. Fetches enabled rules for shop, ordered by `priority ASC`.
2. Each rule has `match` (JSONB: reason[], status[], amount_range) + `action` (JSONB: mode, require_fields).
3. All match conditions are AND-joined; empty match = match all.
4. First matching rule wins. No match defaults to `{ mode: "review" }`.
5. Every evaluation logged as `rule_applied` audit event.

### Sync Integration

When `syncDisputes()` detects a new dispute:
- Calls `evaluateRules()` with dispute context.
- `auto_pack` → triggers `runAutomationPipeline()`.
- `review` → sets `needs_review = true` on the dispute row.

### Review Queue

Both embedded and portal dispute pages have an "All Disputes" / "Review Queue" tab.
Review queue filters `needs_review=true`, sorted by due date (most urgent first).
Each row has an "Approve" button that clears `needs_review`, logs `rule_overridden`, and triggers automation.

### Completeness Gate

Pack preview pages show a yellow warning banner when `completeness_score < 60%`:
- Lists missing required checklist items.
- Guidance only — merchant can still proceed.

### Rules API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rules?shop_id=` | GET | List rules (priority order) |
| `/api/rules` | POST | Create rule |
| `/api/rules/:id` | PATCH | Update rule |
| `/api/rules/:id` | DELETE | Delete rule |
| `/api/rules/reorder` | POST | Reorder by priority |
| `/api/disputes/:id/approve` | POST | Approve from review queue |

## Testing

### Unit Tests (Vitest)

| Suite | File | Assertions |
|-------|------|------------|
| Completeness Engine | `lib/automation/__tests__/completeness.test.ts` | 7 tests: per-reason scoring, blocker detection, recommended actions, GENERAL fallback, edge cases |
| Auto-Save Gate | `lib/automation/__tests__/autoSaveGate.test.ts` | 9 tests: gate pass/block/park logic, threshold boundaries, priority ordering, approval overrides |

Run with:
```bash
npx vitest run
```

### E2E Smoke Test (live DB)

`scripts/smoke-test.mjs` runs against the real Supabase database and validates:

1. Shop creation + `shop_settings` upsert with correct defaults
2. Dispute seeding + DB round-trip (reason, amount, currency)
3. Evidence pack creation + job enqueue
4. Completeness scoring: low score + blockers → `blocked` status
5. Auto-save gate: score below threshold → block decision
6. High-score pack simulation → `ready` status, gate passes
7. Save-to-Shopify simulation: `saved_to_shopify` status + timestamp
8. Audit log recording + immutability trigger enforcement
9. Extended status enum validation (`draft`, `blocked`, `saved_to_shopify`)
10. Full cleanup (no leftover test data)

Run with:
```bash
node scripts/smoke-test.mjs
```

Requires `.env.local` with `SUPABASE_URL_POSTGRES` configured.

## CI Pipeline

1. Typecheck (`tsc --noEmit`)
2. Lint (ESLint)
3. Build
4. Tests (Vitest: contract + unit)
5. Forbidden copy grep (reject "submit response" etc. in UI code)
6. `npm audit --audit-level=critical`
