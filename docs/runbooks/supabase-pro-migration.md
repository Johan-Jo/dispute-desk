# Supabase Pro migration — cutover runbook

**Goal.** Move the production database from the existing Free-tier Supabase
project (`sddzuglxdnkhcnjmcpbj`) to the new Pro-tier project. After cutover,
the new Pro project is the canonical production. The old Free project becomes
read-only for a holdback period and is then decommissioned (or repurposed as
the dev project — to be decided in a follow-up).

This supersedes Phase 1 of [`dev-prod-environment-split.plan.md`](../plans/dev-prod-environment-split.plan.md)
for the production side: the dev project becomes a separate workstream
addressed after this cutover.

> **Hard rule.** This runbook executes in a maintenance window. No commits to
> `master` between Step 4 (Vercel env swap) and Step 6 (health verification)
> — those two steps must be back-to-back, otherwise the running prod build
> reads stale env vars while the new code is live.

## 0. Pre-cutover (anytime, no prod traffic impact)

These steps prepare the new Pro project without touching the existing prod.

### 0.1 Operator: capture new Pro project identity

Get from the Supabase Dashboard → Project Settings → API:

- **Project ref** — the subdomain before `.supabase.co` (e.g. `abcde1234567`). Public.
- **Project URL** — `https://<project-ref>.supabase.co`.
- **anon (public) key** — `eyJ…`. Public but treat like a secret in transit.
- **service_role (secret) key** — server-only. Never commit, never log.

Get from Database → Connection string → Direct connection:

- **Postgres URL** — `postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres`.

Put these in **`.env.production.local`** at the repo root (gitignored — `.env*.local`
is already excluded):

```
# .env.production.local — prod creds for manual cutover/migration ops only.
# Never used by `npm run dev` (loads .env.local) or `npm run build` unless
# a script explicitly does `dotenv.config({ path: ".env.production.local" })`.

# NEW Pro project
NEW_SUPABASE_URL=https://<new-ref>.supabase.co
NEW_SUPABASE_ANON_KEY=eyJ...
NEW_SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEW_SUPABASE_URL_POSTGRES=postgresql://postgres:<new-password>@db.<new-ref>.supabase.co:5432/postgres

# OLD Free project (source of truth until cutover)
OLD_SUPABASE_URL=https://sddzuglxdnkhcnjmcpbj.supabase.co
OLD_SUPABASE_URL_POSTGRES=postgresql://postgres:<old-password>@db.sddzuglxdnkhcnjmcpbj.supabase.co:5432/postgres
```

### 0.2 Schema replay on the new project

```
npx supabase link --project-ref <new-ref>
npx supabase db push
```

Confirms every migration in `supabase/migrations/` applies cleanly start-to-finish.
Should report 98 applied (matches the count in
`docs/runbooks/prod-current-state-snapshot.md` §2.1 at the time of capture —
plus any migrations added since).

### 0.3 Storage buckets (non-schema)

`supabase db push` creates bucket rows via the migrations that own them
(`023_policy_uploads_bucket.sql`, `20260424150000_evidence_uploads_bucket.sql`,
`20260424170000_evidence_packs_bucket_mime.sql`). Confirm in Dashboard → Storage:

- [ ] `policy-uploads` exists, private.
- [ ] `evidence-uploads` exists, private.
- [ ] `evidence-packs` exists, private, mime constraint set per migration 20260424170000.

If any are missing, the corresponding migration didn't take. Investigate
before proceeding.

### 0.4 Auth non-schema settings

Replicate from old project Dashboard → Authentication:

- [ ] URL Configuration → Site URL: `https://disputedesk.app`.
- [ ] URL Configuration → Redirect URLs: copy verbatim from old project.
- [ ] Providers: enable the same set as old (Email magic link, etc.).
- [ ] Hooks → Send Email: configure same hook URL. **Generate a NEW** `SUPABASE_AUTH_HOOK_SECRET` for the new project (never reuse old).

### 0.5 Pre-cutover sanity

Run the verifier (read-only against both projects):

```
node scripts/verify-supabase-migration.mjs --schema-only
```

Should print "schemas match" with table-name diff. Data diff is expected
(new project is empty) and will be verified in Step 5 post-restore.

### 0.6 Code preparation (do NOT merge yet)

In a working branch (not the cutover branch), update the two locations of the
prod project ref constant. The PR sits ready for cutover-day merge.

- `lib/env/build-identity.ts` → `KNOWN_PROD_SUPABASE_PROJECT_REF`
- `scripts/verify-env-identity.mjs` → `KNOWN_PROD_SUPABASE_PROJECT_REF`
- `docs/env-vars.md` → prod column
- Append entry to `docs/runbooks/prod-release-log.md`

## 1. Maintenance-window cutover

Estimated window: 30–60 min for current data volume. Schedule a low-traffic window.

### Step 1: Announce + freeze writes

- [ ] Post merchant-facing notice (if applicable).
- [ ] Pause Vercel cron temporarily by setting `CRON_ENABLED=false` on Vercel
      Production scope. (Once Phase 0 lands. Pre-Phase-0, comment out the
      crons in `vercel.json` and redeploy — clunkier.)
- [ ] Confirm no webhooks are mid-flight by watching `/admin/webhooks`.

### Step 2: Dump data from old prod

```
pg_dump \
  --data-only \
  --no-owner \
  --no-acl \
  --disable-triggers \
  --schema=public \
  --file=./tmp/prod-data-$(date -u +%Y%m%dT%H%M%SZ).sql \
  "$OLD_SUPABASE_URL_POSTGRES"
```

