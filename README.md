# DisputeDesk — Shopify Chargeback Evidence Governance

> **Branding note:** The name "DisputeDesk" may overlap with disputedesk.co.
> Consider using **DisputeDesk.app** or an alternative for public branding.
> This is non-blocking for development.

## What It Does

DisputeDesk is an **automation-first** Shopify chargeback evidence app.
Connect once, and DisputeDesk handles the rest:

1. **Auto-sync** — disputes are fetched from Shopify automatically.
2. **Auto-build** — evidence packs are generated automatically when a
   dispute appears (orders, tracking, policies, uploads).
3. **Auto-save** — when the pack passes your rules (completeness score
   + no blockers), evidence is saved back to Shopify via API.
4. **Submit in Shopify** — submission to the card network happens in
   Shopify Admin, or Shopify auto-submits on the due date.

Merchants control the automation with per-store settings:
- Toggle auto-build and auto-save independently
- Require manual review before auto-save (default for Free/Starter)
- Set a minimum completeness score threshold (default 80%)
- Enable/disable the "zero blockers" gate

**Important:** DisputeDesk saves evidence to Shopify — it does NOT
programmatically submit dispute responses to card networks.

## Surfaces

DisputeDesk ships as two web surfaces from one codebase:

| Surface | URL | Auth | Description |
|---------|-----|------|-------------|
| Marketing | `/` (en), `/de`, `/es`, `/fr`, `/pt`, `/sv` | Public | Localized landing (SEO paths; messages use BCP-47 files) |
| Portal Auth | `/auth/*` | Public | Sign in, sign up, password reset |
| Portal App | `/portal/*` | Supabase Auth | SaaS web: disputes, packs, settings |
| Embedded App | `/app/*` | Shopify session | Inside Shopify Admin (Polaris) |
| API | `/api/*` | Mixed | Backend routes |

- **Embedded app** is the primary surface for merchants who install from Shopify.
- **Portal** serves team members without Shopify Admin access, multi-store
  operators, and merchants who prefer a standalone web experience.

## Tech Stack

- **Frontend (Embedded):** React 18 + Polaris + App Bridge React
- **Frontend (Portal/Marketing):** React 18 + Tailwind CSS + custom design system
- **UI Components:** `components/ui/` — Button, Badge, AuthCard, TextField, PasswordField, KPICard, InfoBanner, etc. (CVA + lucide-react)
- **Backend:** Next.js 15 App Router (Node runtime)
- **Auth (Portal):** Supabase Auth via @supabase/ssr (email/password, magic link)
- **Auth (Embedded):** Shopify OAuth (offline + online sessions)
- **Database:** Supabase Postgres (server-only access, RLS enabled)
- **Storage:** Supabase Storage (private buckets for PDFs + uploads)
- **PDF:** @react-pdf/renderer
- **Deployment:** Vercel + Vercel Cron
- **CI:** GitHub Actions

## Local Setup

### Prerequisites

- Node.js 20+
- npm
- Supabase CLI (`npx supabase`)
- Shopify CLI (`npx shopify`)
- A Shopify Partner account + dev store

### Steps

```bash
# 1. Clone and install
cd DisputeDesk
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in all values (see .env.example for descriptions)

# 3. Apply Supabase migrations (Supabase CLI — same as in docs/technical.md)
npx supabase login   # one-time
npx supabase link --project-ref sddzuglxdnkhcnjmcpbj   # one-time per clone (database password from dashboard)
npm run db:migrate   # alias for `npx supabase db push`
# Edge case without CLI link: `npm run db:migrate:script` (needs Postgres URI in .env.local — see .env.example)

# 4. Start dev server
npm run dev

# 5. Start Shopify tunnel (separate terminal)
npx shopify app dev
```

### Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Purpose |
|----------|---------|
| `SHOPIFY_API_KEY` | App API key from Shopify Partners |
| `SHOPIFY_API_SECRET` | App secret for webhook verification + OAuth |
| `SHOPIFY_API_VERSION` | Pinned GraphQL API version (default: `2026-01`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key (used for portal auth only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key (never expose to client) |
| `TOKEN_ENCRYPTION_KEY_V1` | AES-256-GCM key for token encryption (64 hex chars) |
| `CRON_SECRET` | Shared secret for cron → worker endpoint auth |

### Shopify Scopes

```
read_orders
read_shopify_payments_disputes
write_shopify_payments_dispute_evidences
```

### Permissions

Saving evidence requires the merchant user to have **"Manage orders
information"** permission in Shopify Admin (Settings → Plan and permissions).
This is a Shopify Admin permission, not an OAuth scope.

**Troubleshooting "Access denied" on save:**
1. Check user has "Manage orders information" in Shopify Admin.
2. Verify app has `write_shopify_payments_dispute_evidences` scope.
3. Ensure user has an active online session (re-open app from Shopify Admin).

**Troubleshooting blank Embedded Packs page:**
- Re-open DisputeDesk from **Shopify Admin** (Apps > DisputeDesk) so the embedded shop session is established.
- DisputeDesk resolves the shop identity server-side (httpOnly cookies + middleware), so the UI cannot rely on reading it directly in the browser.

## Project Structure

```
app/
  (marketing)/       → Public landing page (Tailwind)
  (auth)/auth/       → Sign in, sign up, forgot/reset password, magic link
  (portal)/portal/   → SaaS dashboard, disputes, packs, rules, billing, team
  (embedded)/app/    → Shopify Admin embedded UI (Polaris)
  (embedded)/app/setup/[step]/ → Setup wizard pages (Polaris)
  api/               → Backend routes (auth, webhooks, jobs, packs, disputes)
  api/setup/         → Setup wizard state management routes
  api/integrations/  → Third-party integration routes (Gorgias, etc.)
  api/files/         → Evidence sample file management routes
  globals.css        → Tailwind imports + design tokens
components/ui/       → Shared design system components
components/setup/    → Setup wizard components (shell, steps, modals, progress ring)
lib/
  shopify/           → GraphQL client, throttle, session helpers, queries
  supabase/          → Server client, portal auth helpers
  portal/            → Active shop cookie + linked shop queries
  automation/        → Pipeline, completeness engine, auto-save gate, settings
  packs/             → Pack builder orchestrator + source collectors
  jobs/              → Job dispatcher + handlers (sync, build, save, render)
  disputes/          → Dispute sync service
  setup/             → Setup wizard types, constants, event logging
  security/          → AES-256-GCM encryption (sessions + integration secrets)
  help/              → Help articles, categories, guide configs, analytics
scripts/             → Migration runner + smoke test
supabase/migrations/ → SQL migrations (001–023)
content/policy-templates/ → Markdown policy templates (refund, shipping, terms)
tests/               → Unit tests + API route handler tests + test helpers
docs/                → Architecture, technical spec, epics, roadmap
```

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full system
design, two-surface architecture, auth models, async job architecture,
and data flow.

See [`docs/technical.md`](docs/technical.md) for the design system
reference, component catalog, API surface, and CI pipeline.

## Development

### Running Tests

```bash
# Unit + API route handler tests
npx vitest run

# E2E smoke test (requires .env.local with SUPABASE_URL_POSTGRES)
node scripts/smoke-test.mjs

# E2E browser tests (Playwright) — portal Setup Checklist, etc.
npm run test:e2e
```

**E2E tests** require `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` in `.env.local`. The
test user must have at least one connected shop (via Connect Shopify). Add these
to `.env.local`:

```
E2E_TEST_EMAIL=your-test-user@example.com
E2E_TEST_PASSWORD=your-test-password
```

With the dev server already running (e.g. on port 3001), run:

```bash
$env:PLAYWRIGHT_BASE_URL="http://localhost:3001"; npm run test:e2e
```

Otherwise Playwright will start the app on port 3099 (ensure that port is free).

Tests include:
- **Contract tests:** Validate Shopify GraphQL response shapes (zod schemas)
- **Unit tests:** Encryption roundtrip, field mapping, completeness scoring, auto-save gate logic, setup wizard constants/types/events, URL param helpers
- **API route handler tests:** Setup state/step/skip/undo-skip, integrations status, Gorgias connect/disconnect, sample file upload/list/delete (using custom Supabase + Next.js mocks)
- **E2E smoke test:** Seeds a dispute into live Supabase, validates the full automation pipeline (shop settings, pack creation, completeness scoring, gate decisions, save simulation, audit immutability), then cleans up

### Testing: Mirror a Shopify store

To create **Shopify-backed** test data (orders, fulfillments, and real test disputes), follow [docs/testing-store-mirror.md](docs/testing-store-mirror.md). Mirroring means data exists in Shopify first and is synced into Supabase.

### Synthetic disputes (DB-only; not mirrored)

To test the pipeline and UI with many dispute rows **without** creating them in Shopify, use the synthetic dispute seed script. It inserts rows into Supabase only; these disputes **do not exist in Shopify** and are for UI/dev only.

```bash
# Seed 20 synthetic disputes for dev shop (requires SUPABASE_URL_POSTGRES in .env.local)
npm run seed:synthetic-disputes

# Or with options:
node scripts/seed-synthetic-disputes.mjs --shop dev-store.myshopify.com --count 30
node scripts/seed-synthetic-disputes.mjs --shop-id <uuid> --count 20
node scripts/seed-synthetic-disputes.mjs --shop dev-store.myshopify.com --cleanup
```

Synthetic disputes use `dispute_gid` like `gid://shopify/ShopifyPaymentsDispute/seed-1` and are shown with a **Synthetic** badge in the app.

### Real disputes (test-mode checkout)

To create **real** test chargebacks in Shopify Payments, use the real-dispute generator. It places orders through **storefront checkout** using Shopify's disputed-transaction test card; those orders appear in **Shopify Payments → Disputes**. Requires Shopify Payments in **test mode**, a product (handle or variant ID), and an Admin API token for tagging. See [docs/real-disputes.md](docs/real-disputes.md) for details, options, and limitations.

```bash
# One order (requires test-mode ack and SHOPIFY_ADMIN_TOKEN)
npm run seed:real-disputes -- --shop surasvenne.myshopify.com --product-handle my-product --i-know-this-is-test-mode
```

### Test dispute evidence (append + submit) end-to-end

The script `scripts/test-dispute-evidence.mjs` verifies against a **real** Shopify Payments dispute in your dev/test store:

1. **Append (draft):** Updates an evidence text field and confirms it appears as draft (evidence not submitted).
2. **Submit:** Attempts programmatic submit via `submitEvidence: true` and reports whether the dispute moved to submitted.

**Env vars:** `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`; optional `SHOPIFY_API_VERSION` (default `2026-01`).

**Run:**

```bash
# Use first eligible dispute from the store
node scripts/test-dispute-evidence.mjs

# Use a specific dispute (dispute GID, not evidence GID)
node scripts/test-dispute-evidence.mjs --dispute-gid "gid://shopify/ShopifyPaymentsDispute/123456"
```

Required scopes: `read_shopify_payments_disputes`, `read_shopify_payments_dispute_evidences`, `write_shopify_payments_dispute_evidences`. The merchant user must have **Manage orders information** in Shopify Admin.

### CI

GitHub Actions runs on push/PR to main:
1. Typecheck + lint + build
2. Vitest (contract + unit)
3. Forbidden copy grep (no "submit response" language in UI or translations)
4. `npm audit`
