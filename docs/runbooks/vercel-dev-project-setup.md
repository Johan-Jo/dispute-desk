# Vercel dev project — setup runbook

**Goal.** Stand up a separate Vercel project that auto-deploys the `develop`
branch to `https://dev.disputedesk.app`, completely isolated from the
existing prod project (`dispute-desk` under the EstimatePro team) which
auto-deploys `master` to `https://disputedesk.app`.

This is Phase 2 of [`dev-prod-environment-split.plan.md`](../plans/dev-prod-environment-split.plan.md).

## 0. Pre-conditions verified (2026-05-26)

These were verified live and don't need re-checking unless the state changes:

- [x] `develop` branch exists on the GitHub remote at the same commit as `feat/dev-prod-env-split` tip.
- [x] `disputedesk.app` is registered on the personal Vercel team `johans-projects-4b909657`, with NS pointing at Vercel (`ns1/ns2.vercel-dns.com`).
- [x] `dev.disputedesk.app` is NOT claimed by any existing Vercel project (`curl` returns `DEPLOYMENT_NOT_FOUND`). DNS is Vercel-wildcard routed by virtue of the parent domain's NS records — no DNS surgery needed.
- [x] The existing prod project `dispute-desk` is on the EstimatePro team and serves `disputedesk.app` cross-team.

## 1. Create the new dev Vercel project

The Vercel CLI can do most of this; the dashboard is faster for one-time setup.
Pick whichever you prefer.

### Dashboard path (recommended for first-time)

