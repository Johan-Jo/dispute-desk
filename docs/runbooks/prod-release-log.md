# Production release log

Append-only log of every production state change that isn't a normal code deploy.
Examples: Supabase project migrations, Vercel env-var bulk updates, secret rotations,
manual prod DB migrations applied via `db:push:prod`.

**Rules:**

- Append only. Never delete or edit prior entries. Corrections go in a new entry referencing the old one.
- One entry per state change. Multi-step releases (e.g. Pro migration) get a single entry with sub-bullets.
- Record timestamps in UTC, ISO 8601.
- Reference git SHAs and PR URLs where applicable.
- Never paste secrets, full connection strings, or service-role keys.
  Fingerprints (first 8 chars of non-secret identifiers) are OK.

Companion files:
- [`prod-current-state-snapshot.md`](prod-current-state-snapshot.md) — point-in-time snapshot at 2026-05-13 (frozen, never updated; this log records changes since).
- [`prod-release.md`](prod-release.md) — Phase 5 release checklist (TBD).
- [`prod-rollback.md`](prod-rollback.md) — Phase 5 rollback procedures (TBD).

---

## Entries

<!-- Append new entries at the BOTTOM. Newest entry goes after the last one, never at the top. -->

<!-- Template — copy-paste below the last entry when adding a new one.

### YYYY-MM-DDTHH:MM:SSZ — <one-line summary>

- **Operator:** <name>
- **Git SHA before:** `<7-char>`  (link to commit if useful)
- **Git SHA after:** `<7-char>`
- **PR(s):** <#123, #124>
- **What changed:**
  - <step 1>
  - <step 2>
- **Verification:**
  - <command + output / fingerprint comparison>
- **Notes / follow-ups:**
  - <anything for next release>

-->

<!-- First real entry will be the Supabase Pro migration cutover. -->

### 2026-05-26 — Dev Shopify Partners app created: DisputeDesk-Dev

- **Operator:** Johan
- **Action:** `npx shopify@3.94.3 app config link --config=dev` → "Yes, create new app" → name `DisputeDesk-Dev`, org `Veridor Works` (same org as prod `DisputeDesk`).
- **New dev `client_id`:** `bbb7c00568ffb57fecd789fa0580e309` (public identifier).
- **Prod app untouched.** No deploys ran against the prod app.
- **Initial dev scope set:** minimal (`read_customer_events`, `read_customers`, `read_fulfillments`, `read_orders`, `read_products`, `read_shipping`, `write_pixels`) — Shopify rejected the dispute-related and `read_all_orders` scopes at create time because they require per-app approval. Approval requests must be submitted in Partners → DisputeDesk-Dev → API access for: `read_all_orders`, `read_shopify_payments_disputes`, `read_shopify_payments_dispute_evidences`, `read_shopify_payments_dispute_file_uploads`, `write_shopify_payments_dispute_evidences`, `write_shopify_payments_dispute_file_uploads`.
- **CLI overwrote `shopify.app.dev.toml`** with its own canonical fields + an auto-default `api_version = "2026-07"`. Re-patched locally to restore the pinned `api_version = "2026-01"`, the `[[webhooks.subscriptions]]` blocks, the `[webhooks.privacy_compliance]` block, and `[pos] embedded = false`. Next `npm run shopify:deploy:dev` pushes those to Partners.

### 2026-05-26 — `read_all_orders` granted on DisputeDesk-Dev

- **Operator:** Johan
- **Path:** Partners → DisputeDesk-Dev → API access requests → Protected customer data access → Manage → Step 1 saved (Other reason: "Automated chargeback evidence packs: order/fulfillment data assembled to defend merchant disputes"). Then *Read all orders* request in the additional-scopes list, justification referencing prod ticket 64535407.
- **Result:** Granted immediately ("Your app can access the full order history for a store"). Self-attest path for dev apps installed on dev stores — no human review queue.
- **Code change:** added `read_all_orders` back to `shopify.app.dev.toml` `[access_scopes].scopes`. Will push to Partners via `npm run shopify:deploy:dev` once the dev Vercel project is live.
- **Outstanding:** five Shopify Payments dispute scopes (`read_shopify_payments_disputes` + four `_evidences`/`_file_uploads` read+write) — not in self-serve UI. Need a Partner Support ticket via https://partners.shopify.com/current/help referencing prod ticket 64535407. Until granted, dispute-specific flows can't be exercised on the dev app.

