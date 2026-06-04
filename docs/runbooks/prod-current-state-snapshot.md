# Production Current-State Snapshot

> 📌 **Historical snapshot — do not update.** This records prod state as of 2026-05-13, *before* the Free→Pro cutover. At that date prod ran on `sddzuglxdnkhcnjmcpbj`. Current prod is now `aokhplydttxtebvbeuzc` and dev is `vrpkgudqmpyunekrkpnc` (see [`CLAUDE.md`](../../CLAUDE.md)). Every `sddzuglx…` ref below is the *then-current* prod, preserved as-is.

**Captured:** 2026-05-13
**Captured by:** Johan (via Claude Code assist)
**Repo SHA at capture:** `545f4114a066c4473d9898d864cb2e47e59fd5f9`
**Branch:** `master`

> **Rule.** No environment split work (Phases 0+ of `docs/plans/dev-prod-environment-split.plan.md`) starts until this document is committed **and** Section 1 ("Verified Restorable Backup") is signed off by the operator.

This snapshot captures only what is needed to recover, identify, or re-create the current production environment. It records names, presence indicators, and fingerprints of **non-secret identifiers only**. It **does not** record secret values, prefixes, hashes, or any derivative of secret values.

Non-secret identifiers that may be recorded verbatim or fingerprinted: Supabase project ref, Shopify `client_id`, Vercel project ID, Vercel org ID, deployment IDs, domain names, public URLs.

---

## 1. Verified Restorable Production Backup — **REQUIRES OPERATOR ACTION**

This section is blocking. Phases 0+ may not start until the operator has signed off on a verified restorable backup of the production Supabase database.

**Required steps (executed by operator):**

1. Produce a backup of the production Supabase project (ref `sddzuglxdnkhcnjmcpbj`) using whatever facility the current Supabase plan exposes (Dashboard PITR window, scheduled-backup download, `pg_dump`, or third-party tool). Use the supported path for the current plan.
2. **Verify the backup actually restores.** Restore it into a scratch destination — a fresh local Postgres, an empty Supabase project, or any disposable target — and confirm row counts on three sentinel tables match the source:
   - `shops`
   - `disputes`
   - `evidence_packs`
3. Record the result below.

| Field | Value (fill in) |
|---|---|
| Backup timestamp (UTC) | _e.g. 2026-05-13T14:00:00Z_ |
| Backup ID / path | _Supabase backup ID, or filesystem path to the dump_ |
| Restoration method | _Exact command used to restore, e.g. `pg_restore -d <scratch> backup.dump`_ |
| Restored-into scratch destination | _e.g. local Postgres 16 / supabase project `disputedesk-scratch`_ |
| Source row counts: `shops`, `disputes`, `evidence_packs` | _N / N / N_ |
| Restored row counts: `shops`, `disputes`, `evidence_packs` | _N / N / N_ |
| Row counts match | _yes / no_ |
| Verification timestamp (UTC) | _e.g. 2026-05-13T14:30:00Z_ |
| Operator (name + signature) | _Johan_ |

This is the rollback floor. If anything in Phases 0+ goes wrong at the data layer, this backup must be capable of restoring production.

---

## 2. Supabase — Production Project

| Field | Value |
|---|---|
| Project ref | `sddzuglxdnkhcnjmcpbj` |
| Project URL | `https://sddzuglxdnkhcnjmcpbj.supabase.co` |
| Region | _TODO: confirm in Supabase Dashboard → Project Settings_ |
| Plan / tier | _TODO: confirm in Supabase Dashboard → Project Settings → Billing_ |
| Linked locally | yes (`supabase/.temp/linked-project.json` present) |

### 2.1 Migration history (as of capture)

`npx supabase migration list --linked` confirmed full parity between local repo and prod. **98 migrations applied**, from `001` through `20260511140000`. Numbered migrations (`001`–`033`) sit alongside timestamp-named migrations (`20260328123100` onward).

**Last 10 applied (chronological):**

```
20260510120000   20260510120000   2026-05-10 12:00:00
20260510130000   20260510130000   2026-05-10 13:00:00
20260510140000   20260510140000   2026-05-10 14:00:00
20260510150000   20260510150000   2026-05-10 15:00:00
20260511120000   20260511120000   2026-05-11 12:00:00
20260511130000   20260511130000   2026-05-11 13:00:00
20260511140000   20260511140000   2026-05-11 14:00:00
```

No drift between repo and prod at capture time.

### 2.2 Storage buckets

Per migrations, three private buckets exist:

