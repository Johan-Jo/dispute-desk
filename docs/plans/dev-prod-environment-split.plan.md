# PRD — Dev/Prod Environment Separation (v3, pre-launch)

**Status:** Draft v3 (with corrections applied) · **Owner:** Johan · **Date:** 2026-05-13

> **North star.** Make it impossible for development work to touch real merchants, real Shopify installs, real evidence files, real secrets, or real cron jobs. Everything else is secondary and deferrable.

v3 supersedes v2. v2 over-indexed on enterprise DevOps. v3 is a pre-launch safety job for a solo founder with a small team. The seven corrections from review are threaded into the relevant sections (snapshot secret handling, Supabase backup wording, Shopify CLI invocation, worker-route gate, build/runtime validation split, smoke-migration mechanism, estimate softening).

---

## 1. Current state (verified 2026-05-13)

- **Supabase:** one project (ref `sddzuglxdnkhcnjmcpbj`). Local migrations are in parity with the linked project (98 applied through `20260511140000`).
- **Vercel:** one project `dispute-desk` under team `estimatepro`, aliased to `disputedesk.app` (and `www.`). Latest prod deploy 2d old.
- **Vercel env:** secrets are scoped to **all three** Vercel environments (Development, Preview, Production) for the dangerous items — `SUPABASE_SERVICE_ROLE_KEY`, `SHOPIFY_API_SECRET`, `TOKEN_ENCRYPTION_KEY_V1`, `CRON_SECRET`, `RESEND_API_KEY`, `OPENAI_API_KEY` are all currently shared across env scopes. This is the leakage problem this PRD closes.
- **Shopify:** one Partners app (`client_id 84f40ec77c9ba18e9eabc1657d9b6af8`), `application_url = https://disputedesk.app`, listed.
- **Shopify CLI installed:** `shopify/3.94.3 win32-arm64 node-v22.4.1`. `shopify app deploy --help` confirms `-c, --config=<value>` where the value is the **name of the app configuration** (an alias managed by `shopify app config use <name>`/`shopify app config link`), **not** a TOML filename path.
- **Cron:** twelve schedules in `vercel.json` (`sync-disputes` every 5m, `worker` every 2m). No env gate today.
- **DNS:** `disputedesk.app` → Vercel anycast (216.198.79.0/24). Name servers `ns1/ns2.vercel-dns.com`. `dev.disputedesk.app` already resolves (64.29.17.0/24) — apparently a Vercel wildcard. Phase 2 must verify and reclaim it.

## 2. Goals

1. Two isolated environments — **dev** (free to break) and **prod** (real merchants only).
2. Zero shared secrets between them: Supabase, Shopify, encryption keys, cron, email.
3. Hard runtime guards that fail loudly if dev config and prod config get crossed.
4. A manual, scripted, documented production release path. **CI never mutates prod DB.**
5. A documented, restorable snapshot of today's prod state before anything changes.

## 3. Non-Goals (this round)

Per-PR ephemeral Supabase. Third "staging" tier. Multi-region or DR replication. Sentry/observability beyond `/api/health` (deferred to §13 hardening).

## 4. Shopify constraints driving the design

- One Partners app = one `client_id` = one `application_url`. Dev needs a **separate Partners app**.
- Protected Customer Data approval (`read_all_orders`) is **per-app**. Dev app needs its own approval, or must run on `read_orders` (60-day window) until granted.
- GDPR mandatory webhooks (`customer_data_request`, `customer_redact`, `shop_redact`) live under `[webhooks.privacy_compliance]`, **never** as `[[webhooks.subscriptions]]`.
- HMAC secret (`SHOPIFY_API_SECRET`) is per-app — never shared.
- App Bridge requires `application_url` to match the served host (dev → `https://dev.disputedesk.app`; prod → `https://disputedesk.app`).
- `shopify app deploy` overwrites Partners config from the active configuration. The CLI version installed here (3.94.3) uses `--config=<name>` where `<name>` is the configured **app config alias**, not a file path. Wrapper scripts must therefore use the alias form (see §8).
- API version pinned to `2026-01`.
- Runtime `disputes/create` / `disputes/update` webhook subscriptions registered at OAuth carry the app's callback URL — clean isolation as a side-effect of separate apps.

## 5. Target architecture

