# DisputeDesk — Claude Code Context

## Non-negotiables for AI agents

1. **Supabase migrations — you run them, every time.** If you create or edit any file under `supabase/migrations/`, you **must** run `npm run db:migrate` in this repo in the **same working session** before you mark the task done or push. Do **not** only commit SQL. Do **not** tell the maintainer to run migrations instead of doing it yourself when the environment has network + shell (use `npm run db:migrate:script` only when CLI link is impossible — document that in the summary).
2. **Verify before “done”:** `npm test` and `npx tsc --noEmit` (and `npm run build` when touching UI/routes/schema).
3. **Plan mode is absolute.** When plan mode activates — for any reason, at any time — **immediately stop all write operations**. No edits, no bash commands that modify files, no git operations, no tool calls that change state. Read-only actions only. Do not attempt to “finish up” current work. Do not rationalize continuing. Stop, acknowledge plan mode, and follow the plan workflow. This applies even if plan mode activates mid-task due to background agent completion or other system events.

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

**Before declaring a task done (agents):** Run **`npm test`** (`vitest run`) and **`npx tsc --noEmit`**; for UI/routes/schema changes also **`npm run build`**. Fix failures before saying the work is complete—do not rely on “should be fine” without a green run.

**Migrations (mandatory for agents):** Same as **Non-negotiables** above — **the agent executes** `npm run db:migrate` after any migration file change; never substitute with “the user should run db push.” Requires Supabase CLI linked (`npx supabase link --project-ref …`). If `db push` is not possible in this environment, use `npm run db:migrate:script` (see `scripts/run-migration.mjs` + `SUPABASE_URL_POSTGRES` or `SUPABASE_URL` + `SUPABASE_DB_PASSWORD`) and state that explicitly in the PR/summary.

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
scripts/hub-content/ → Code-first multi-locale Resources Hub articles (HTML + `article.mjs`; see `docs/technical.md` § *Code-first hub articles*)
scripts/seed-resources-hub.mjs → Hub seed + idempotent sync for those articles
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
- **Docs + help (mandatory):** After any feature, UI change, or API change, update `docs/technical.md` to reflect the new behaviour. If the change affects what merchants see or do (embedded UI, flows, settings), also update the relevant embedded help article in `lib/help/` or `messages/{locale}.json` (`help.embedded.*` namespace). Do this in the same commit — never defer doc updates to a follow-up.
- **Database / migrations:** The agent runs `npm run db:migrate` (or script fallback) after any new/edited migration — same session, no handoff to the user for apply.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — never expose to client
- Saving evidence requires merchant to have "Manage orders information" in Shopify Admin
- CI runs: typecheck + lint + build → vitest → forbidden copy grep (no "submit response" language in UI) → npm audit
- Supabase project ref: `sddzuglxdnkhcnjmcpbj`
- **3-D Secure / `receiptJson`:** 3DS is NOT in the Admin GraphQL typed schema (verified across the full `PaymentDetails` union in 2026-01). Auto-collected by `lib/packs/sources/threeDSecureSource.ts` from `OrderTransaction.receiptJson` for **Shopify Payments only** (the JSON shape is provider-specific) and classified **Moderate, never Strong** — the receipt contract is gateway-defined and "not a stable contract" per Shopify. Receipts arrive as JSON **strings** in 2026-01; parse defensively. Walk path: `latest_charge.payment_method_details.card.three_d_secure.authenticated` (modern) with `payment_method_details.card.three_d_secure.authenticated` as legacy fallback. The collector emits ONLY when `authenticated === true` — absence of 3DS is never a negative signal. Never widen the gateway allow-list, never elevate to Strong without merchant confirmation (`tdsVerified === true` from manual upload), never auto-write 3DS into bank-rebuttal text from the receipt-read path alone. See `docs/technical.md` § *3-D Secure Collection*.

## Branding Note
The name "DisputeDesk" may overlap with disputedesk.co — consider **DisputeDesk.app** for public branding (non-blocking).