### 2026-05-27 — Dev environment stood up end-to-end on `dev.disputedesk.app`

- **Operator:** Johan
- **Outcome:** Dev environment serves at https://dev.disputedesk.app. `/api/health` returns `appEnv=development, supabaseRefFp=vrpkgudq, supabaseIsKnownProd=false, shopifyClientIdFp=bbb7c005, cronEnabled=false, gitSha=9786e1a`.
- **Components stood up:**
  - **Dev Supabase project** ref `vrpkgudqmpyunekrkpnc` (Free tier, separate from new Pro prod project). 71 public tables (matches prod). `_migrations` RLS migration fix applied. Three storage buckets created via migrations (`evidence-packs`, `evidence-uploads`, `policy-uploads`). Auth `site_url` = `https://dev.disputedesk.app`, `uri_allow_list` mirrors prod, Send Email hook enabled with a **fresh** `SUPABASE_AUTH_HOOK_SECRET` (never reused from prod).
  - **Dev Vercel project** `disputedesk-dev` on EstimatePro team. Production branch set to `develop` via undocumented `PATCH /v9/projects/<name>/branch` endpoint. 37 env vars on Production scope: 30 copied/transformed from prod (`dispute-desk` project), 6 sensitive vars pulled from local `.env.local`, plus a freshly-fetched `SHOPIFY_API_SECRET`. Fresh secrets generated for `TOKEN_ENCRYPTION_KEY_V1`, `CRON_SECRET`, `ADMIN_SECRET`, `EVIDENCE_LINK_SECRET` (never reused from prod). Dev-only toggles set: `CRON_ENABLED=false`, `EMAIL_SEND_ENABLED=false`.
  - **`dev.disputedesk.app` domain** attached to the dev Vercel project via API. Required TXT verification record `_vercel.disputedesk.app` → `vc-domain-verify=dev.disputedesk.app,7e5bf68a…` added on the parent domain's personal Vercel team; verification succeeded same-session.
  - **Dev Shopify Partners app** `DisputeDesk-Dev` (client_id `bbb7c00568ffb57fecd789fa0580e309`) wired into the dev Vercel project env. Initial scope set is minimal — `read_all_orders` granted via self-attest, five `shopify_payments_dispute_*` scopes still pending Partner Support ticket.
- **Outstanding:**
  - Partner Support ticket for the 5 dispute scopes — record ticket number here once Shopify provides.
  - `npm run shopify:deploy:dev` to push `[[webhooks.subscriptions]]` + `[webhooks.privacy_compliance]` blocks to Partners — defer until dispute scopes come through and TOML is repopulated.
- **Reproducibility:** `scripts/internal/populate-dev-vercel-env.mjs` captures the prod-→-dev env var classification (identity / dev-value / fresh / copy / skip), used to script the Vercel env injection.

### PLANNED — Supabase Pro migration cutover

- **Old prod ref:** `sddzuglxdnkhcnjmcpbj` (Free tier; becomes dev after cutover per `supabase-pro-migration.md` §3)
- **New prod ref:** `aokhplydttxtebvbeuzc` (Pro tier)
- **Runbook:** [`supabase-pro-migration.md`](supabase-pro-migration.md)
- **Status:** schema replay + non-schema settings in progress on the new project. Code-constant PR not yet prepared (cutover-day work).
- **Outstanding before cutover:** schema replay confirmed (`npx supabase db push`), buckets verified, Auth URL config set on new project, Vercel env vars staged but not yet swapped.
- **This stub will be replaced by the real entry at cutover time** with: timestamp, operator, verifier output, health endpoint response, sentinel-table row counts.


### 2026-07-03T15:47:05Z — manual prod db push (raw, wrapper bypassed by operator authorization)

- **Target ref:** `aokhplydttxtebvbeuzc` (prod)
- **Git SHA:** `b781bdb` (master)
- **Method:** `supabase db push --linked --include-all --yes` (db-push-prod.mjs wrapper requires a TTY; operator explicitly authorized the raw push)
- **Migrations applied (2):**
  - 20260701120000_backfill_free_lifetime_credits.sql (pre-existing pending backfill; idempotent insert-only)
  - 20260703101012_admin_passkeys.sql (admin passkey second factor)
- **Verified:** admin_passkeys present on prod (9 columns). CLI relinked back to dev (vrpkgudqmpyunekrkpnc) after push.
- **Trigger:** prod /admin enrollment failed because admin_passkeys did not exist on prod.
