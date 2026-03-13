# DisputeDesk — Claude Code Context

## What It Is
Automation-first Shopify chargeback evidence app. Connects to Shopify, auto-syncs disputes, auto-builds evidence packs, and auto-saves them back to Shopify. Merchants submit via Shopify Admin — DisputeDesk does NOT programmatically submit to card networks.

## Two Surfaces (one codebase)
| Surface | Route | Auth |
|---------|-------|------|
| Marketing | `/` | Public |
| Portal | `/portal/*` | Supabase Auth |
| Embedded App | `/app/*` | Shopify session (Polaris) |
| API | `/api/*` | Mixed |

## Tech Stack
- **Framework:** Next.js 15 App Router (Node runtime)
- **Frontend (Embedded):** React 18 + Polaris + App Bridge React
- **Frontend (Portal):** React 18 + Tailwind CSS + CVA design system
- **UI Components:** `components/ui/` (Button, Badge, AuthCard, TextField, KPICard, InfoBanner, etc.)
- **Auth (Portal):** Supabase Auth via @supabase/ssr
- **Auth (Embedded):** Shopify OAuth (offline + online sessions)
- **Database:** Supabase Postgres (server-only, RLS enabled)
- **Storage:** Supabase Storage (private buckets, PDFs + uploads)
- **PDF:** @react-pdf/renderer
- **Deployment:** Vercel + Vercel Cron
- **CI:** GitHub Actions

## Dev Commands
```bash
npm run dev              # Start dev server
npx shopify app dev      # Start Shopify tunnel (separate terminal)
npx vitest run           # Unit + API route tests
npm run test:e2e         # Playwright E2E
node scripts/smoke-test.mjs  # E2E smoke test (requires live Supabase)
npm run seed:synthetic-disputes  # Seed fake disputes for UI dev
```

## Key Directories
```
app/
  (marketing)/       → Landing page
  (auth)/auth/       → Sign in, sign up, reset
  (portal)/portal/   → SaaS dashboard
  (embedded)/app/    → Shopify Admin embedded UI
  api/               → Backend routes
components/ui/       → Shared design system
lib/
  shopify/           → GraphQL client, sessions, queries
  supabase/          → Server client, portal auth
  automation/        → Pipeline, completeness engine, auto-save gate
  packs/             → Pack builder + source collectors
  jobs/              → Job dispatcher + handlers
  security/          → AES-256-GCM encryption
supabase/migrations/ → SQL migrations (001–023)
docs/                → Architecture, technical spec, epics, roadmap
```

## Architecture Docs
- [`docs/architecture.md`](docs/architecture.md) — system design, auth models, async jobs, data flow
- [`docs/technical.md`](docs/technical.md) — design system reference, API surface, CI pipeline
- [`docs/roadmap.md`](docs/roadmap.md) — product roadmap

## Shopify Scopes Required
```
read_orders
read_shopify_payments_disputes
write_shopify_payments_dispute_evidences
```

## Important Rules
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — never expose to client
- Saving evidence requires merchant to have "Manage orders information" in Shopify Admin
- CI runs: typecheck + lint + build → vitest → forbidden copy grep (no "submit response" language in UI) → npm audit
- Supabase project ref: `sddzuglxdnkhcnjmcpbj`

## Branding Note
The name "DisputeDesk" may overlap with disputedesk.co — consider **DisputeDesk.app** for public branding (non-blocking).
