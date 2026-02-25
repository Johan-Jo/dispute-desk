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
| Marketing | `/` | Public | Landing page, hero, CTAs |
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
- **Auth (Portal):** Supabase Auth via `@supabase/ssr` (email/password, magic link)
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

# 3. Run Supabase migrations
npx supabase db push

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

## Project Structure

```
app/
  (marketing)/       → Public landing page (Tailwind)
  (auth)/auth/       → Sign in, sign up, forgot/reset password, magic link
  (portal)/portal/   → SaaS dashboard, disputes, packs, rules, billing, team
  (embedded)/app/    → Shopify Admin embedded UI (Polaris)
  api/               → Backend routes (auth, webhooks, jobs, packs, disputes)
  globals.css        → Tailwind imports + design tokens
components/ui/       → Shared design system components
lib/
  shopify/           → GraphQL client, throttle, session helpers
  supabase/          → Server client, portal auth helpers
  portal/            → Active shop cookie + linked shop queries
  automation/        → Pipeline, completeness engine, auto-save gate, settings
  jobs/              → Job dispatcher + handlers (sync, build, save, render)
scripts/             → Migration runner + smoke test
supabase/migrations/ → SQL migrations (001–010)
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
# Unit tests (completeness engine, auto-save gate, encryption, etc.)
npx vitest run

# E2E smoke test (requires .env.local with SUPABASE_URL_POSTGRES)
node scripts/smoke-test.mjs
```

Tests include:
- **Contract tests:** Validate Shopify GraphQL response shapes (zod schemas)
- **Unit tests:** Encryption roundtrip, field mapping, completeness scoring (7 tests), auto-save gate logic (9 tests)
- **E2E smoke test:** Seeds a dispute into live Supabase, validates the full automation pipeline (shop settings, pack creation, completeness scoring, gate decisions, save simulation, audit immutability), then cleans up

### CI

GitHub Actions runs on push/PR to main:
1. Typecheck + lint + build
2. Vitest (contract + unit)
3. Forbidden copy grep (no "submit response" language in UI or translations)
4. `npm audit`
