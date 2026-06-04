# Environment variables — dev vs prod

Reference table for the dev/prod environment split. Companion to
[`docs/plans/dev-prod-environment-split.plan.md`](plans/dev-prod-environment-split.plan.md)
§5.1 (isolation table) and §6 (safety primitives). The Phase 0 safety modules
that enforce these rules live in `lib/env/build-identity.ts`,
`lib/env/runtime-identity.ts`, `lib/cron/envGate.ts`, and
`scripts/verify-env-identity.mjs`.

This document captures the **intended** state per environment. When a value
here disagrees with `vercel env ls` on a project, the source of truth is the
plan, not the deployed env — fix the deploy, not the doc.

## Safety-primitive variables (Phase 0 — new in this round)

| Variable | Dev | Prod | Notes |
|---|---|---|---|
| `APP_ENV` | `development` | `production` | Single source of truth for every dev/prod rule. Unset = Phase 0 not yet activated; verifier skips strict checks. |
| `CRON_ENABLED` | `false` (default) | `true` | When `false`, every `app/api/cron/**` and `app/api/jobs/worker` route returns `204` immediately. |
| `CRON_ENABLED_DEV_OVERRIDE` | `false` (default) | unset | Deliberate dev opt-in for `CRON_ENABLED=true` in development. |
| `EMAIL_SEND_ENABLED` | `false` (default) | `true` | Master switch — when `false`, no transactional emails leave the process even with `RESEND_API_KEY` set. |

## Identity-bound variables (must differ between dev and prod)

These are validated by `lib/env/build-identity.ts` and the verifier; mismatched
combinations refuse to boot.

| Variable | Dev | Prod | Source of truth |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://dev.disputedesk.app` | `https://disputedesk.app` | DNS + Vercel project alias |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vrpkgudqmpyunekrkpnc.supabase.co` (dedicated dev project) | `https://aokhplydttxtebvbeuzc.supabase.co` (Pro prod project) | Supabase Dashboard |
| `SUPABASE_URL` | dev project (same as above) | prod project (same) | Mirror of `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | dev project | prod project | Supabase Dashboard → API |
| `SUPABASE_SERVICE_ROLE_KEY` | dev project | prod project | Supabase Dashboard → API. **Server only.** |
| `SHOPIFY_API_KEY` | `bbb7c00568ffb57fecd789fa0580e309` (DisputeDesk-Dev, created 2026-05-26 via Shopify CLI) | `84f40ec77c9ba18e9eabc1657d9b6af8` | Shopify Partners → app → Configuration |
| `SHOPIFY_CLIENT_ID` | (alias of `SHOPIFY_API_KEY`) | (alias) | Consolidate during Phase 2. |
| `SHOPIFY_API_SECRET` | dev Partners app secret | prod app secret | Per-app HMAC; never share. |
| `SHOPIFY_SCOPES` | match `shopify.app.dev.toml` | match `shopify.app.prod.toml` | OAuth consent surface. |
| `SHOPIFY_APP_URL` | `https://dev.disputedesk.app` | `https://disputedesk.app` | Mirror of `NEXT_PUBLIC_APP_URL`. |
| `TOKEN_ENCRYPTION_KEY_V1` | new 32 random bytes (hex) | existing 32 random bytes (hex) | `openssl rand -hex 32`. **Must be 64 hex chars** or runtime-identity refuses to boot. |
| `CRON_SECRET` | new random | existing random | `openssl rand -hex 32`. Drives the cron envGate. |

## Shared but scope-narrowed in Phase 2

Today these live in all three Vercel scopes (Development / Preview / Production).
Phase 2 step 4 narrows the prod-only secrets to **Production scope only**.

| Variable | After Phase 2 | Reason |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (prod project) | Production only | Server-only, never useful in dev preview branches. |
| `SHOPIFY_API_SECRET` (prod app) | Production only | HMAC-per-app. |
| `TOKEN_ENCRYPTION_KEY_V1` (prod) | Production only | Decrypts prod offline tokens. |
| `CRON_SECRET` (prod) | Production only | Cron auth boundary. |
| `RESEND_API_KEY` (prod sender) | Production only | Prevents accidental prod email from preview deploys. |
| `OPENAI_API_KEY` | Production only | Billable; preview shouldn't burn prod tokens. |
| `ANTHROPIC_API_KEY` | Production only | Same. |

The new dev Vercel project (Phase 2) gets its own copy of each — never the prod
value, never reused.

## Optional / feature-flag variables (env-agnostic)

| Variable | Notes |
|---|---|
| `SHOPIFY_API_VERSION` | Pinned to `2026-01` across both envs. |
| `FILE_EVIDENCE_ATTACHMENTS_ENABLED` | Feature flag — same value across envs unless deliberately gated. |
| `IMAGE_AUTOPILOT_ENABLED` | Same. |
| `MATERIAL_SPEC_STORE_UNITS_ENABLED` | Same. |
| `SHOPIFY_BILLING_TEST` | Same. |
| `INDEXNOW_KEY`, `APIFY_API_KEY`, `IPINFO_API_KEY`, `PEXELS_API_KEY`, `CAL_API_KEY`, `EVIDENCE_LINK_SECRET`, `SUPABASE_AUTH_HOOK_SECRET`, `ADMIN_SECRET` | Per-env values, but no identity-bound rule. Document the prod value in the snapshot doc; dev gets a fresh copy. |

## Verifying

Local:

```
node scripts/verify-env-identity.mjs
```

`npm run release:verify` runs this as its first step, and `npm run build`
(including Vercel's build) runs it via the `prebuild` hook.

The runtime check (`lib/env/runtime-identity.ts`) runs once per server
process via `instrumentation.ts` and refuses to serve traffic if any
required secret is missing or shaped wrong.

## Local secret file layout

Two gitignored files (`.env*.local` rule already excludes both):

| File | Loaded by | Contents |
|---|---|---|
| `.env.local` | `npm run dev`, vitest, every default tool | Dev-pointing creds. The default everyday env. |
| `.env.production.local` | Scripts that explicitly `dotenv.config({ path: ".env.production.local" })` | Prod creds for manual cutover / migration / `db:push:prod` only. Never loaded by `npm run dev`. |

Scripts that need prod creds (e.g. `scripts/verify-supabase-migration.mjs`,
the future `scripts/db-push-prod.mjs`) opt in explicitly so a typo in a
day-to-day command can't accidentally read prod creds.

Never copy `.env.production.local` content into chat, PRs, or commit messages.
The project ref + Vercel project ID are public; everything else (anon key
included) is treated as a secret in transit.