| Bucket | Migration | Purpose |
|---|---|---|
| `policy-uploads` | `023_policy_uploads_bucket.sql` | Merchant-uploaded policy documents |
| `evidence-uploads` | `20260424150000_evidence_uploads_bucket.sql` | Merchant-uploaded evidence files |
| `evidence-packs` | `20260424170000_evidence_packs_bucket_mime.sql` | Rendered evidence-pack PDFs |

_TODO: confirm in Supabase Dashboard → Storage that all three exist with the expected privacy + mime constraints._

### 2.3 Non-schema settings (to verify via dashboard)

- Auth → URL Configuration: site URL, redirect URLs.
- Auth → Hooks → Send Email: configured? Hook URL?
- Auth → Providers: which providers are enabled?
- Database → Functions / Triggers: `claim_jobs` RPC (mig 008), `e2e_fixture_cleanup` (mig 20260509140000), and any others created by migrations.
- Edge Functions: expected **none**.
- Realtime: expected **none enabled**.

_To be confirmed and recorded into `docs/runbooks/supabase-dev-project-setup.md` during Phase 1._

---

## 3. Vercel — Production Project

| Field | Value |
|---|---|
| Project name | `dispute-desk` |
| Project ID | `prj_GM2oFF4BQM0OPw75FOHZ4SVGc27r` |
| Org / team | `estimatepro` (`team_ZlvA7gSYnGZDargMeA8lYRai`) |
| Primary domain | `disputedesk.app` |
| Aliases | `www.disputedesk.app`, `dispute-desk-estimatepro.vercel.app`, `dispute-desk-git-master-estimatepro.vercel.app`, `dispute-desk.vercel.app` |
| Latest prod deployment ID | `dpl_G3bHyBLoSYW7ebXdFJBXHFR7EWVz` |
| Latest prod deployment created (UTC equivalent) | 2026-05-12 00:38:44 (was `Mon May 11 2026 21:38:44 GMT-0300`) |
| Latest prod deployment status | `● Ready` |
| Node version | `24.x` |
| Region (first lambda observed) | `iad1` |
| Repo SHA expected on prod | `545f4114a066c4473d9898d864cb2e47e59fd5f9` (local HEAD; **verify** by re-running `vercel inspect dpl_G3bHyBLoSYW7ebXdFJBXHFR7EWVz` or by hitting `/api/health` post-Phase-0) |

---

## 4. Vercel Production Environment Variables — Names + Scopes Only

The following table lists every environment variable currently configured in the `dispute-desk` Vercel project, with the Vercel-environment scopes each is attached to. **No values, prefixes, hashes, or fingerprints of values are recorded.** Values are encrypted in Vercel; they are not part of this snapshot.

| Variable name | Scopes |
|---|---|
| `PROXY_SECRET` | Production |
| `REDDIT_PROXY_URL` | Production |
| `APIFY_API_KEY` | Production |
| `ANTHROPIC_API_KEY` | Production |
| `GENERATION_PASS_TWO_PROVIDER` | Production |
| `FILE_EVIDENCE_ATTACHMENTS_ENABLED` | Production |
| `INDEXNOW_KEY` | Production |
| `EVIDENCE_LINK_SECRET` | Preview, Production |
| `IPINFO_API_KEY` | Preview, Production |
| `CAL_API_KEY` | Development, Preview, Production |
| `SHOPIFY_BILLING_TEST` | Development, Preview, Production |
| `MATERIAL_SPEC_STORE_UNITS_ENABLED` | Development, Preview, Production |
| `PEXELS_API_KEY` | Development, Preview, Production |
| `IMAGE_AUTOPILOT_ENABLED` | Development, Preview, Production |
| `SUPABASE_AUTH_HOOK_SECRET` | Development, Preview, Production |
| `NEXT_PUBLIC_APP_URL` | Development, Preview, Production |
| `CRON_SECRET` | Development, Preview, Production |
| `RESEND_API_KEY` | Development, Preview, Production |
| `ADMIN_SECRET` | Development, Preview, Production |
| `OPENAI_API_KEY` | Development, Preview, Production |
| `GENERATION_MODEL` | Development, Preview, Production |
| `GENERATION_ENABLED` | Development, Preview, Production |
| `SHOPIFY_SEED_CLIENT_ID` | Development, Preview, Production |
| `SHOPIFY_SEED_CLIENT_SECRET` | Development, Preview, Production |
| `TOKEN_ENCRYPTION_KEY_V1` | Development, Preview, Production |
| `TOKEN_ENCRYPTION_KEY` | Development, Preview, Production |
| `SHOPIFY_API_KEY` | Development, Preview, Production |
| `SHOPIFY_API_SECRET` | Development, Preview, Production |
| `SHOPIFY_SCOPES` | Development, Preview, Production |
| `SHOPIFY_APP_URL` | Development, Preview, Production |
| `SHOPIFY_CLIENT_ID` | Development, Preview, Production |
| `SUPABASE_URL` | Development, Preview, Production |
| `SUPABASE_ANON_KEY` | Development, Preview, Production |
| `SUPABASE_SERVICE_ROLE_KEY` | Development, Preview, Production |
| `NEXT_PUBLIC_SUPABASE_URL` | Development, Preview, Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Development, Preview, Production |