1. https://vercel.com/new → import the existing GitHub repo (`Johan-Jo/dispute-desk`).
2. **Project name:** `disputedesk-dev` (matches the convention used in plan §5).
3. **Team:** EstimatePro (same team as prod — keeps billing/permissions consistent; cross-team domain sharing already works since `disputedesk.app` is on the personal team).
4. **Production branch:** change from `master` to **`develop`**. This is the single most important setting — the dev project must NEVER auto-deploy `master`.
5. **Framework:** Next.js (auto-detected).
6. **Root directory:** repo root (default).
7. **Build settings:** default (Next.js).
8. Click "Deploy" and let the first deploy fail or succeed (env vars aren't set yet — fine).

### CLI path (alternative)

```
vercel link --scope=estimatepro                     # links current dir to a Vercel project
# When prompted "Set up?" → No.
# Then create a new project via dashboard step 1 above, or use:
vercel git connect --scope=estimatepro              # connect to GitHub repo
# After creation, set the production branch:
# Dashboard → Project → Settings → Git → Production Branch → "develop"
```

## 2. Add `dev.disputedesk.app` as the project's domain

In the new `disputedesk-dev` project's Dashboard:

1. Settings → Domains → "Add Domain".
2. Enter `dev.disputedesk.app`.
3. Confirm "Add".
4. Vercel should immediately detect ownership (because the parent domain `disputedesk.app` is on the same Vercel account — no separate verification needed) and provision SSL within ~30 seconds.

Verify by curling: `curl -I https://dev.disputedesk.app` should now return a Next.js response from the dev project, not `DEPLOYMENT_NOT_FOUND`.

## 3. Set environment variables (Production scope on the dev project)

The dev project's "Production scope" sounds wrong but is correct — every Vercel project has its own Production / Preview / Development scopes, and `disputedesk-dev`'s Production scope is what dev-deployed builds use.

Use the `.env.example` block at the top of the file as the canonical list,
but the dev-project-specific values are:

| Variable | Value | Source |
|---|---|---|
| `APP_ENV` | `development` | constant |
| `NEXT_PUBLIC_APP_URL` | `https://dev.disputedesk.app` | constant |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vrpkgudqmpyunekrkpnc.supabase.co` (the dev project actually provisioned — NOT the old `sddzuglx…` ref the original plan assumed; see [`supabase-dev-project-setup.md`](supabase-dev-project-setup.md)) | from Supabase Dashboard |
| `SUPABASE_URL` | mirror of above | same |
| `SUPABASE_ANON_KEY` | **fresh** dev anon (after key rotation in dev-conversion §3.4) | Supabase Dashboard → API |
| `SUPABASE_SERVICE_ROLE_KEY` | **fresh** dev secret key | same |
| `SUPABASE_URL_POSTGRES` | postgres connection string with the rotated DB password | Supabase Dashboard → Database |
| `TOKEN_ENCRYPTION_KEY_V1` | **fresh** 32-byte hex (do NOT reuse prod's) | `openssl rand -hex 32` |
| `CRON_SECRET` | **fresh** random (do NOT reuse prod's) | `openssl rand -hex 32` |
| `CRON_ENABLED` | `false` (default; cron stays off in dev) | constant |
| `CRON_ENABLED_DEV_OVERRIDE` | `false` (deliberate opt-in if you ever need to exercise cron in dev) | constant |
| `EMAIL_SEND_ENABLED` | `false` (no real emails leave dev) | constant |
| `SHOPIFY_API_KEY` | dev Partners app `client_id` (created via `shopify app config link --config=dev`) | `shopify.app.dev.toml` |
| `SHOPIFY_CLIENT_ID` | same as `SHOPIFY_API_KEY` (alias) | same |
| `SHOPIFY_API_SECRET` | dev Partners app client_secret | Shopify Partners → DisputeDesk-Dev → API credentials |
| `SHOPIFY_APP_URL` | `https://dev.disputedesk.app` | constant |
| `SHOPIFY_SCOPES` | match `shopify.app.dev.toml` `[access_scopes].scopes` (no `read_all_orders` until PCD approval) | `shopify.app.dev.toml` |
| `SHOPIFY_API_VERSION` | `2026-01` | constant |
| `RESEND_API_KEY` | (set if you want dev to send test email; otherwise leave unset since `EMAIL_SEND_ENABLED=false`) | Resend Dashboard |
| `EMAIL_FROM` | dev sender if used (e.g. a separate `mail-dev.disputedesk.app` subdomain — verify in Resend first) | — |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | separate dev key OR shared but with usage caps — your call | provider dashboards |
| `INDEXNOW_KEY`, `APIFY_API_KEY`, `PEXELS_API_KEY`, `IPINFO_API_KEY`, `CAL_API_KEY`, `EVIDENCE_LINK_SECRET`, `SUPABASE_AUTH_HOOK_SECRET`, `ADMIN_SECRET`, `SHOPIFY_SEED_CLIENT_ID`, `SHOPIFY_SEED_CLIENT_SECRET` | dev-specific or separate copies — never reuse the prod values | — |

The runtime-identity check (`lib/env/runtime-identity.ts`) refuses to boot if
`TOKEN_ENCRYPTION_KEY_V1` isn't exactly 64 hex chars or if any required
secret is missing.

## 4. Narrow prod project's env-var scopes (the leakage cleanup)

Per Phase 2 step 4 of the plan — this is done on the **prod** project
(`dispute-desk`), not the new dev project. Today every dangerous secret on
the prod project is set on all three scopes (Development / Preview /
Production); narrow each to **Production only** so preview deploys against
feature branches don't pick up prod secrets.

Variables to narrow on `dispute-desk`:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SHOPIFY_API_SECRET`
- `TOKEN_ENCRYPTION_KEY_V1` (and the alias `TOKEN_ENCRYPTION_KEY`)
- `CRON_SECRET`
- `RESEND_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `SUPABASE_AUTH_HOOK_SECRET`
- `EVIDENCE_LINK_SECRET`
- `ADMIN_SECRET`
- `SHOPIFY_SEED_CLIENT_SECRET`

For each: Vercel Dashboard → `dispute-desk` → Settings → Environment Variables
→ the variable → edit → uncheck Development + Preview → save.

## 5. Verify

End-to-end check that dev is wired and isolated:

- [ ] Trigger a deploy on the `develop` branch (push any small change or use Vercel Dashboard → Deployments → Redeploy).
- [ ] Wait for build to finish — `prebuild` will run `verify-env-identity.mjs` which now activates strict checks because `APP_ENV=development` is set.
- [ ] If build fails on env-identity, paste the error — it'll tell you exactly which variable mismatch caused the refusal.
- [ ] After successful deploy, hit `https://dev.disputedesk.app/api/health` and confirm: `appEnv=development`, `supabaseProjectRefFp` matches first 8 chars of `vrpkgudqmpyunekrkpnc` (= `vrpkgudq`), `supabaseIsKnownProd=false`, `cronEnabled=false`.
- [ ] Hit `https://disputedesk.app/api/health` (prod) and confirm it's unchanged: `appEnv=production`, prod project fingerprint.
- [ ] Confirm no Vercel preview deploys on the prod project (`dispute-desk`) still reference dev/prod secrets — `vercel env ls preview --scope=estimatepro` should now show only feature-flag values, not service-role / encryption / cron secrets.

## 6. Open questions to resolve later

- **R2 backup destination**: the prod cron `/api/cron/db-backup` writes to a Cloudflare R2 bucket. Dev probably shouldn't also write there. Either skip db-backup in dev (already covered by `CRON_ENABLED=false` default) or point dev at a separate R2 bucket.
- **Resend sending domain for dev**: if you ever want dev to send test emails, register a separate verified domain (e.g. `mail-dev.disputedesk.app`) in Resend so dev sends never go through the prod sender.
- **Shopify dev app's Protected Customer Data approval**: independent track, 3–7 business days. Submit early after `shopify app config link --config=dev` creates the dev Partners app.