```
   Shopify Partners (one org)
   ├── DisputeDesk          (listed, client_id 84f40ec…, URL disputedesk.app)
   ├── DisputeDesk-Dev      (unlisted, new client_id, URL dev.disputedesk.app)
   └── DisputeDesk-Seed     (existing, unchanged)

   develop  ─►  Vercel disputedesk-dev   ─►  dev.disputedesk.app
                       │
                       └──►  Supabase disputedesk-dev   (new ref)

   master   ─►  Vercel disputedesk-prod  ─►  disputedesk.app
                       │
                       └──►  Supabase sddzuglxdnkhcnjmcpbj   (unchanged)
```

### 5.1 Isolation table — nothing on the left ever appears on the right

| Resource / secret | Dev | Prod |
|---|---|---|
| `APP_ENV` | `development` | `production` |
| `NEXT_PUBLIC_APP_URL` | `https://dev.disputedesk.app` | `https://disputedesk.app` |
| Supabase project ref | new | `sddzuglxdnkhcnjmcpbj` |
| Supabase anon / service-role keys | new pair | existing pair |
| `SHOPIFY_API_KEY` (`client_id`) | new | `84f40ec77c9ba18e9eabc1657d9b6af8` |
| `SHOPIFY_API_SECRET` | new | existing |
| `TOKEN_ENCRYPTION_KEY_V1` | new (32 random bytes) | existing |
| `CRON_SECRET` | new | existing |
| `CRON_ENABLED` | `false` (default) | `true` |
| `EMAIL_SEND_ENABLED` | `false` (default) | `true` |
| `RESEND_API_KEY` / `EMAIL_FROM` | suppressed by default; if used: dev subdomain | existing |
| `APIFY_API_TOKEN`, `IPINFO_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | separate or absent | existing |

## 6. Hard safety primitives (Phase 0 — the heart of the plan)

These are the runtime guards that make crossing the streams either impossible or unmistakably loud.

### 6.1 Env identity validation — split build-time / runtime (correction 5)

Two modules, deliberately separated so build-time checks never need access to server secrets and runtime checks never run at build.

#### 6.1a `lib/env/build-identity.ts` (build-time)

Imported from `next.config.ts` and from `scripts/verify-env-identity.mjs`. Operates **only** on public/build-safe env vars. Throws if any of these are wrong:

- `APP_ENV` is unset or not in `{development, production}`.
- `APP_ENV=production` and `NEXT_PUBLIC_APP_URL !== "https://disputedesk.app"`.
- `APP_ENV=development` and `NEXT_PUBLIC_APP_URL === "https://disputedesk.app"`.
- `APP_ENV=development` and `NEXT_PUBLIC_SUPABASE_URL` resolves to the known prod project ref `sddzuglxdnkhcnjmcpbj`.
- `APP_ENV=production` and `NEXT_PUBLIC_SUPABASE_URL` does **not** resolve to the known prod ref.
- `APP_ENV=development` and `SHOPIFY_API_KEY` (the `client_id`, which is public) equals the known prod client_id `84f40ec77c9ba18e9eabc1657d9b6af8`.
- `APP_ENV=production` and `SHOPIFY_API_KEY` does not equal the known prod client_id.
- `APP_ENV=development` and `CRON_ENABLED=true` without `CRON_ENABLED_DEV_OVERRIDE=true`.

These all use public identifiers (URLs, public client IDs). No secret comparisons.

Logging: print variable names and the first 8 chars of any **non-secret identifier** (project ref, client_id, URL hostname). Never log secret values or any derivative of them.

#### 6.1b `lib/env/runtime-identity.ts` (runtime)

Imported from a server-only module that runs once per process (a tiny `lib/env/bootstrap.ts` invoked from `middleware.ts` on the first request, plus from `scripts/run-migration.mjs` and `scripts/db-push-prod.mjs`). Validates the server-secret surface and aborts the process if any of these are wrong:

- Required secrets present for the current `APP_ENV`: `SUPABASE_SERVICE_ROLE_KEY`, `SHOPIFY_API_SECRET`, `TOKEN_ENCRYPTION_KEY_V1`, `CRON_SECRET`.
- `TOKEN_ENCRYPTION_KEY_V1` is exactly 64 hex chars (32 bytes).
- `APP_ENV=development` and `EMAIL_FROM` references `mail.disputedesk.app` (the prod sending subdomain) while `EMAIL_SEND_ENABLED=true`.
- Any future production-only secret leaked into dev (validated by a denylist of variable names — see runbook).

This module **must not** print any secret value, any hash of any secret value, or any fingerprint derived from a secret. It may print variable names + boolean presence indicators only.

### 6.2 `lib/cron/envGate.ts` — explicit cron gate (correction 3)

```ts
export function cronEnvGate(req: Request): Response | null {
  if (process.env.CRON_ENABLED !== "true") {
    return new Response(null, { status: 204 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}
```

Every existing route under `app/api/cron/*` calls `cronEnvGate(req)` before any work. Dev default: `CRON_ENABLED=false` → all cron paths return 204. Prod: `CRON_ENABLED=true`.

A vitest case enumerates `app/api/cron/**/route.ts` and fails the build if any file does not import and call `cronEnvGate`.

#### 6.2a Worker route gate (correction 4)

`app/api/jobs/worker/route.ts` was inspected for callers before deciding which gate applies. Findings:

- Documented entrypoint: Vercel cron every 2 min (matches `vercel.json`).
- Auth: accepts `x-cron-secret` header, `Authorization: Bearer`, or `?secret=` query param against `CRON_SECRET`.
- Internal callers: none found by repo grep — `middleware.ts` references it only as an auth-exempt path, no internal `fetch()` to the URL exists.

Conclusion for this work: `cronEnvGate` is the correct gate for the worker today. If a future code path adds an internal HTTP caller (admin retry button, debug tool, programmatic enqueue), refactor to a separate `lib/internal/jobRouteGate.ts` that performs the env+secret check on a non-cron signal (e.g. a separate `JOB_ROUTE_SECRET` plus `APP_ENV` allowlist). The lint test in §6.2 must be updated at that time to recognize the new gate.

### 6.3 `/api/health` (extend the existing route)

Replace today's three-field response with:

```json
{
  "appEnv": "development",
  "gitSha": "abc1234",
  "appUrl": "https://dev.disputedesk.app",
  "supabaseProjectRefFp": "a1b2c3d4",
  "shopifyClientIdFp": "84f40ec7",
  "cronEnabled": false,
  "buildTime": "2026-05-13T12:34:56Z",
  "apiVersion": "2026-01"
}
```

Fingerprints here are first-8-chars of the public Supabase project ref and the public Shopify `client_id` only. No secrets. `/api/health` is **observability**; `lib/env/runtime-identity.ts` is the **hard safety mechanism**.

### 6.4 `scripts/verify-env-identity.mjs`

CLI form, wired into `scripts/release-verify.mjs`. Imports `build-identity.ts` to check public vars; for runtime-identity it does presence-and-shape checks only (length of encryption key, presence of service-role key) — never compares secret values or logs derivatives.

## 7. Supabase — schema and non-schema parity

Schema is reproduced by `npm run db:migrate` against the dev project. **Non-schema** settings live in the Supabase dashboard and must be documented in `docs/runbooks/supabase-dev-project-setup.md`. Inventory to replicate from prod → dev:

- **Auth → URL Configuration:** site URL = `https://dev.disputedesk.app`; redirect URLs include `/auth/open-in-shopify` and any portal callbacks currently configured on prod.
- **Auth → Hooks → Send Email:** copy current hook URL pattern; generate **new** `SUPABASE_AUTH_HOOK_SECRET` for dev; never reuse prod's.
- **Auth → Providers:** match prod's enabled providers (email, magic link).
- **Storage → Buckets:** three buckets per migrations — `policy-uploads` (migration 023), `evidence-uploads` (20260424150000), `evidence-packs` (mime constraints in 20260424170000). Create them in dev with identical private settings.
- **Storage → Policies:** RLS on each bucket; confirm the policies created by migrations match the dashboard view.
- **Database → RLS:** confirm RLS is ON for every table touched by migration 006 and subsequent.
- **Database → Functions / Triggers:** verify those created by migrations are present (`claim_jobs` RPC from 008, `e2e_fixture_cleanup` from 20260509140000, etc.).
- **Edge Functions:** none today — note explicitly so a future addition is caught.
- **Realtime:** none today — same.
- **Project Settings → API:** record dev anon + service-role keys into the dev Vercel project only.

**End-of-Phase-1 verification (must all pass):**

- Generate a synthetic evidence pack on dev. PDF appears in dev's `evidence-packs` bucket. URL host is dev's Supabase, not prod's.
- Dev service-role key is absent from prod Vercel env. Prod service-role key is absent from dev Vercel env.
- **Encryption-key isolation drill:** take a sample row from `shopify_sessions` on prod (offline token), attempt to decrypt with dev's `TOKEN_ENCRYPTION_KEY_V1`. Must fail. Record result in the runbook.

## 8. Shopify — deployment safety (correction 3)

- `shopify.app.toml` → thin file used **only** for local `shopify app dev` (tunnel).
- `shopify.app.prod.toml` → today's TOML moved here verbatim; only intentional, reviewed changes touch it.
- `shopify.app.dev.toml` → dev Partners app: `application_url = "https://dev.disputedesk.app"`, dev `client_id`, dev redirect URL, GDPR URLs pointing at dev, scopes initially without `read_all_orders`.

### Verified Shopify CLI invocation

Shopify CLI 3.94.3 (`shopify app deploy --help`) takes `-c, --config=<value>` where the value is "**the name of the app configuration**" — that is, an alias managed by `shopify app config link` / `shopify app config use`, **not** a TOML file path. Therefore the wrapper scripts must:

1. Run `shopify app config link --config=dev` once per machine, naming each TOML with a recognized alias suffix (`shopify.app.dev.toml` → alias `dev`; `shopify.app.prod.toml` → alias `prod`). This is the documented Shopify CLI pattern for multi-config repos.
2. Wrapper scripts invoke `shopify app deploy --config=<alias>` (alias, not filename).

Wrapper scripts (in `package.json`) — exact form to be finalized in Phase 3 after running `shopify app config link` and confirming the alias works against a development store:

```jsonc
"shopify:deploy:dev":  "node scripts/guard-shopify-config.mjs dev  && shopify app deploy --config=dev --allow-updates",
"shopify:deploy:prod": "node scripts/guard-shopify-config.mjs prod && shopify app deploy --config=prod --allow-updates"
```

Notes:
- `--allow-updates` is the CLI's recommended CI/CD flag (vs the deprecated `-f`/`--force`); use it instead of `--allow-deletes` unless deliberately dropping config.
- **Never run bare `shopify app deploy`.** Only the wrapper scripts.

### `scripts/guard-shopify-config.mjs <target>`

Parses the corresponding TOML by alias mapping (`dev` → `shopify.app.dev.toml`, `prod` → `shopify.app.prod.toml`) and refuses to proceed if:

- target = `prod` and `application_url !== "https://disputedesk.app"`.
- target = `prod` and `client_id !== "84f40ec77c9ba18e9eabc1657d9b6af8"`.
- target = `dev` and `application_url !== "https://dev.disputedesk.app"`.
- target = `dev` and `client_id` equals the known prod client_id.
- `api_version` differs from `2026-01`.
- `[webhooks.privacy_compliance]` is missing or any of its three URLs is missing.
- `app/uninstalled` or `shop/update` subscriptions are missing.
- `embedded != true`.

Post-deploy Shopify verification (manual, recorded in the release runbook): app URL, redirect URLs, embedded flag, scope list, all three GDPR URLs, API version, `app/uninstalled` subscription, `shop/update` subscription, and runtime `disputes/create`/`disputes/update` registration on first OAuth against a test store. For the dev app, also: PCD approval status.

## 9. Cron, CI, and the manual production release

### 9.1 Cron

Every route under `app/api/cron/*` calls `cronEnvGate(req)` first. Dev: 204s by default. Prod: business as usual. `vercel.json` stays a single file — runtime gate handles env difference, runtime identity validator catches misconfiguration.

### 9.2 CI does **not** mutate prod DB (correction 2 — companion rule)

`release:verify` enforces:

1. `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build` all pass.
2. `scripts/verify-env-identity.mjs` against the local env passes (build-time + runtime presence-and-shape).
3. `supabase migration list --linked` against **dev** shows every file in `supabase/migrations/` applied (zero drift on dev).
4. Repo migration filename count matches the count returned by `supabase migration list --linked` on dev.
5. The set of migration filenames in the repo minus the set already applied on **prod** equals the "expected delta" recorded in the PR body — never empty unless the PR is non-schema.

CI **never** calls `supabase db push --linked` against prod.

### 9.3 Manual prod push

```json
"db:push:prod": "node scripts/db-push-prod.mjs"
```

`scripts/db-push-prod.mjs` is interactive: requires `APP_ENV=production` env, prints the expected delta (`supabase migration list --linked` diff against repo), prompts for explicit confirmation, then runs `supabase db push --linked` against prod. Logged to `docs/runbooks/prod-release-log.md` (append-only) with timestamp, git SHA, migration filenames applied.

Documented in `docs/runbooks/prod-release.md` with a literal checklist (see Phase 5 below).

## 10. Sequenced implementation plan

**Phase -1 is blocking. Phases 0–6 are sequenced; some can overlap once -1 is done.**

### Phase -1 — Freeze & snapshot (BLOCKING)

No other phase starts until this is committed. Output: `docs/runbooks/prod-current-state-snapshot.md`.

1. **Verified restorable production backup (correction 2).** Produce a backup using whatever facility the current Supabase plan exposes (Dashboard PITR, scheduled backups, `pg_dump --link`, or third-party tool — pick what the plan supports). **Verify it actually restores** by restoring into a scratch destination (a fresh local Postgres or a temporary Supabase project) and confirming row counts on three sentinel tables (`shops`, `disputes`, `evidence_packs`) match the source. Record in the snapshot: backup timestamp, backup ID/path, verification timestamp, restoration method (with the exact command), and the operator who performed the verification. **This is the rollback floor.**
2. Record the production Supabase project ref: `sddzuglxdnkhcnjmcpbj` (public identifier — recording the full value is fine).
3. `npx supabase migration list --linked` (prod) → paste into the snapshot.
4. `vercel env ls production` → list **names + Vercel-environment scope only**. Do **not** record values, prefixes, hashes, or any derivative of any secret value (correction 1). Fingerprints are reserved for non-secret identifiers.
5. Record the current Vercel production deploy ID and the underlying git SHA.
6. Copy `shopify.app.toml` content into the snapshot doc (current frozen prod config).
7. Record Shopify production: app URL, all redirect URLs, all three GDPR webhook URLs, API version, scope list verbatim, full `client_id` (it's a public identifier).
8. Record DNS state for `disputedesk.app` (registrar, name servers, current A/AAAA/CNAME on root + any subdomains).
9. Copy `vercel.json` cron schedule list into the snapshot.
10. Record Resend config: from address, verified domain, whether the auth-email hook is on.
11. **Secrets inventory: names and presence indicator only (correction 1).** For each required secret, record only: variable name, whether it is set in each Vercel environment scope, and the Vercel scope (Development/Preview/Production). **Do not record fingerprints, prefixes, or any derivative of secret values.** Fingerprints/prefixes are permitted only for non-secret identifiers: Supabase project ref, Shopify `client_id`, Vercel project ID, and domain names.

### Phase 0 — Safety primitives (no prod data touch)

1. Create `lib/env/build-identity.ts` per §6.1a.
2. Create `lib/env/runtime-identity.ts` per §6.1b.
3. Wire `build-identity` into `next.config.ts` (build-time check).
4. Create a tiny `lib/env/bootstrap.ts` that invokes `runtime-identity` once per process; import it from `middleware.ts` (early in the request lifecycle) and from CLI scripts (`scripts/db-push-prod.mjs`, future operator tools).
5. Create `lib/cron/envGate.ts` per §6.2.
6. Apply `cronEnvGate(req)` to all 11 cron routes under `app/api/cron/*` and to `app/api/jobs/worker/route.ts` (worker caller-inspection above; if a future internal caller appears, replace with `jobRouteGate`).
7. Extend `app/api/health/route.ts` per §6.3.
8. Create `scripts/verify-env-identity.mjs` and wire into `scripts/release-verify.mjs`.
9. Add vitest cases:
   - Cron-gate presence on every cron route (enumerates `app/api/cron/**/route.ts` + `app/api/jobs/worker/route.ts`).
   - `build-identity` rejects each dangerous public-env combination.
   - `runtime-identity` rejects each dangerous secret-presence combination (using shapes only, never real values).
10. Set `APP_ENV=production`, `CRON_ENABLED=true` on the existing Vercel project (Production scope only). Leave Preview/Development scopes blank or set to `development` until they are properly scoped in Phase 2. Deploy. Verify `/api/health` reflects it. Verify prod cron continues working.

This phase ships to today's prod **before** the dev environment exists. It adds the safety net for everything that follows.

### Phase 1 — Supabase dev project

1. Create new Supabase project `disputedesk-dev` (same region as prod).
2. From a clean local checkout: `supabase login`, `supabase link --project-ref <dev-ref>`, `supabase db push`. Migrations must apply cleanly start-to-finish — proves the migration set is fully self-contained.
3. Reproduce non-schema settings per §7 → record each in `docs/runbooks/supabase-dev-project-setup.md`.
4. Create dev-only admin user; insert into `internal_admin_grants`.
5. Run the encryption-key isolation drill (§7 verification). Record result.

### Phase 2 — Vercel dev project + DNS

1. Reclaim or verify `dev.disputedesk.app` (it currently resolves to a Vercel anycast IP — likely a wildcard alias or stale project). Reassign to the new Vercel project.
2. New Vercel project `disputedesk-dev`. Connect to repo, deploy from `develop` branch.
3. Wire env vars per the isolation table in §5. Set `APP_ENV=development`, `CRON_ENABLED=false`, `EMAIL_SEND_ENABLED=false`.
4. **Important:** in the existing prod Vercel project, **narrow** the scope of every shared secret (`SUPABASE_SERVICE_ROLE_KEY`, `SHOPIFY_API_SECRET`, `TOKEN_ENCRYPTION_KEY_V1`, `CRON_SECRET`, `RESEND_API_KEY`, etc.) to **Production only**. Today they leak into Preview and Development scopes. This is part of the same change as standing up the dev project — do it together so preview deploys against feature branches don't pick up prod secrets.
5. Deploy. Hit `/api/health` — verify response shows dev fingerprints.
6. Confirm prod's Vercel project is untouched and prod `/api/health` is unchanged.

### Phase 3 — Shopify dev Partners app

1. Partners → create app `DisputeDesk-Dev` (unlisted).
2. Rename today's `shopify.app.toml` → `shopify.app.prod.toml`. Add `shopify.app.dev.toml` with dev URLs/scopes (start without `read_all_orders`).
3. Restore a thin local-tunnel `shopify.app.toml` for `shopify app dev`.
4. Run `shopify app config link --config=dev` (and same for `prod`) — verify the alias-based invocation works against the installed CLI 3.94.3.
5. Create `scripts/guard-shopify-config.mjs` per §8.
6. Add wrapper scripts to `package.json`.
7. `npm run shopify:deploy:dev` → register dev app in Partners. Verify all items in §8 post-deploy checklist.
8. Submit Protected Customer Data approval for the dev app (parallel — 3–7 business days, Shopify-dependent).
9. Create development store(s); install dev app from Partners; confirm Shopify Payments **test mode** enabled.

### Phase 4 — Seed data classification

Reorganize seed scripts (`package.json` + script files):

- **Category A — operational seed (prod-safe, idempotent):** `reason_template_mappings`, `pack_templates`, `internal_admin_grants` (your account). Promote via migrations or rename to `seed:prod-safe:*` with internal `APP_ENV` checks that confirm they only insert if absent.
- **Category B — synthetic dev-only:** `seed:synthetic-disputes`, `seed:shopify-chargeback-cluster`, `seed:real-disputes`, fixture E2E shops. Rename to `seed:dev:*`; abort at the top if `APP_ENV !== "development"`.
- **Category C — content / marketing:** `seed:resources`, hub articles. Add a top-of-file guard requiring an explicit `--allow-prod` flag plus `APP_ENV=production` when run against prod, so content publishing is a deliberate act.

Rule documented in `docs/runbooks/prod-release.md`: no seed script runs against production unless its file declares `// PROD_SAFE: true` and is idempotent.

### Phase 5 — Migration discipline & manual prod push

1. Create `scripts/db-push-prod.mjs` per §9.3.
2. Add `"db:push:prod"` to `package.json`.
3. Extend `release:verify` per §9.2.
4. Write `docs/runbooks/prod-release.md` (the release checklist below).
5. Write `docs/runbooks/prod-rollback.md` covering: revert deploy (Vercel rollback), revert migration (manual SQL inverse — author writes the inverse in the same PR), restore Supabase from snapshot if catastrophic.

**`docs/runbooks/prod-release.md` checklist (literal):**

- [ ] PR merged to `develop`. Dev deployment green. Dev `/api/health` shows expected `gitSha`.
- [ ] Manually smoke-tested affected feature on `dev.disputedesk.app` against a development store.
- [ ] `npm run release:verify` green locally.
- [ ] PR opened from `develop` → `master`. CI green.
- [ ] Squash-merge to `master`. Vercel prod deploy completes. Prod `/api/health` shows new `gitSha`.
- [ ] If the PR includes migrations: `APP_ENV=production npm run db:push:prod`. Confirm at the prompt. Record output in `docs/runbooks/prod-release-log.md`.
- [ ] Post-deploy: hit one canary read endpoint and confirm 200.
- [ ] Watch dispute-sync cron at the next 5-minute boundary; confirm no error spike.

### Phase 6 — End-to-end dry run (the trust moment, correction 6)

1. **Smoke-migration mechanism (not a column add/drop on prod).** Introduce a single accretive table `release_smoke_log`:
   ```sql
   CREATE TABLE IF NOT EXISTS release_smoke_log (
     id           bigserial PRIMARY KEY,
     git_sha      text NOT NULL,
     env          text NOT NULL,
     ran_at       timestamptz NOT NULL DEFAULT now()
   );
   ```
   Each release dry-run ships a migration that does a single `INSERT` recording the git SHA and `current_setting('app.env', true)` (or a passed parameter). The table is append-only and idempotent at the migration-file level (the `INSERT` is unique per migration filename, so re-running is a no-op). **No product schema is added or dropped.** This becomes the running log of release dry-runs and is itself the smoke artifact.
2. Run a full pipeline against a development store: simulate a Shopify Payments dispute → dev pipeline → pack build → PDF stored in dev `evidence-packs` bucket → save-to-Shopify against the test store.
3. Re-run env identity validator with a deliberately-broken combination (e.g. dev env file with prod Supabase URL) — confirm it refuses to boot.
4. Confirm prod's `/api/health` and `/api/cron/sync-disputes` behavior unchanged throughout.

If any step fails, halt. Fix before declaring the split complete.

### Phase 7 (optional, post-launch) — Hardening

Not blocking for launch. Add when there's time:

- Sentry projects per env.
- Daily `audit_events` row-count diff alert (anomaly detection).
- Post-deploy SHA drift check across env after every deploy.
- Per-PR ephemeral Supabase via Supabase Branching (when GA and pricing makes sense).
- Visual regression on dev before prod.

## 11. File checklist

| Path | Action | Notes |
|---|---|---|
| `docs/plans/dev-prod-environment-split.plan.md` | **created in this commit** | this document |
| `docs/runbooks/prod-current-state-snapshot.md` | create — Phase -1 | names + presence + non-secret fingerprints |
| `docs/runbooks/prod-release.md` | create — Phase 5 | manual release checklist |
| `docs/runbooks/prod-release-log.md` | create — Phase 5 | append-only log of every prod migration push |
| `docs/runbooks/prod-rollback.md` | create — Phase 5 | rollback procedures |
| `docs/runbooks/supabase-dev-project-setup.md` | create — Phase 1 | non-schema dashboard settings |
| `docs/env-vars.md` | create — Phase 0 | dev vs prod column for every env var |
| `lib/env/build-identity.ts` | create — Phase 0 | build-time validator |
| `lib/env/runtime-identity.ts` | create — Phase 0 | runtime validator |
| `lib/env/bootstrap.ts` | create — Phase 0 | invokes runtime validator once per process |
| `lib/cron/envGate.ts` | create — Phase 0 | cron gate |
| `app/api/health/route.ts` | update — Phase 0 | replace 3-field response per §6.3 |
| 11× `app/api/cron/**/route.ts` | update — Phase 0 | call `cronEnvGate` (full list below) |
| `app/api/jobs/worker/route.ts` | update — Phase 0 | call `cronEnvGate` (see §6.2a) |
| `scripts/release-verify.mjs` | update — Phase 0 | wire identity + migration parity |
| `scripts/verify-env-identity.mjs` | create — Phase 0 | CLI mirror of validators |
| `scripts/guard-shopify-config.mjs` | create — Phase 3 | refuses bad TOML before deploy |
| `scripts/db-push-prod.mjs` | create — Phase 5 | interactive prod migration push |
| `shopify.app.toml` | update — Phase 3 | shrink to local-tunnel-only |
| `shopify.app.prod.toml` | create — Phase 3 | today's TOML moved here verbatim |
| `shopify.app.dev.toml` | create — Phase 3 | dev Partners app config |
| `package.json` | update — Phases 3+5 | add `shopify:deploy:dev`, `shopify:deploy:prod`, `db:push:prod`, rename seed scripts |
| `lib/cron/__tests__/envGate.test.ts` | create — Phase 0 | unit + presence-on-every-cron-route |
| `lib/env/__tests__/build-identity.test.ts` | create — Phase 0 | reject each dangerous public-env combo |
| `lib/env/__tests__/runtime-identity.test.ts` | create — Phase 0 | reject each dangerous secret-presence combo |
| `.env.example` | update — Phase 0 | document `APP_ENV`, `CRON_ENABLED`, `EMAIL_SEND_ENABLED`, `CRON_ENABLED_DEV_OVERRIDE` |
| `CLAUDE.md` | update — Phase 5 | add non-negotiables: never run bare `shopify app deploy`; never auto-push to prod DB; always call `cronEnvGate` |
| `next.config.ts` | update — Phase 0 | import `build-identity` |
| `middleware.ts` | update — Phase 0 | import `lib/env/bootstrap.ts` for runtime check |
| `vercel.json` | unchanged | cron list intact; gating handled at runtime |

The 11 cron routes (all under `app/api/cron/`): `autopilot-generate`, `publish-content`, `check-shopify-reasons`, `dispute-reminders`, `snapshot-daily-metrics`, `retention-cleanup`, `sync-disputes`, `signal-radar-reddit`, `signal-radar-classify`, `snapshot-fraud-daily-metrics`, `monthly-digest`.

## 12. Definition of Done

The split is complete only when **every one** of these is verified:

- [ ] `dev.disputedesk.app` runs against the dev Supabase project only.
- [ ] `disputedesk.app` runs against the prod Supabase project only.
- [ ] Dev Shopify Partners app installs only on test stores. Prod app is unchanged.
- [ ] Dev and prod do not share: Supabase ref, anon key, service-role key, Shopify `client_id`, Shopify API secret, `TOKEN_ENCRYPTION_KEY_V1`, `CRON_SECRET`, Resend config.
- [ ] Dev cron routes return 204. Prod cron routes work with `CRON_ENABLED=true` + `CRON_SECRET`.
- [ ] `/api/health` returns env identity (fingerprints only) on both deployments and correctly identifies each.
- [ ] `build-identity` refuses every dangerous public-env combination listed in §6.1a (tests + a manual misconfig probe).
- [ ] `runtime-identity` refuses every dangerous secret-presence combination in §6.1b.
- [ ] A `release_smoke_log` migration has been shipped through develop → dev DB → master → prod DB (manual).
- [ ] A simulated dispute on a development store completes pipeline-to-save end-to-end on dev.
- [ ] Evidence PDF generation writes to dev's `evidence-packs` bucket; URL host is dev's Supabase.
- [ ] `docs/runbooks/prod-current-state-snapshot.md`, `prod-release.md`, `prod-rollback.md`, `supabase-dev-project-setup.md` all exist and are accurate.
- [ ] `vercel env ls` on the prod project shows no dev-only env scopes; on the dev project shows no prod secrets.
- [ ] No E2E or seed script can write to prod Supabase (`APP_ENV` guard in each script).
- [ ] No preview deployment can use production Supabase or production Shopify secrets (verified via Phase 2 scope narrowing).

## 13. Open decisions (blocking only)

Two. Both have a recommended default; flag only if you disagree.

1. **Dev Protected Customer Data approval.** *Recommended:* submit the form for the dev app on day one of Phase 3, in parallel. Dev runs on `read_orders` (60-day window) until granted — enough for day-to-day flows. Alternative: never grant `read_all_orders` to dev and accept the 60-day limit indefinitely.
2. **Phase ordering.** The dev app's redirect URL and GDPR URLs must be live before `shopify app deploy` accepts them. *Recommended:* stand up `dev.disputedesk.app` (Phase 2) before Phase 3. Already reflected in the sequence — flagging because it's the only ordering constraint between otherwise-overlappable phases.

Everything else (Resend dev subdomain vs send-suppressed default → suppressed; Sentry now vs later → later; per-PR ephemeral DBs → deferred) has a default chosen.

---

## 14. Estimate (correction 7)

Wall-clock: **a few focused implementation days for Phases -1 through 6, plus Shopify's Protected Customer Data review time.** The estimate assumes the dev Supabase comes up cleanly from migrations and that prod's non-schema dashboard state proves replicable without surprises — both knowable only during Phase 1. Shopify's PCD review is the only true external blocker; everything else is sequential local work.