### 4.1 Observations (informational, not part of the snapshot data)

- **Cross-scope leakage:** every dangerous secret currently lives in all three Vercel scopes (Development, Preview, Production). Specifically: `SUPABASE_SERVICE_ROLE_KEY`, `SHOPIFY_API_SECRET`, `TOKEN_ENCRYPTION_KEY_V1`, `CRON_SECRET`, `RESEND_API_KEY`, `OPENAI_API_KEY`. Phase 2 step 4 of the plan narrows each to `Production` only.
- **Duplicate / alias pairs to consolidate during the split:**
  - `SHOPIFY_API_KEY` and `SHOPIFY_CLIENT_ID` (likely the same `client_id`).
  - `TOKEN_ENCRYPTION_KEY` and `TOKEN_ENCRYPTION_KEY_V1` (the alias is intentional per `.env.example`; flag during Phase 0 to confirm it should still ship in v3).
- **Missing for the split:** `APP_ENV`, `CRON_ENABLED`, `EMAIL_SEND_ENABLED`, `CRON_ENABLED_DEV_OVERRIDE` — none currently set. Added in Phase 0.

---

## 5. Shopify — Production App Configuration

Source: `shopify.app.toml` at SHA `545f411`, plus `npx shopify --version`.

| Field | Value |
|---|---|
| Shopify CLI installed | `shopify/3.94.3 win32-arm64 node-v22.4.1` |
| `shopify app deploy` config flag | `-c, --config=<value>` where value is the configuration **name/alias** (not a file path) |
| App name | `DisputeDesk` |
| App `client_id` | `84f40ec77c9ba18e9eabc1657d9b6af8` (public identifier) |
| `application_url` | `https://disputedesk.app` |
| `embedded` | `true` |
| OAuth redirect URLs | `https://disputedesk.app/api/auth/shopify/callback` |
| `api_version` | `2026-01` |
| Distribution / listed | listed (App Store) |
| POS embedded | `false` |

### 5.1 Scope list (verbatim, current as of 2026-05-11 tightening commit)

```
read_all_orders
read_customers
read_fulfillments
read_orders
read_products
read_shipping
read_shopify_payments_dispute_evidences
read_shopify_payments_dispute_file_uploads
read_shopify_payments_disputes
write_shopify_payments_dispute_evidences
write_shopify_payments_dispute_file_uploads
```

### 5.2 Webhooks (declarative in TOML)

**Topic subscriptions (`[[webhooks.subscriptions]]`):**

| Topic | URI |
|---|---|
| `app/uninstalled` | `/api/webhooks/app-uninstalled` |
| `shop/update` | `/api/webhooks/shop-update` |

**Runtime subscriptions (registered at OAuth, not in TOML):**

- `disputes/create`
- `disputes/update`

(Both require Protected Customer Data approval; granted for prod app per ticket 64535407, 2026-03-04.)

**GDPR mandatory webhooks (`[webhooks.privacy_compliance]`):**

| Webhook | URL |
|---|---|
| `customer_data_request_url` | `https://disputedesk.app/api/webhooks/customers-data-request` |
| `customer_deletion_url` | `https://disputedesk.app/api/webhooks/customers-redact` |
| `shop_deletion_url` | `https://disputedesk.app/api/webhooks/shop-redact` |

### 5.3 Protected Customer Data approval

- Approved: `read_all_orders` (ticket 64535407, 2026-03-04). Pushed 2026-05-10.
- Approved: `read_shopify_payments_disputes` (required for `disputes/*` webhook subscriptions).

### 5.4 Seed Partners app (separate, unchanged)

- A second Partners app exists for seed scripts (`SHOPIFY_SEED_CLIENT_ID` / `SHOPIFY_SEED_CLIENT_SECRET` in Vercel env). This snapshot does not modify or touch the seed app. Confirmed it is a **separate** Partners app from the production app.

---

## 6. DNS — `disputedesk.app`

