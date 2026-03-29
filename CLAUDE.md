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
- **CI:** GitHub Actions (typecheck, lint, vitest, audit — run `workflow_dispatch` manually; lint no longer masked with `|| true`)

## Dev Commands
```bash
npm run dev              # Start dev server
npx shopify app dev      # Start Shopify tunnel (separate terminal)
npm run db:migrate       # Supabase CLI: push pending migrations (same as `npx supabase db push`; one-time `supabase login` + `supabase link` per machine)
npx vitest run           # Unit + API route tests
npm run lint             # ESLint (eslint.config.mjs; see README Database migrations for Supabase)
npm run build            # Production build
npm run test:e2e         # Playwright E2E
node scripts/smoke-test.mjs  # E2E smoke test (requires live Supabase)
npm run seed:synthetic-disputes  # Seed fake disputes for UI dev
```

**Migrations (mandatory for agents):** When you add or change anything under `supabase/migrations/`, you **must** run `npm run db:migrate` in this repo before you consider the task done (`npx supabase db push` to the linked project). Do not only commit SQL and skip apply. Do not tell the user to run migrations instead. Requires Supabase CLI linked (`npx supabase link --project-ref …`). If `db push` is not possible in this environment, use `npm run db:migrate:script` (see `scripts/run-migration.mjs` + `SUPABASE_URL_POSTGRES` or `SUPABASE_URL` + `SUPABASE_DB_PASSWORD`) and note that in the PR/summary.

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
supabase/migrations/ → SQL migrations (apply via Supabase CLI: `npm run db:migrate`)
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
- **Database:** After any new/edited migration file, **always** run `npm run db:migrate` (or the script fallback) against the linked Supabase project — same session as the code change.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — never expose to client
- Saving evidence requires merchant to have "Manage orders information" in Shopify Admin
- CI runs: typecheck + lint + build → vitest → forbidden copy grep (no "submit response" language in UI) → npm audit
- Supabase project ref: `sddzuglxdnkhcnjmcpbj`

## Branding Note
The name "DisputeDesk" may overlap with disputedesk.co — consider **DisputeDesk.app** for public branding (non-blocking).