Notes:
- `--data-only`: schema is already replayed in Step 0.2.
- `--disable-triggers`: prevents Postgres from running triggers during load (RLS rules etc. fire on insert and would slow or break the restore).
- `--schema=public`: skips `auth.*`, `storage.*`, `supabase_*` — those are Supabase-managed and don't migrate cleanly across projects.

### Step 3: Restore data into new Pro project

```
psql "$NEW_SUPABASE_URL_POSTGRES" --single-transaction --file=./tmp/prod-data-<timestamp>.sql
```

`--single-transaction` rolls back the whole load on any error so the new
project doesn't end up half-populated.

### Step 4: Verify data parity

```
node scripts/verify-supabase-migration.mjs
```

Compares row counts on every `public.*` table. Exit code is non-zero if any
table mismatches. Pay special attention to the sentinel tables: `shops`,
`disputes`, `evidence_packs`. **Stop here if anything mismatches** — fix
before proceeding.

### Step 5: Storage file migration

The buckets exist (Step 0.3) but they're empty. Migrate file objects:

```
node scripts/migrate-supabase-storage.mjs   # see Phase 1 follow-up
```

(For current dev-mode scale — minimal real file volume — this step can be
deferred: files re-upload on next pack-build or merchant action. Confirm
acceptable before skipping.)

### Step 6: Vercel env swap + code deploy (atomic)

**Both must happen before any cold-start lambda picks up the changes.**

- [ ] In Vercel Dashboard → `dispute-desk` project → Environment Variables, on the **Production** scope:
  - Update `SUPABASE_URL` → new Pro URL.
  - Update `NEXT_PUBLIC_SUPABASE_URL` → new Pro URL.
  - Update `SUPABASE_ANON_KEY` → new Pro anon key.
  - Update `NEXT_PUBLIC_SUPABASE_ANON_KEY` → new Pro anon key.
  - Update `SUPABASE_SERVICE_ROLE_KEY` → new Pro service_role.
  - Update `SUPABASE_URL_POSTGRES` → new Pro postgres URL (if currently set).
  - Update `SUPABASE_AUTH_HOOK_SECRET` → new hook secret from Step 0.4.
- [ ] Merge the prepared PR from Step 0.6 (updates `KNOWN_PROD_SUPABASE_PROJECT_REF` + snapshot follow-up). This triggers a Vercel prod redeploy.
- [ ] Wait for deploy to finish (Vercel build runs the prebuild env-identity check; if the Vercel env vars and the code constant agree, the build passes — if they disagree, the build fails and you have a chance to fix before serving any traffic).

### Step 7: Post-deploy verification

- [ ] Hit `https://disputedesk.app/api/health` — confirm `supabaseProjectRefFp` matches the first 8 chars of the new project ref and `supabaseIsKnownProd: true`.
- [ ] Hit a canary read endpoint (e.g. `GET /api/portal/disputes?limit=1` from an authenticated session) — confirm 200 + real data.
- [ ] Open Shopify Admin embedded app on a test shop — confirm the dispute list renders and the most recent dispute is present.
- [ ] If Phase 0 is live: re-enable cron — `CRON_ENABLED=true` on Vercel Production. Watch the next 5-min boundary for `sync-disputes`.

### Step 8: Append release-log entry

In `docs/runbooks/prod-release-log.md`, record:

- Timestamp UTC of cutover.
- Old project ref → new project ref.
- Operator name.
- Verifier output (paste row-count summary).
- Health endpoint response (paste).

Commit + push to master.

## 2. Holdback period (24–72h)

- [ ] Old Free project stays alive, **no writes** (set `app_settings` in the Vercel env to read-only mode if a feature flag exists; otherwise just monitor).
- [ ] Monitor `/api/health` daily for 3 days; watch dispute-sync cron output for errors.
- [ ] Confirm new daily backup (cron `/api/cron/db-backup`) lands in R2 and references the new project.

## 3. Decommission (after holdback)

Two paths — decide in a follow-up PR; do NOT decide on cutover day.

- **Decommission**: Supabase Dashboard → old project → Pause / Delete. Take a final snapshot and store offline first.
- **Repurpose as dev**: wipe data, rotate `TOKEN_ENCRYPTION_KEY_V1`, update env-identity to recognize the old ref as the dev ref. Carries the risk that you forget some tenant data was on it — usually cleaner to start dev from a fresh empty project.

## 4. Rollback (if Step 6 or 7 fails)

- [ ] Revert Vercel env vars to the old Pro project values.
- [ ] Vercel Dashboard → Deployments → promote the prior deploy (pre-merge SHA) to production.
- [ ] Verify `/api/health` shows old project fingerprint.
- [ ] Old project is still authoritative since no writes happened to new project after Step 5.
- [ ] Open a `revert` PR for the constant change. Investigate, fix, retry the cutover.

## Open decisions before cutover

1. **Storage file migration**: migrate files now (Step 5) or defer until first re-upload? Dev-mode scale makes "defer" reasonable.
2. **Auth user re-auth**: old auth.users don't migrate to new project automatically. With minimal real user count, magic-link re-auth on next visit is acceptable. Confirm before cutover.
3. **Old project fate**: decide in a Section 3 follow-up. Cutover doesn't force the decision.
4. **TOKEN_ENCRYPTION_KEY_V1**: keep same key on new project so existing Shopify offline tokens decrypt. **Rotate only if you also re-issue all shop sessions** (forcing every merchant to reinstall — heavy).