| Field | Value |
|---|---|
| Nameservers | `ns1.vercel-dns.com`, `ns2.vercel-dns.com` |
| Registrar | _TODO: confirm — likely third-party registrar pointing NS at Vercel; record registrar name + account_ |
| Root `A` records | `216.198.79.65`, `216.198.79.1` (Vercel anycast) |
| `www.` alias | resolves to Vercel (via Vercel project alias) |
| `dev.disputedesk.app` | currently resolves to `64.29.17.1`, `64.29.17.65` — **wildcard or stale alias under the same Vercel team**. To be claimed in Phase 2. |

_TODO before Phase 2 start: investigate why `dev.disputedesk.app` resolves today (likely Vercel team wildcard or a forgotten project alias). Identify and clear before reassigning to the new `disputedesk-dev` Vercel project._

---

## 7. Cron Schedule (current, from `vercel.json`)

All schedules run against the single production deployment today. No env gate; this is the gap Phase 0 closes.

| Path | Schedule (cron) | Note |
|---|---|---|
| `/api/cron/publish-content` | `0 9 * * *` | daily 09:00 UTC |
| `/api/cron/autopilot-generate` | `0 8 * * *` | daily 08:00 UTC |
| `/api/cron/dispute-reminders` | `0 9 * * *` | daily 09:00 UTC |
| `/api/cron/check-shopify-reasons` | `0 10 * * *` | daily 10:00 UTC |
| `/api/cron/sync-disputes` | `*/5 * * * *` | every 5 min |
| `/api/cron/snapshot-daily-metrics` | `30 0 * * *` | daily 00:30 UTC |
| `/api/cron/snapshot-fraud-daily-metrics` | `45 0 * * *` | daily 00:45 UTC |
| `/api/cron/retention-cleanup` | `0 3 * * 0` | weekly Sun 03:00 UTC |
| `/api/jobs/worker` | `*/2 * * * *` | every 2 min |
| `/api/cron/signal-radar-reddit` | `0 * * * *` | hourly |
| `/api/cron/signal-radar-classify` | `*/5 * * * *` | every 5 min |
| `/api/cron/monthly-digest` | `0 9 1 * *` | 1st of month 09:00 UTC |

---

## 8. Email / Resend Configuration

| Field | Value (from repo / `.env.example`) |
|---|---|
| Provider | Resend |
| `EMAIL_FROM` (configured default) | `DisputeDesk <notifications@mail.disputedesk.app>` |
| Sending subdomain (assumed) | `mail.disputedesk.app` |
| Verified in Resend dashboard | _TODO: confirm in Resend → Domains_ |
| Auth-email hook (`SUPABASE_AUTH_HOOK_SECRET`) | configured in Vercel env (see §4) — confirm whether enabled in Supabase Auth Hooks |

_TODO before Phase 0: log in to Resend, confirm `mail.disputedesk.app` is verified, capture verification state + any DKIM/SPF/DMARC notes. Add to this snapshot._

---

## 9. Required Secrets Inventory (Names + Presence Only)

This table records, for each secret used by the application, whether it is currently configured in the production Vercel project. **No values, prefixes, hashes, or fingerprints of values are recorded** (correction 1 of the v3 PRD).

Source: cross-reference of `.env.example` against the Vercel env list in §4.

