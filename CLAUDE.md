# DisputeDesk — Claude Code Context

## Non-negotiables for AI agents

0. **NEVER trust the linked Supabase project blindly — always confirm dev vs prod first.** The CLI's linked ref (`supabase/.temp/linked-project.json`) is a single invisible global pointer that `db push` / `db query --linked` inherit silently. On 2026-06-15 it was pointed at **prod** while we believed we were on **dev**: a migration + many diagnostic queries hit the wrong database. Before ANY `--linked` write OR read, run `cat supabase/.temp/linked-project.json` (or rely on the guard below) and verify the ref against: **prod = `aokhplydttxtebvbeuzc`, dev = `vrpkgudqmpyunekrkpnc`**. When in doubt, `npx supabase link --project-ref <ref>` to the intended project first. Treat a wrong-DB write as a Sev-1.
1. **Supabase migrations — you run them, every time, with an EXPLICIT env target.** If you create or edit any file under `supabase/migrations/`, you **must** apply it in the **same working session** before you mark the task done or push. Use **`npm run db:migrate:dev`** (or **`npm run db:migrate:prod`**) — these run `scripts/guard-db-target.mjs <env>` first, which refuses unless the linked ref matches that env's known ref (so a dev/prod mix-up is a hard failure, not a silent wrong-target push). **Bare `npm run db:migrate` is intentionally blocked** — it errors demanding an explicit target. Do **not** only commit SQL. Do **not** hand migrations back to the maintainer when the environment has network + shell (use `npm run db:migrate:script` only when CLI link is impossible — document that in the summary).
2. **Ad-hoc SQL / ops queries — use `supabase db query --linked`, not `pg.Client` — AND confirm the target env first (see #0).** For any one-shot read, diagnostic, or cleanup (NOT a migration), the canonical path is `npx supabase db query --linked --file scripts/sql/<name>.sql` (or `--linked "select …"` inline). It uses the Management API, needs no DB password, and is not affected by rotated `SUPABASE_URL_POSTGRES` credentials. **Because `--linked` inherits the same silent pointer as migrations, verify the linked ref (#0) before running — a diagnostic against the wrong DB produces confidently-wrong conclusions.** Reach for `pg.Client` / `SUPABASE_URL_POSTGRES` only when `db query` genuinely can't do the job (e.g. true multi-statement sessions, `\copy`, large bulk loads). Full reference: `docs/technical.md` § *Ad-hoc SQL / ops queries (canonical path)*. Put reusable SQL in `scripts/sql/`.
3. **Verify before “done”:** `npm test` and `npx tsc --noEmit` (and `npm run build` when touching UI/routes/schema).
4. **Plan mode is absolute.** When plan mode activates — for any reason, at any time — **immediately stop all write operations**. No edits, no bash commands that modify files, no git operations, no tool calls that change state. Read-only actions only. Do not attempt to “finish up” current work. Do not rationalize continuing. Stop, acknowledge plan mode, and follow the plan workflow. This applies even if plan mode activates mid-task due to background agent completion or other system events.
5. **Structural i18n: no English in `lib/`, no English in `pack_json`.** Library code (`lib/**`) emits `I18nToken`s for user-facing copy — never resolved English strings. Persisted pack data carries `labelToken`, not `label`. UI leaf renderers that consume library-emitted copy accept the branded `Localized` type so a raw English literal cannot satisfy the prop type. The single resolution path is `lib/i18n/resolveToken.ts` driven by a root translator (`useTranslations()` / `getTranslations({ locale })`). The legacy English-fallback path in `getMessages.ts` is gone; missing keys are a build failure via `scripts/verify-i18n-parity.mjs`.
6. **Every cron route calls `cronEnvGate(req)` first.** Any new file under `app/api/cron/**/route.ts` (or `app/api/jobs/worker/route.ts`) MUST `import { cronEnvGate } from "@/lib/cron/envGate"` and call it before doing any work. A vitest case enumerates the cron routes and fails the build on any offender. The gate handles both the env toggle (`CRON_ENABLED`) and `CRON_SECRET` auth (Authorization Bearer / `x-cron-secret` header / `?secret=` query). Never reimplement the auth inline. Reference: `docs/technical.md` § *Environment Identity & Cron Gate* and `docs/plans/dev-prod-environment-split.plan.md` §6.2.
7. **Never run bare `shopify app deploy`.** Always go through the wrapper scripts: `npm run shopify:deploy:dev` or `npm run shopify:deploy:prod`. Each wrapper invokes `scripts/guard-shopify-config.mjs <dev|prod>` first to refuse the deploy if the corresponding `shopify.app.{dev,prod}.toml` has a dangerous value (e.g. dev TOML pointing at the prod URL, prod TOML pointing at the dev `client_id`). `shopify.app.toml` no longer exists — config aliases (`shopify app config use dev` / `prod`) drive everything. Pin to `shopify@3.94.3` via `npx shopify@3.94.3 …` because v4 needs Node ≥22.12 and this repo runs on 22.4.1. Reference: `docs/plans/dev-prod-environment-split.plan.md` §8.

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
npm run seed:dev:synthetic-disputes  # Seed fake disputes for UI dev (requires APP_ENV=development)
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
Minimal summary — full OAuth list must match `shopify.app.toml` / `SHOPIFY_SCOPES` (see `docs/technical.md`).

```
read_orders
read_shopify_payments_disputes
read_shopify_payments_dispute_file_uploads
write_shopify_payments_dispute_file_uploads
write_shopify_payments_dispute_evidences
read_customer_events           # LSE-4 Web Pixel — read customer events
write_pixels                   # LSE-4 — required to call webPixelCreate during OAuth
read_legal_policies            # Read Shop.shopPolicies (published-on-store policy evidence)
```

The `.env` `SHOPIFY_SCOPES` value must match `shopify.app.toml`'s `[access_scopes].scopes` exactly. Mismatches cause silent OAuth consent-screen drift.

## Important Rules
- **Docs + help (mandatory):** After any feature, UI change, or API change, update `docs/technical.md` to reflect the new behaviour. If the change affects what merchants see or do (embedded UI, flows, settings), also update the relevant embedded help article in `lib/help/` or `messages/{locale}.json` (`help.embedded.*` namespace). Do this in the same commit — never defer doc updates to a follow-up.
- **Database / migrations:** The agent runs `npm run db:migrate` (or script fallback) after any new/edited migration — same session, no handoff to the user for apply.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — never expose to client
- Saving evidence requires merchant to have "Manage orders information" in Shopify Admin
- CI runs: typecheck + lint + build → vitest → forbidden copy grep (no "submit response" language in UI) → npm audit
- Supabase project refs: **prod** = `aokhplydttxtebvbeuzc` (Pro tier, post-2026-05-28 cutover); **dev** = `vrpkgudqmpyunekrkpnc` (Free tier — the project actually provisioned for dev, backs `dev.disputedesk.app` and the `disputedesk-dev` Vercel project; 71 tables matching prod). NOTE: the original Pro-migration plan said the *old* free-tier prod ref `sddzuglxdnkhcnjmcpbj` would "become dev," but a fresh project (`vrpkgudqmpyunekrkpnc`) was stood up for dev instead. `sddzuglxdnkhcnjmcpbj` is now the **idle old-prod leftover** — not referenced by any live env (verified 2026-06-04) and slated for deletion. Older planning runbooks that still say "sddzuglx… becomes dev" are point-in-time records, not current truth.
- **3-D Secure / `receiptJson`:** 3DS is NOT in the Admin GraphQL typed schema (verified across the full `PaymentDetails` union in 2026-01). Auto-collected by `lib/packs/sources/threeDSecureSource.ts` from `OrderTransaction.receiptJson` for **Shopify Payments only** (the JSON shape is provider-specific) and classified **Moderate, never Strong** — the receipt contract is gateway-defined and "not a stable contract" per Shopify. Receipts arrive as JSON **strings** in 2026-01; parse defensively. Walk path: `latest_charge.payment_method_details.card.three_d_secure.authenticated` (modern) with `payment_method_details.card.three_d_secure.authenticated` as legacy fallback. The collector emits ONLY when `authenticated === true` — absence of 3DS is never a negative signal. Never widen the gateway allow-list, never elevate to Strong without merchant confirmation (`tdsVerified === true` from manual upload), never auto-write 3DS into bank-rebuttal text from the receipt-read path alone. See `docs/technical.md` § *3-D Secure Collection*.
- **Coverage Gate (PRD v1.1 §4):** `Order.shopifyProtect.status` IN `{PROTECTED, ACTIVE}` is the highest-priority routing decision. Pipeline short-circuits before rule-mode resolution and the auto-save quality gate; `heroVariant` is forced to `"covered"` and `strengthReason` is replaced with the covered copy. Never auto-save a covered pack. Never widen `COVERED_STATUSES` beyond `PROTECTED` and `ACTIVE` — `PENDING` falls through to normal flow until Shopify decides. Never override coverage based on user automation mode. Source: `lib/packs/sources/coverageSource.ts`. See `docs/technical.md` § *Coverage Gate (Shopify Protect)*.
- **Fatal-loss Gate (PRD v1.1 §5):** Structurally unwinnable cases — currently two triggers: (1) `refund_issued` (`order.totalRefundedSet >= dispute.amount`, `amount > 0`); (2) `inr_no_fulfillment` (reason ∈ INR codes AND status `UNFULFILLED` AND `fulfillments.length === 0`). When triggered: `overall` capped at `"weak"`, `heroVariant` forced to `"hard_to_win"`, auto-mode `block`s, review-mode still parks. Coverage beats fatal-loss. Bank-rebuttal text NEVER cites the fatal-loss reason — the message is merchant-UI-only (citing "we refunded" would be a confession). Source: `lib/automation/fatalLoss.ts`. See `docs/technical.md` § *Fatal-loss Gate*.

## Branding Note
The name "DisputeDesk" may overlap with disputedesk.co — consider **DisputeDesk.app** for public branding (non-blocking).