| Variable | Required for | Present in Vercel prod scope? |
|---|---|---|
| `SHOPIFY_API_KEY` | Shopify OAuth | yes |
| `SHOPIFY_API_SECRET` | Shopify OAuth + HMAC | yes |
| `SHOPIFY_SCOPES` | Shopify OAuth | yes |
| `SHOPIFY_APP_URL` | Shopify config | yes |
| `SHOPIFY_CLIENT_ID` | duplicate of `SHOPIFY_API_KEY` | yes (consolidate during split) |
| `SHOPIFY_SEED_CLIENT_ID` | Seed Partners app | yes |
| `SHOPIFY_SEED_CLIENT_SECRET` | Seed Partners app | yes |
| `SHOPIFY_API_VERSION` | Shopify Admin pin | _TODO: not visible in `vercel env ls`; may be in `vercel.json`/code default_ |
| `SUPABASE_URL` | Server Supabase client | yes |
| `SUPABASE_ANON_KEY` | Server Supabase client | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server Supabase admin | yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser client | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser client | yes |
| `SUPABASE_AUTH_HOOK_SECRET` | Supabase send-email hook | yes |
| `TOKEN_ENCRYPTION_KEY_V1` | AES-256-GCM for offline tokens | yes |
| `TOKEN_ENCRYPTION_KEY` | Alias of V1 (intentional) | yes |
| `CRON_SECRET` | Vercel cron auth | yes |
| `RESEND_API_KEY` | Transactional email | yes |
| `EMAIL_FROM` | Email sender identity | _not in Vercel — code default per `.env.example`; confirm_ |
| `OPENAI_API_KEY` | Content generation | yes |
| `ANTHROPIC_API_KEY` | Content generation pass-two | yes |
| `GENERATION_MODEL` | Content gen config | yes |
| `GENERATION_ENABLED` | Content gen flag | yes |
| `GENERATION_PASS_TWO_PROVIDER` | Content gen config | yes |
| `APIFY_API_KEY` | Signal Radar (Reddit) | yes |
| `REDDIT_PROXY_URL` | Signal Radar fallback | yes |
| `PROXY_SECRET` | Signal Radar proxy auth | yes |
| `IPINFO_API_KEY` | Device-location enrichment | yes |
| `PEXELS_API_KEY` | Resources Hub image backfill | yes |
| `CAL_API_KEY` | Cal.com integration | yes |
| `EVIDENCE_LINK_SECRET` | Signed evidence short-links | yes |
| `INDEXNOW_KEY` | IndexNow SEO | yes |
| `ADMIN_SECRET` | Admin route auth | yes |
| `NEXT_PUBLIC_APP_URL` | Browser-facing URL | yes |
| `FILE_EVIDENCE_ATTACHMENTS_ENABLED` | Feature flag | yes |
| `IMAGE_AUTOPILOT_ENABLED` | Feature flag | yes |
| `MATERIAL_SPEC_STORE_UNITS_ENABLED` | Feature flag | yes |
| `SHOPIFY_BILLING_TEST` | Feature flag | yes |
| **`APP_ENV`** | **(to be added in Phase 0)** | **not set** |
| **`CRON_ENABLED`** | **(to be added in Phase 0)** | **not set** |
| **`EMAIL_SEND_ENABLED`** | **(to be added in Phase 0)** | **not set** |
| **`CRON_ENABLED_DEV_OVERRIDE`** | **(to be added in Phase 0)** | **not set** |

---

## 10. Known Production Identifiers (Public, Safe to Record)

For reference during identity-validation rule writing (`lib/env/build-identity.ts` and `lib/env/runtime-identity.ts`):

| Identifier | Value |
|---|---|
| Supabase production project ref | `sddzuglxdnkhcnjmcpbj` |
| Shopify production `client_id` | `84f40ec77c9ba18e9eabc1657d9b6af8` |
| Vercel production project ID | `prj_GM2oFF4BQM0OPw75FOHZ4SVGc27r` |
| Vercel team / org ID | `team_ZlvA7gSYnGZDargMeA8lYRai` |
| Latest prod deployment ID | `dpl_G3bHyBLoSYW7ebXdFJBXHFR7EWVz` |
| Production app URL | `https://disputedesk.app` |
| Production `EMAIL_FROM` sending subdomain | `mail.disputedesk.app` |
| Pinned Shopify Admin API version | `2026-01` |

These are non-secret identifiers (public values or operational identifiers that are not credentials). They are appropriate inputs for the identity-validation rules defined in §6.1 of the PRD.

---

## 11. Outstanding TODOs Before Phase 0 Begins

The following items in this snapshot are not yet recorded and must be filled in by the operator before declaring Phase -1 complete:

- [ ] **Section 1 (BLOCKING):** Verified restorable production backup — timestamp, ID, restoration command, scratch destination, source/restored row counts, operator sign-off.
- [ ] Section 2: Supabase region and plan tier.
- [ ] Section 2.2: Confirm all three storage buckets exist in the prod dashboard with expected settings.
- [ ] Section 6: Domain registrar (where the NS records pointing to Vercel are configured).
- [ ] Section 6: Investigate why `dev.disputedesk.app` resolves today.
- [ ] Section 8: Resend domain verification state for `mail.disputedesk.app`.
- [ ] Section 9: Confirm `SHOPIFY_API_VERSION` source (env var vs code default).
- [ ] Section 9: Confirm whether `EMAIL_FROM` is set in Vercel or only defaults from code.

Once all items above are filled in, this document is the canonical snapshot of production state at SHA `545f4114a066c4473d9898d864cb2e47e59fd5f9` and 2026-05-13. Any subsequent change to production state requires either (a) updating this snapshot in a follow-up commit, or (b) recording the change in `docs/runbooks/prod-release-log.md` once that file exists (Phase 5).
