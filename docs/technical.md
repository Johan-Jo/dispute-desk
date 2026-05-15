# Technical Specification — DisputeDesk

## Tech Stack

| Layer              | Technology                                         |
|--------------------|----------------------------------------------------|
| Embedded UI        | React 18 + Polaris + App Bridge React              |
| Portal / Marketing | React 18 + Tailwind CSS + custom design system     |
| Server             | Next.js 15 App Router (Node runtime)               |
| Auth (Portal)      | Supabase Auth (`@supabase/ssr`)                    |
| Auth (Embedded)    | Shopify OAuth (offline + online sessions)          |
| Database           | Supabase Postgres with RLS                         |
| Storage            | Supabase Storage (private buckets)                 |
| Email              | Resend (transactional; welcome + magic link — Supabase email disabled) |
| PDF                | @react-pdf/renderer (deterministic, no browser)    |
| Deployment         | Vercel (serverless + cron)                         |
| CI/CD              | GitHub Actions                                     |

## Shopify API

### Scopes

**Source of truth:** `shopify.app.toml` `[access_scopes].scopes`. `.env.example`
mirrors the same list as `SHOPIFY_SCOPES`, and `lib/shopify/auth.ts`
`buildAuthUrl` reads that env var verbatim — there is no hard-coded fallback,
and a missing env throws at boot. A vitest in `tests/unit/shopifyScopes.test.ts`
parses both files and fails the suite if the two ever diverge. This guards
against the install-time 400/redirect-loop that results from OAuth requesting
a scope set different from what managed install grants.

Current 19 scopes (reflected in both TOML and `.env.example`):

```
read_orders, write_orders, read_customers, read_products, write_products,
read_fulfillments, read_shipping, read_shopify_payments_disputes,
read_shopify_payments_dispute_evidences, write_shopify_payments_dispute_evidences,
read_shopify_payments_dispute_file_uploads, write_shopify_payments_dispute_file_uploads,
read_files, write_files, write_draft_orders, write_fulfillments,
write_merchant_managed_fulfillment_orders, read_locations, read_inventory,
write_inventory
```

`read_shopify_payments_dispute_file_uploads` and `write_shopify_payments_dispute_file_uploads` are required for REST `POST …/dispute_file_uploads.json` and for attaching uploads via GraphQL `disputeEvidenceUpdate` file fields (`scripts/test-dispute-file-upload.ts`). Merchants must re-approve the app after these scopes are added.

The `write_*` scopes (`write_orders`, `write_products`, `write_inventory`,
`write_draft_orders`, `write_fulfillments`, `write_merchant_managed_fulfillment_orders`)
are also used by the test-store seed script (`scripts/shopify/seed-teststore.mjs`).

The seed script first creates products (GraphQL `productCreate`, then
`inventorySetQuantities` so variants are in stock), then creates orders
via the REST `POST /orders.json` endpoint (requires `write_orders`)
instead of DraftOrder GraphQL mutations to avoid the
protected-customer-data restriction on the DraftOrder object. The app must
also have **Protected Customer Data** access declared in the Partner
Dashboard (API access requests section). See `scripts/shopify/README.md`.

### API Version

Pinned to `2026-01` via `SHOPIFY_API_VERSION` env var. Default in code
if env var is unset. All queries go through `requestShopifyGraphQL()`.

### Permissions Note

**Saving evidence** (`disputeEvidenceUpdate`) requires the merchant user
to have the Shopify admin permission **"Manage orders information"** in
their staff account. This is NOT an OAuth scope — it is a Shopify Admin
permission.

**Troubleshooting "Access denied" errors on save:**
1. Verify the user has "Manage orders information" permission in Shopify Admin → Settings → Plan and permissions.
2. Ensure the app has `write_shopify_payments_dispute_evidences` scope.
3. Ensure the user is authenticated with an online session (not offline).

### GraphQL Throttle Handling

`lib/shopify/graphql.ts` wraps all calls with:
- Retry on HTTP 429, 5xx, and `THROTTLED` error extension.
- Exponential backoff with jitter (base 1s, up to 3 retries).
- Reads `extensions.cost.throttleStatus` when available.
- Never logs access tokens; includes correlation ID.

## Authentication

### Session Types

| Type    | Use Case                            | Token Lifetime |
|---------|-------------------------------------|----------------|
| Offline | Background sync, job execution, reads | Permanent      |
| Online  | Save evidence (user-context mutation) | Short-lived    |

Both stored in `shop_sessions` with encrypted access tokens (AES-256-GCM)
and key versioning for rotation.

### Session Token Exchange (iOS mobile app, managed install)

The Shopify iOS mobile app (WKWebView) and modern Managed Installation do
**not** use the traditional `/admin/oauth/authorize` redirect — WKWebView
can't complete the redirect out of the embedded context, and managed
install considers scopes already granted. Shopify instead hands the app a
**Shopify session token** (`id_token` query param) on every embedded load:
an HS256 JWT signed with the app's client secret, with `dest` naming the
shop and `aud` equal to our client_id.

Flow on first load (`/app?id_token=…&shop=…&host=…&embedded=1`):

1. `middleware.ts` — no `shopify_shop` cookie but `id_token` is present
   and looks well-formed → 307 to `/api/auth/shopify/token-exchange` with
   `id_token`, `shop`, `host`, and `return_to` preserved. (Format check
   only; edge runtime has no `crypto.createHmac` for the full verify.)
2. `app/api/auth/shopify/token-exchange/route.ts` —
   `verifySessionToken` (`lib/shopify/sessionToken.ts`) cryptographically
   validates the JWT (HS256 HMAC, `aud`, `exp`/`nbf`, `dest` is a
   `.myshopify.com` URL). On success, upserts the `shops` row and looks
   up any existing offline session.
3. If no offline session exists, `POST https://<shop>/admin/oauth/access_token`
   with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`,
   `subject_token=<id_token>`,
   `subject_token_type=urn:ietf:params:oauth:token-type:id_token`,
   `requested_token_type=urn:shopify:params:oauth:token-type:offline-access-token`.
   Store the returned access token + scopes in `shop_sessions` (same
   `storeSession` path the legacy callback uses). Dispute webhooks are
   registered out-of-band.
4. 307 back to the original `return_to` (default `/app`) with
   `shopify_shop` + `shopify_shop_id` cookies set (SameSite=None, Secure,
   Partitioned). Middleware then sees the cookie and passes the request
   through normally.

Failure on any step renders a small inline error HTML (401) instead of
redirecting to `/app` — prevents a tight loop in mobile WebViews that
would otherwise re-trigger the id_token branch on every retry.

`lib/shopify/sessionToken.ts` exposes `verifySessionToken(token)` for
use in API routes, and `looksLikeSessionToken(token)` for the edge
middleware's crypto-free format check (also inlined in `middleware.ts`
since edge can't import modules that pull in `crypto`). Unit-tested in
`tests/unit/sessionToken.test.ts` (bad signature, wrong aud,
expired/not-yet-valid, non-myshopify dest, malformed, missing secret).

The legacy `/api/auth/shopify` OAuth flow remains as a fallback for any
client that does not send an `id_token` (e.g. direct desktop re-auth
after uninstall) — priority in middleware is id_token → grace marker →
legacy OAuth.

### Embedded session cookies

After Shopify OAuth, the callback sets `shopify_shop` and `shopify_shop_id`
as HTTP-only, secure cookies with **`sameSite: "none"` and `partitioned: true`**.
Both attributes are required so the browser sends them when the app is loaded
inside Shopify Admin’s iframe (cross-origin). Chrome's CHIPS restrictions
require `Partitioned` for third-party cookies to be readable from within an
embedded iframe context; without it, the iframe reload that follows
`window.top.location.href` after install sees no cookie and the `/app/*`
middleware bounces the request back through OAuth, rendering a white screen.

**Post-callback grace marker.** The callback additionally sets a short-lived
(~60s) `dd_oauth_in_progress` cookie with the same partitioned attributes.
When the Admin iframe reloads the app at `/app?shop=…&host=…&embedded=1`,
`middleware.ts` checks for this marker: if present alongside `shop` and
`host` query params, it lets the request through once (deleting the marker
as a single-use ticket) even when the `shopify_shop` cookie hasn't yet
committed in the new frame context. This closes a narrow race where Set-Cookie
headers from the callback have not yet landed when Shopify Admin loads the
next frame. All other middleware guards (HMAC, stale-cookie shop-mismatch,
session-exists readback) remain unchanged.

**Stale-cookie guard (multi-store):** These cookies are scoped to the
DisputeDesk host, not per-shop, so opening two different Shopify Admin tabs
(store A, then store B) in the same browser would otherwise let store B
read store A's cookie pair and receive store A's disputes. The `/app/*`
middleware branch compares the `shopify_shop` cookie against the `?shop=`
query param Shopify sends on every Admin iframe load; on mismatch it clears
both cookies and redirects to `/api/auth/shopify?shop=<param>` to restart
OAuth for the correct shop. The `/api/*` branch applies the same check and
returns `401 { code: "SHOP_MISMATCH" }` if they disagree — the client should
reload `/app` to trigger re-auth. Comparison is case-insensitive. The
predicate lives in `lib/middleware/shopMatch.ts` (unit-tested). Practical
trade-off: merchants who alternate between stores in the same browser see a
brief re-auth roundtrip on switch — correctness is preferred over a silent
cross-tenant leak.

**OAuth callback CSP:** The callback at `/api/auth/shopify/callback` loads
inside the Shopify Admin iframe and returns an HTML page that uses
`window.top.location.href = ...` to break out into the embedded app URL. For
that breakout script to execute the response must be allowed to render in
the iframe — so `next.config.js` applies `frame-ancestors
https://*.myshopify.com https://admin.shopify.com` to
`/api/auth/shopify/:path*` (covers both the OAuth start and the callback).
Without this the default `frame-ancestors 'none'` would blank the iframe
and the merchant would see a broken-file icon in Admin.

### Encryption Key Rotation

- Keys named `TOKEN_ENCRYPTION_KEY_V1`, `TOKEN_ENCRYPTION_KEY_V2`, etc.
- `encrypt()` always uses the highest-numbered key.
- `decrypt()` reads `keyVersion` from stored payload and selects the right key.
- `TOKEN_ENCRYPTION_KEY` env var is a backward-compat alias for V1.

## Supabase Access Model

**Server-only for data access.** All data queries use `getServiceClient()`
with the service role key. Shop isolation is enforced by verifying the
Shopify session (embedded) or `portal_user_shops` link (portal), then
scoping all queries to `shop_id`.

The **anon key** is exposed as `NEXT_PUBLIC_SUPABASE_ANON_KEY` and used
**only** for Supabase Auth in the portal (sign-in, sign-up, password reset).
It never accesses application data tables.

RLS is enabled on all tables as defense-in-depth. Service-role policies are
scoped to `to service_role` (migration `20260515120000_p0_security_lockdown.sql`)
so a stray anon-key call cannot satisfy a `true` policy. If a request somehow
bypasses application code, RLS prevents cross-shop data leakage.

The same migration also pins `search_path` on the eight functions flagged by
`supabase db advisors` (`set_updated_at`, `submission_logs_set_updated_at`,
`dispute_qualifications_set_updated_at`, `reject_dispute_event_mutation`,
`reject_audit_mutation`, `shopify_orders_lock_initial_risk`,
`ensure_shop_settings`, `claim_jobs`) and revokes `EXECUTE` on the two
`SECURITY DEFINER` admin RPCs (`dd_admin_resolve_user_id_by_email`,
`dd_admin_touch_last_login`) from `anon` and `authenticated` — they are only
ever called from server-side code via `getServiceClient()`.

Pre-launch advisor run (after the P0 migration): WARN findings are zero on
`rls_policy_always_true`, `function_search_path_mutable`,
`anon_security_definer_function_executable`,
`authenticated_security_definer_function_executable`, and
`multiple_permissive_policies`. Remaining items (`auth_rls_initplan` on
`portal_user_*`, 13 unindexed FKs, 32 unused indexes, plus the
HaveIBeenPwned password toggle) are tracked as P1/P2 hygiene.

## Email (Resend)

All transactional email is sent via **Resend** using branded table-based HTML templates (indigo header, CTA button, footer) with plain-text fallbacks. Supabase's built-in email is **not used** — every auth email goes through our own routes. All six app locales are supported (`en-US`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, `sv-SE`); locale is resolved from the `dd_locale` cookie, then `Accept-Language` header, then `en-US`. The same resolution drives **on-screen copy** for `/auth/*` (sign-in, sign-up, password reset, magic-link, set new password): `app/(auth)/layout.tsx` + `messages/*/auth.*` (see **Portal Auth** in API Surface).

- **Env:** `RESEND_API_KEY` (required for sending). `EMAIL_FROM` defaults to
  `DisputeDesk <notifications@mail.disputedesk.app>` (sending subdomain). The
  domain must be verified in Resend. `EMAIL_REPLY_TO` sets Reply-To (defaults
  to same as FROM). `ADMIN_NOTIFY_EMAIL` overrides the admin notification
  recipient (default: `oi@johan.com.br`). **Resources Hub autopilot** publish
  notifications (`lib/email/sendPublishNotification.ts`) use the same env vars.
- **Deliverability:** Set `NEXT_PUBLIC_APP_URL=https://disputedesk.app` so all
  email links point to production (never localhost). Add DMARC. Keep
  `EMAIL_FROM`/`EMAIL_REPLY_TO` on the `mail.disputedesk.app` subdomain.
- **Templates:** `lib/email/templates.ts` — all locale-aware HTML/text generators:
  - `generateWelcomeEmailHTML/Text` + `getWelcomeSubject` — post-signup welcome
  - `generateMagicLinkEmailHTML/Text` + `getMagicLinkSubject` — sign-in magic link
- **Send helpers:**
  - `lib/email/sendWelcome.ts` — branded welcome email; accepts `locale?: Locale`.
  - `lib/email/sendMagicLink.ts` — branded magic link email; accepts `locale?: Locale`.
  - `lib/email/sendAdminNotification.ts` — plain admin alert to `ADMIN_NOTIFY_EMAIL` on every confirmed sign-up.
  - `lib/email/sendPackSavedAlert.ts` — "Evidence saved" confirmation with locale-aware "Submit now in Shopify Admin" CTA. Includes an auto-submit note explaining Shopify will submit on the deadline if the merchant doesn't act, plus the dispute due date (rendered as `<dueLabel>: Mon DD, YYYY` inside the blue info box and in the plain-text body) when `disputes.due_at` is present — so the merchant immediately sees how long they have to submit manually. Fired after `save_to_shopify` job completes (fire-and-forget). Gated by `evidenceReady` notification preference.
  - `lib/email/sendNewDisputeAlert.ts` — "New dispute" alert when a dispute is **first synced** (deduped with `disputes.new_dispute_alert_sent_at`). Variant is chosen by `resolvedMode` (`auto` vs `review`) after `evaluateRules` in `syncDisputes`. **Review + automated build:** the "your response is ready" copy is **not** sent at sync time; `syncDisputes` runs `runAutomationPipeline` first, and when it enqueues `build_pack`, the email is deferred to `claimAndSendDeferredNewDisputeReviewAlert` in `evaluateAndMaybeAutoSave` (after evidence is collected and the pack is parked for review). If the pipeline does not enqueue a build (e.g. quota, auto-build off), the email is still sent from sync as before. Gated by `team.payload.notifications.newDispute` in `shop_setup`. **Auto (English):** primary CTA opens the embedded app dispute; optional secondary CTA opens Shopify Admin at `https://admin.shopify.com/store/{handle}/payments/dispute_evidences/{numericId}` — `handle` comes from `shops.shop_domain` (`.myshopify.com` stripped) and `numericId` from `shopifyDisputeEvidenceGid` (the Shopify `DisputeEvidence` GID from the sync payload). The callout explains Shopify forwards the response to the card network on the response due date; if domain or GID is missing, only the primary button is shown. The two buttons use a **single table row, two cells** so they render side by side in common clients. **Review:** single CTA to open the dispute in the app. Non-English locales currently use one primary CTA until secondary labels and related copy are translated.
- **Email trigger points:**
  1. **Welcome — email/password sign-up:** the Send Email hook emails a link to `GET /api/auth/confirm?token_hash=…&type=signup&redirect=…` (and optional `locale`). The confirm route calls `verifyOtp` with `token_hash` (no PKCE). On `type=signup` it sends welcome + admin notification server-side, then redirects. Legacy: `?code=…` still uses PKCE `exchangeCodeForSession` when the link came from Supabase-hosted verify.
  2. **Welcome — Shopify OAuth new user:** `GET /api/auth/shopify/callback` calls `sendWelcomeEmail` + `sendAdminSignupNotification` after creating the Supabase user.
  3. **Welcome — Shopify OAuth first store (signed-in):** callback sends welcome + admin notification on the first `portal_user_shops` row only.
  4. **Magic link sign-in:** `POST /api/auth/magic-link` calls `admin.generateLink` server-side (redirect URL from `NEXT_PUBLIC_APP_URL`, never client origin) then sends our branded magic-link email via Resend. The sign-in page calls this route — Supabase's own OTP email is never triggered.
  5. **New dispute (first sync):** `lib/disputes/syncDisputes.ts` claims the email send with `new_dispute_alert_sent_at` and calls `sendNewDisputeAlert`, or defers the review-ready variant until the pack build completes (see helper above).
- **Idempotency keys** prevent duplicate welcome sends: `welcome-confirm/{email}` (email flow), `welcome-shopify/{userId}` (Shopify flow), `welcome/{userId}` (signed-in connect).

## Cal.com (demo booking)

The `/contact` page integrates Cal.com scheduling via **`@calcom/embed-react`** (profile `disputedesk`). Both the hero "Book Demo" button and the Demo card in the "How to reach us" section open a Cal.com modal where visitors choose between 15min and 30min meetings. CSP allows `app.cal.com` for `script-src`, `frame-src`, and `connect-src` on marketing routes (`next.config.js`).

- **Env:** `CAL_API_KEY` — Cal.com API key (server-only, available for future API calls such as webhook verification or booking queries). The client-side embed uses the public event slug and does not require the API key.

## Resources Hub (public marketing)

The **Resources Hub** is the localized **marketing / SEO** surface for long-form content (articles, templates, case studies, glossary, blog). It is **not** part of the embedded Shopify app.

### Surfaces

| Area | Routes | Notes |
|------|--------|--------|
| Public hub | `/resources`, `/templates`, `/case-studies`, `/glossary`, `/blog` and locale-prefixed variants (`/sv/resources`, …) | `app/[locale]/*`, next-intl |
| Privacy | `/privacy`, `/{pathLocale}/privacy` (e.g. `/de/privacy`) | `app/[locale]/privacy/page.tsx`; copy under `messages/*/consent.*` |
| Contact | `/contact`, `/{pathLocale}/contact` | `app/[locale]/contact/page.tsx` + `components/marketing/ContactPageClient.tsx`; chat-first routing page — "Open chat" triggers the global Tawk widget, "Book Demo" (hero + Demo card) opens Cal.com modal via `@calcom/embed-react` (profile `disputedesk`), email fallback form. Copy under `messages/*/contact.*` |
| Hub UI shell | `components/resources/ResourcesHubShell.tsx` | Shared horizontal layout with the marketing header via `MARKETING_PAGE_CONTAINER_CLASS` in `lib/marketing/pageContainer.ts` |
| Hub filter bar | `components/resources/ResourcesFilterBar.tsx` | Client component: content-type filters with icons, **More Filters** for additional types, language picker, clear filters — embedded in `ResourcesHubShell`. |
| Public article chrome | `components/resources/ArticleStickyBar.tsx` | Sticky bar on article pages: back to resources, share (native share or copy link). |
| Admin | `/admin/resources/*` | Dashboard, content list, calendar, queue, backlog, settings. Figma-based redesign (CH-2+). |
| In-app help (embedded) | `/app/help`, `/app/help/[slug]` | Separate copy from `lib/help/embedded` — **not** the CMS hub |

### Marketing home: Resources Hub article strip

Between the **Pricing** section and the **ROI Snapshot**, the marketing home page renders 3 published hub articles for the current locale.

- **Component:** [`components/marketing/MarketingHubArticles.tsx`](components/marketing/MarketingHubArticles.tsx) — server component. Renders an image-top 3-col grid (`md:grid-cols-2 lg:grid-cols-3`) using `ResourceCardImage` (`variant: "default"`) plus the hub `contentTypeBadgeClass` so cards match the rest of the hub visually.
- **English (`en-US`):** Two slugs are hand-pinned in display order via `EN_PINNED_SLUGS` (`understanding-chargeback-software-pricing-models`, `compare-chargeback-vendors-beyond-win-rate`). The 3rd slot is filled from the top published pillar page. If either pin becomes unpublished, the slot is backfilled from the same pillar-page pool, so the strip always has 3 cards or hides cleanly.
- **Non-English locales:** Falls back to `listPublishedByRoute("resources", hubLocale, { contentType: "pillar_page", limit: 3 })` ordered by `publish_priority DESC, publish_at DESC` (same ordering as the hub listing). The pinned slugs are English-only and not surfaced under `/de`, `/es`, `/fr`, `/pt`, `/sv` unless they get localized in the CMS.
- **Slot pattern:** Passed as `hubArticles` ReactNode prop into [`components/marketing/MarketingLandingPageClient.tsx`](components/marketing/MarketingLandingPageClient.tsx) (a `"use client"` component); the slot keeps the Supabase service client server-only. The page wires it up in [`app/[locale]/page.tsx`](app/[locale]/page.tsx).
- **Empty-state behavior:** Returns `null` when fewer than 3 cards can be assembled — no broken partial row.
- **Routing:** Card hrefs use `${base}/resources/${primary_pillar}/${slug}` so locale-prefixed paths (`/de/resources/...`) work without code changes. The section header "View all articles" link points to `${base}/resources`.
- **i18n:** Copy lives under `marketing.fromHub.{eyebrow,title,subtitle,viewAll,readMore}` in all 6 locales (BCP-47 + short-form variants). Per-card metadata (content-type label, read-time) reuses keys from the `resources` namespace (`types.*`, `readTime`).

### Marketing: privacy, cookie consent, and analytics

- **Privacy page:** Static, localized content (title, cookie/analytics disclosure, contact). Middleware routes `/privacy` through next-intl the same way as `/` and hub paths (`middleware.ts`).
- **Cookie banner:** `components/consent/cookie-consent-bar.tsx` is rendered from `app/[locale]/layout.tsx` (marketing locale shell). User choice is stored as **`dd_cookie_consent`** in both `localStorage` and a first-party cookie (`lib/consent/constants.ts`): **`v1:analytics`** (allow GA) or **`v1:essential`** (essential only). Helpers: `readStoredConsent` / `persistConsent` in `lib/consent/client.ts`; `grantAnalyticsConsentViaGtag()` updates Google Consent Mode when analytics is accepted.
- **Google Analytics 4:** Optional **`NEXT_PUBLIC_GA_ID`** (see `.env.example`). If unset or whitespace-only, the app uses measurement ID **`G-MN5KDFQMMX`** (`app/layout.tsx`). Setting the same value explicitly in **Vercel** is optional but makes production config obvious. Root layout injects **`gtagConsentBootstrapScript`** (`lib/consent/ga-bootstrap.ts`) with `strategy="beforeInteractive"` — Consent Mode v2 defaults deny `analytics_storage` until a prior choice is read from storage/cookie or the user accepts; the `gtag/js` loader uses `afterInteractive`. Marketing requests do not load App Bridge (`x-dd-load-app-bridge` is set only for `/app/*`).
- **CSP and GA:** `next.config.js` **Content-Security-Policy** must allow Google Tag / GA4 endpoints or the browser will block the loader and collect requests. Shared allowlists are **`GA_SCRIPT_SRC`** (`https://www.googletagmanager.com` for `script-src`) and **`GA_CONNECT_SRC`** (Google Analytics / Tag Manager hosts for `connect-src`). When adding new CSP `source` rules (e.g. new locales), copy the same GA entries so all routes that load the root layout can run gtag.
- **Language switcher and route kinds:** `isMarketingIntlRoute()` in `lib/i18n/marketingRoutes.ts` is true for `/`, `/privacy`, locale-prefixed paths, and hub first segments (`resources`, `templates`, `case-studies`, `glossary`, `blog`). In `components/ui/language-switcher.tsx`, marketing routes use next-intl navigation after setting `dd_locale`; on **non**-marketing paths (`/portal`, `/app`, `/auth`, `/api`, …) the switcher only updates the cookie and calls `router.refresh()` so locale changes without wrong path rewriting. Unit tests: `tests/unit/marketingRoutes.test.ts`.

### Shopify App Store link (marketing CTA)

- **Code:** [`lib/marketing/shopifyInstallUrl.ts`](lib/marketing/shopifyInstallUrl.ts) — `getMarketingShopifyAppInstallUrl()` reads **`NEXT_PUBLIC_SHOPIFY_APP_STORE_URL`**. When set, Resources article CTAs (e.g. [`app/[locale]/resources/[pillar]/[slug]/page.tsx`](app/[locale]/resources/[pillar]/[slug]/page.tsx)) use that URL for the primary button.
- **When unset:** the same button links to **`{getPublicSiteBaseUrl()}/auth/sign-up`** with UTM params (`marketing` / `install_cta` / `app_store_fallback`) so merchants never hit a missing `https://apps.shopify.com/...` page (typical before App Store approval). Do **not** guess the listing handle; it may differ from `shopify.app.toml` `name`.
- **Production / Vercel:** After the app is published, set **`NEXT_PUBLIC_SHOPIFY_APP_STORE_URL`** in the Vercel project (Production and Preview if needed) to the URL shown in **Shopify Partners → App → Distribution**, then redeploy so the marketing site picks it up.
- **Optional check:** `npm run verify:app-store-url` — HTTP GET the env URL; exits 0 if unset, 0 if 2xx, 1 if the listing returns an error (run before releases once a listing exists).
- **Submission:** Pre-review checklist (Partners, PCD, dev store walkthrough) — [`docs/shopify-app-review-checklist.md`](shopify-app-review-checklist.md).

### Embedded app guard

Merchants must not browse the public hub **inside** Shopify Admin’s iframe. When a hub path is requested with the App Bridge **`host`** query parameter, `middleware.ts` **redirects to `/app/help`** and preserves `shop`, `host`, `locale`, and other params. Path matching lives in `lib/middleware/marketingHubPaths.ts` (see `tests/unit/marketingHubPaths.test.ts`).

### Content model and publishing

- **DB:** `content_items`, `content_localizations`, `content_publish_queue`, archive tables — migration `030_resources_hub.sql`. Planning columns (`topic`, `target_keyword`, `search_intent`, `priority`) added in `031_content_items_planning_columns.sql`. Hub locale `pt-PT` → `pt-BR` alignment: `20260328144057_hub_locale_pt_br.sql`. Archive generation metadata: `content_archive_items.page_role`, `complexity`, `target_word_range` — `033_archive_brief_generation_fields.sql`. **Hub content types:** `checklist` added to `content_items.content_type` CHECK — migration `20260330123000_content_type_checklist.sql`. **Backlog ordering:** `content_archive_items.backlog_rank` (integer, lower value = earlier in the editorial queue) — migration `20260330180000_content_archive_backlog_rank.sql` (backfilled from existing `priority_score` + `created_at`). **Article language (editorial):** `content_items.source_locale` — hub locale in which the piece is considered authored; migration `20260329213000_content_items_source_locale.sql` (CHECK + index + backfill from longest complete `body_json` per item).
- **Publish queue uniqueness:** `content_publish_queue.content_localization_id` is **unique** (one queue row per localization) — migration `20260330200000_content_publish_queue_localization_unique.sql` dedupes legacy duplicates then adds `uq_content_publish_queue_content_localization_id`. Required for PostgREST **upsert** `onConflict: "content_localization_id"` in `publishContentItemThroughQueue` and editor schedule (`app/api/admin/resources/content/[id]`).
- **Workflow:** `lib/resources/workflow.ts` — 11-status state machine with validated transitions (`idea` → `backlog` → … → `published` → `archived`). Display helpers for status/type/priority badges and locale flags.
- **Admin queries:** `lib/resources/admin-queries.ts` — stats, scheduled posts, translation gaps, content list (paginated + filterable by status, type, topic, **`source_locale` / article language**), queue items, backlog, editor detail, workflow transitions, CMS settings. `getContentList({ locale })` filters `content_items.source_locale` when `locale` is set (not `"all"`); nested `content_localizations` is a normal left embed for the **Locales** column.
- **Admin components:** `components/admin/resources/` — `WorkflowStatusBadge`, `ContentTypeBadge`, `PriorityBadge`, `LocaleStatusIndicator`, `LocaleCompletenessBadge`, `ValidationChecklist`, `SchedulePicker`.
- **Admin shell:** `app/admin/layout.tsx` — under `/admin/resources/*`, the left sidebar shows Resources Hub sub-navigation (Dashboard, Content List, Calendar, Queue, Backlog, Settings, **Help** → `/admin/help`). Elsewhere (including **`/admin/help`**), the sidebar shows top-level Admin nav (Resources, Shops, Jobs, Audit Log, Billing, Help) so the guide is not nested under Resources Hub (avoids duplicate labels like “Dashboard”). Top bar, mobile responsive.
- **Admin dashboard:** `app/admin/resources/page.tsx` + `dashboard-client.tsx` — 4 KPI cards, upcoming scheduled, translation gaps, queue health, recently edited table.
- **Admin content list:** `app/admin/resources/list/page.tsx` + `list-client.tsx` — status tabs with counts, search + filters (**content type**, **topic**, **article language**; default **English** / `en-US` filters `source_locale`), multi-select with bulk actions, locale indicators, pagination. Title column prefers the localization matching `source_locale`, then `en-US`, then any.
- **Admin API (list):** `GET /api/admin/resources/content?...&locale=...` — **`locale`** filters **`content_items.source_locale`** (article language), not “has a localization row.” Omit or `all` = no filter. Invalid values return **400**.
- **Admin API (editor):** `GET/PUT /api/admin/resources/content/[id]` — load/save full content item (including **`source_locale`** on `item`), per-locale data, workflow transitions, schedule.
- **Block editor:** `app/admin/resources/content/[id]/editor-client.tsx` — custom block editor with 13 block types (html, paragraph, heading, list, callout, code, quote, divider, image, key-takeaways, faq, disclaimer, update-log). Blocks reorderable, add/remove. Locale tabs with completeness badges.
- **Body adapter:** `lib/resources/body-adapter.ts` — bidirectional `bodyJsonToBlocks` / `blocksToBodyJson` converting legacy `{mainHtml, keyTakeaways, faq, disclaimer, updateLog}` ↔ `EditorBlock[]`.
- **Block renderer:** `components/admin/editor/BlockRenderer.tsx` — per-type inline editors for all 13 block types with type indicators and drag controls.
- **Backlog page:** `app/admin/resources/backlog/` — ideas pipeline with 4 KPI cards, search (title + target keyword) and filters (priority tier, status). Table: row index with hover **up/down** controls that **reorder rows in local React state only** (not persisted to `backlog_rank`); **Title** (`proposed_title` with optional `notes` line), type, keyword, intent, priority, status. Row actions: **Generate** (editorial pipeline → `drafting` / legal review → editor) and **Auto Pilot** (`POST /api/admin/resources/generate-autopilot` — same autopilot pipeline as cron/manual tick for **that** archive row: `workflow_status` **scheduled**, publish queue + in-request publish for those locales only; requires **AI Autopilot** enabled in CMS settings). **Add Idea** header button is present for future wiring; persisting queue order, bulk clear, and new rows use the **admin API** below (`POST` / `DELETE` / `POST …/reorder`) or **`npm run import:backlog`** (`scripts/import-content-backlog.mjs`). **`getBacklogItems`**, archive reorder routes, and **autopilot** use `backlog_rank` from the database. If the `backlog_rank` migration is missing, archive mutate routes return a clear error via `lib/resources/isBacklogRankUnavailableError.ts`.
- **Calendar page:** `app/admin/resources/calendar/` — agenda view (posts grouped by date), calendar grid view (7-col Mon–Sun with dot indicators), month navigation, queue health panel.
- **Queue page:** `app/admin/resources/queue/` — 4 status stat cards, filter tabs (all/pending/processing/succeeded/failed), card-based item list with error display, retry actions, system status panel.
- **Settings page:** `app/admin/resources/settings/` — publishing (time, weekend, auto-save), translation (skip incomplete, locale priority), workflow (reviewer, archive threshold, CTA), legal (disclaimer, review email), AI autopilot, and **Run scheduled tasks now** (manual autopilot + publish-queue triggers). Manual autopilot uses **Articles this run** (1–50, default **1**) → query `limit` on `POST /api/admin/resources/cron/autopilot` so one HTTP request does not run many full multi-locale generations (avoids **504** timeouts). Auto-saves via debounced PUT to `/api/admin/resources/settings`. **PUT body allowlist:** only known CMS keys are persisted (see `ALLOWED_CMS_KEYS` in `app/api/admin/resources/settings/route.ts`); unknown keys are stripped so arbitrary JSON cannot overwrite the singleton row.
- **Mobile editor:** Responsive editor with Content/Metadata/Checklist tab bar, locale picker bottom sheet, fixed bottom action bar (Save/Schedule/Publish).
- **Toast system:** `components/admin/Toast.tsx` — `ToastProvider` + `useToast()` hook for success/error/info notifications across admin.
- **Publish queue:** `lib/resources/cron/publishQueueTick.ts` — `executePublishQueueTick()` claims due rows in **FIFO** order with a **two-phase** pattern: `SELECT id` for pending rows with `scheduled_for <= now()` ordered by `scheduled_for`, then `UPDATE … WHERE id IN (…)` to set `processing` and return row payloads. (Chaining `.order('scheduled_for')` on the same Supabase/PostgREST **update** builder produced a misleading `column … scheduled_for does not exist` error; splitting read vs write avoids that.) Then `publishLocalization` per row, then post-publish hooks (Resend notify, IndexNow). **Stale recovery:** rows stuck in `processing` longer than ~10 minutes are reset to `pending` so a crashed worker does not block the queue forever. Vercel cron `GET`/`POST` `/api/cron/publish-content` invokes the same tick.
- **Publish (`publishLocalization`):** `lib/resources/publish.ts` — validates pillar, fields, tags; updates localization + content item; returns `{ ok: false }` if any required Supabase write fails (so the queue does not mark success on partial failure).
- **Queries (public):** `lib/resources/queries.ts` — `listPublishedByRoute` applies `search` in the Supabase query (title/excerpt/slug `ilike`) **before** `range`, so hub search is not limited to the first page of results. Hub pagination uses `?page=` with offsets from `lib/resources/hubPagination.ts` (featured strip + 10-card grid on unfiltered page 1). Optional **`includeTotal: false`** skips the parallel count (used by templates/glossary/case-studies/pillar listing pages). Locale mapping: `lib/resources/localeMap.ts`.
- **Resources hub index UI:** `components/resources/ResourcesHubShell.tsx` — `MarketingSiteHeader`, then a **hero** that matches the **Figma Make marketing home** treatment: CSS variables `--dd-hero-bg-*`, `--dd-hero-blob-*`, and `--dd-hero-gradient-*` in `app/globals.css` (same gradient + animated blobs as `MarketingLandingPageClient`), gradient headline, pill **search** (white field + primary blue submit). Sticky topic row, featured row, latest grid, pagination, bottom CTA stripe. **Footer:** `components/marketing/MarketingSiteFooter.tsx` — shared with the locale marketing home; receives **`base`** (`""` for default English, `"/de"` etc.) so `#pricing` / `#how-it-works` and `/privacy` resolve to the correct locale when the user is on `/resources`. Body/card accents: `lib/marketing/resourcesHubTokens.ts` (`RESOURCES_HUB`, e.g. `limeAccent` for featured badges, `actionBlue` **#1D4ED8** for links and primary actions).
- **Backlog list:** `getBacklogItems` excludes `content_archive_items.status = 'converted'` and orders by **`backlog_rank` ascending**, then **`priority_score` descending**.

### Code-first hub articles (multi-locale seed + HTML)

Use this pattern when shipping **approved master copy** in all hub locales without authoring the initial payload only in the admin UI (e.g. long comparison pages with fixed pricing tables, competitor lists, or compliance-sensitive wording that must match across languages).

| Step | What to do |
|------|------------|
| **1. Folder** | Create `scripts/hub-content/<stable-slug>/` with one fragment per hub locale: `main-en-US.html`, `main-de-DE.html`, `main-fr-FR.html`, `main-es-ES.html`, `main-pt-BR.html`, `main-sv-SE.html`. Each file is an HTML fragment (paragraphs, headings, lists, tables). Public rendering injects `mainHtml` via `dangerouslySetInnerHTML` — **not** Markdown. |
| **2. `article.mjs`** | In the same folder, export `TOP_CHARGEBACK_META`-style **per-locale** fields: `title` (on-page H1), `excerpt`, `metaTitle`, `metaDescription` (SEO). Export a factory such as `getXxxArticleEntry()` returning a single **`ARTICLES[]` entry**: `{ slug, pillar, type: content_type, readingTime, tags, content: { "en-US": { title, excerpt, body: { mainHtml }, metaTitle?, metaDescription? }, … } }`. Load each `main-*.html` with `readFileSync` (see `scripts/hub-content/top-chargeback-management-tools-shopify-merchants/article.mjs`). |
| **3. Seed** | In `scripts/seed-resources-hub.mjs`, import the factory, call it once (e.g. `const MY_ARTICLE = getXxxArticleEntry()`), and **push the object into the `ARTICLES` array**. The insert loop honors optional **`metaTitle`** / **`metaDescription`** per locale; if omitted, behavior is unchanged (`meta_title` = `` `${title} \| DisputeDesk` ``, description from excerpt). |
| **4. Idempotent sync (optional)** | For **replacing** an existing published article (e.g. legacy slug → new slug) without `--force` full reseed, follow **`syncTopChargebackManagementToolsArticle`**: query `content_localizations` by `route_kind = resources` and slug(s), `upsert` all six locales on `content_item_id,locale`, update `content_items` + tags. Run the sync at the end of `main()` so every `node scripts/seed-resources-hub.mjs` run applies CMS updates when `SUPABASE_*` credentials are present. |
| **5. Apply** | `npm run seed:resources` or `node scripts/seed-resources-hub.mjs` (requires `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`). |

**Editorial rules for agents:** English is the master; other locales are faithful translations with **unchanged** product names, USD amounts, and numeric table cells where the brief requires it. Do **not** add citations or fake internal `<a href>` to other DisputeDesk articles in body HTML (related navigation is UI-only; see *AI generation prompt rule* above). Prefer one folder per article slug so future updates stay localized and reviewable in git.

**Reference implementation:** `scripts/hub-content/top-chargeback-management-tools-shopify-merchants/`.

**Featured images (hub cards + article hero):** Set `content_items.featured_image_url` to a public **`https://`** URL (Supabase Storage and hosts allowed in `next.config.js` `images.remotePatterns`, e.g. `*.supabase.co`, `images.pexels.com`) or a **path** under the site such as `/images/resources/...` for static files in `public/`. Optional **`featured_image_alt`** (migration `20260402140000_content_items_featured_image_alt.sql`) is used for accessible alt text and in the admin editor. Public UI: `ResourceCardImage` / `ArticleHeroImage` (`components/resources/`). Inline `<img>` in `main-*.html` fragments inherit prose image classes via `BodyBlocks`.

**Backfill pillar hero images for already-published items:** After migration `featured_image_alt` is applied, run `npm run backfill:resources-images:dry` to preview, then `npm run backfill:resources-images` (requires `SUPABASE_SERVICE_ROLE_KEY` and **`PEXELS_API_KEY`**). The script builds each pillar’s pool from **several Pexels search queries** (merged, deduped, interleaved, cliché alt-text deprioritized — avoids a single “credit card + laptop” result set), then assigns `pool[i % pool.length]` where `i` is that item’s index among **all published** Resources rows in the pillar (sorted by `id`). Pexels size preset: **`large2x`** (1880 px) preferred, then `original`, then `large` — earlier versions stored `large` (940 px) which caused blurry hero images on retina screens when Next.js had to upscale 2–3×. Only updates rows that have a published `resources` localization and empty `featured_image_url` unless `--force` is passed (use `--force` after changing queries or to refresh images). See `scripts/backfill-resources-featured-images.mjs`.

**Pexels URL upgrade at display time:** `ArticleHeroImage` includes `upgradePexelsUrl()` which detects existing Pexels URLs with a `w=` parameter below 1920 and rewrites it to `w=1920` before passing to `next/image`. This ensures legacy rows that still reference the old 940 px preset are served at a sharp resolution without requiring a re-seed.

### Public URLs, hub locales, and pillars

- **Article path (resources):** `/{localePrefix}/resources/{primary_pillar}/{slug}`. Default English omits the locale segment (`/resources/chargebacks/my-article`). Other marketing locales use the short prefix from `lib/i18n/pathLocales.ts` (e.g. `/pt/resources/...` for `pt-BR`). **Slugs are per locale** (`content_localizations.slug`); the marketing **`LanguageSwitcher`** resolves the sibling slug via **`GET /api/public/resources/alternate-locale-slug`** (`pillar`, `slug`, `from`, `to` BCP-47 hub locales) so changing language on an article navigates to the correct URL instead of reusing the previous locale’s slug (which would 404).
- **Legacy internal links in article HTML:** Public resource article rendering normalizes old root-slug links (for example `https://disputedesk.app/my-slug` or `/resources/my-slug`) to canonical resource URLs when the slug resolves to a published resource row (`/resources/{pillar}/{slug}`, locale-prefixed where applicable). If the slug does **not** resolve to a published resource, the `<a>` tag is stripped entirely and the visible link text is preserved as plain prose — no 404, no redirect, no invented destination.
- **Bad CTA-like internal links in generated HTML:** If an unresolved slug looks like a trial/signup CTA, rendering rewrites the href to `/portal/connect-shopify` instead.
- **AI generation prompt rule:** The generation system prompt explicitly instructs the model to **never invent internal DisputeDesk article links**. Links to other DisputeDesk articles are only permitted when the target slug appears verbatim in the "Existing DisputeDesk articles" list provided in the prompt; otherwise the topic must be mentioned as plain text with no anchor tag.
- **Pillar segment:** Required. Allowed values match `content_items.primary_pillar` and `lib/resources/pillars.ts` (`chargebacks`, `dispute-resolution`, `small-claims`, `mediation-arbitration`, `dispute-management-software`). Generation resolves/normalizes pillar from archive data; publish rejects invalid pillars.
- **Legacy slug-only URLs:** A single segment after `/resources/` that is not a pillar name is treated as a **slug**: `app/[locale]/resources/[pillar]/page.tsx` looks up a published localization and **redirects** to `/resources/{pillar}/{slug}`.
- **Hub DB locales (`content_localizations.locale`):** `en-US`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, `sv-SE` — see `lib/resources/constants.ts` (`HUB_CONTENT_LOCALES`). Portuguese uses **`pt-BR`** (aligned with app `LOCALE_LIST` and `/pt` paths); migration `20260328144057_hub_locale_pt_br.sql` migrated existing `pt-PT` rows.
- **Localization QA (all hub languages):** Run `npm run audit:hub-locales` to compare **every published non-English row** (German, French, Spanish, Portuguese, Swedish) to the **`en-US` baseline** for the same `content_item_id` — flags identical or near-identical `title` / `meta_title` / `og_title` (not Swedish-only). Use `npm run audit:hub-locales:coverage` to list published articles that have English live but are **missing** one or more other hub locales. Scripts: `scripts/audit-hub-localization-titles.mjs` (see file header for `--csv`, `--json`, `--fail`). One-off title/meta fixes for known bad rows: `npm run fix:hub-locales`. Idempotent insert of **missing** published localizations (when curated translations exist in the script): `npm run insert:hub-locales` (`scripts/insert-missing-hub-localizations.mjs`). The admin content editor warns on save when a non–`en-US` locale’s title or meta title still matches English.
- **Autopilot / email:** `lib/email/sendPublishNotification.ts` builds “View article” links with locale prefix + `/resources/{pillar}/{slug}`. Post-publish hooks in `publish-content` cron load `primary_pillar` via a joined `content_items` select.
- **Sitemap / IndexNow:** `app/sitemap.ts` and `lib/seo/indexnow.ts` use the same locale prefixes and include the pillar segment for resources URLs.
- **Resources listing (`/resources`) — metadata & JSON-LD:** `app/[locale]/resources/page.tsx` exports `generateMetadata`: title from `resources.hubTitle`, description from `resources.heroSubtitle`, keywords from `resources.hubKeywords`, plus Open Graph and Twitter cards; canonical and `alternates.languages` (BCP-47 → path, `x-default` → `/resources`) when `getPublicBaseUrl()` resolves. **Filtered** hub URLs (`?pillar=`, `?type=`, `?q=`) and **paginated** hub URLs (`?page=2` and up) use `robots: { index: false, follow: true }` and omit `alternates.languages` to avoid faceted/search/paginated URLs competing with the main hub. **Structured data:** `resourcesHubCollectionJsonLd()` in `lib/resources/schema/jsonLd.ts` emits `CollectionPage` + `ItemList` (first page of results, capped) for the **unfiltered** hub **page 1** when origin is known; `isPartOf` references the same-locale `WebSite` `@id` (`{origin}{marketingHomePath}#website`) already output by `app/[locale]/layout.tsx`.

### Phased roadmap (hub-specific)

Phase codes **CH-1 through CH-7** are the Content Hub track (not EPIC P0). See **`docs/epics/RESOURCE-HUB-PLAN.md`**.

| Phase | Deliverable | Status |
|-------|-------------|--------|
| **CH-1** | Public hub + admin queue + JSON inspector + publish cron | Done |
| **CH-2** | Admin shell + component system + workflow migration + query layer | Done |
| **CH-3** | Dashboard + Content List (first 2 operational screens) | Done |
| **CH-4** | Block editor + locale editing (rich content editor) | Done |
| **CH-5** | Backlog + Calendar + Queue (3 operational screens) | Done |
| **CH-6** | Settings + polish + mobile editor | Done |
| **CH-7** | Article generation pipeline (archive → briefs → drafts → review) | Done |

### CH-7 — Article Generation Pipeline

AI-powered pipeline that converts archive items into multilingual article drafts. Feature-flagged via `GENERATION_ENABLED` + `OPENAI_API_KEY`.

**Generation Library** (`lib/resources/generation/`):
- `prompts.ts` — Built-in **system prompt** (SEO, domain, originality) and **default user suffix** (anti-repetition). Per-locale tone lines and **content-type lines** (structure and intent only — not fixed word counts; length is driven by `targetWordRange.ts`). `buildUserPrompt(brief, locale, resolved, context)` injects **length guidance** via `formatLengthGuidance(range, locale)` (extra **non-English depth** note when `locale !== en-US` so translations are not systematically shorter than English), **explicit native-language slug rules** for non-English locales, normalized **page role**, **search intent**, and **complexity**, plus **similar published articles** (titles, slugs, excerpts, headings, intro snippets). *Prompt-only “don’t repeat” rules are insufficient without this peer list.* Prompt rules explicitly require canonical internal article links in HTML (`/resources/{pillar}/{slug}`) and disallow root-level slug links. `resolveGenerationPrompts(cmsSettings)` merges `cms_settings.settings_json`: non-empty `generationSystemPrompt` overrides the built-in system prompt; `generationUserPromptSuffix` overrides the built-in suffix **only if the key is present** in JSON (empty string = no extra suffix block). If the key is **omitted**, the built-in anti-repetition suffix applies. Per-locale / per-content-type maps still ignore empty override values.
- `targetWordRange.ts` — `resolveTargetWordRange(brief)` produces a string such as `1100–1500 words` from **`page_role`** (`pillar` \| `support` \| `checklist` \| `template` \| `faq` \| `case_study`), **`complexity`** (`low` \| `medium` \| `high`), **`search_intent`** (`informational` \| `commercial` \| `transactional`, normalized from archive text), and **`content_type`** (fallback role inference when `page_role` is null). Optional **`target_word_range`** on the archive row (or the same keys inside parsed **`notes`** JSON) overrides computation. Base ranges per role, small modifiers for complexity and intent, clamp **700–2600** words. `formatLengthGuidance(range, locale)` appends non-English depth guidance when `locale` is not `en-US`. Re-exported from `prompts.ts` for callers.
- `similarArticles.ts` — `fetchSimilarPublishedArticles(brief, locale, routeKind)` returns up to ~10 scored peers (published, same locale/route, heuristic match on type/pillar/keyword/title).
- `similarity.ts` — Deterministic post-check: slug collision (DB or peer list), title Jaccard overlap, title+excerpt overlap. Failed check → **one** model retry with an explicit “too similar” instruction → second failure returns a clear error (no `content_items` insert).
- `htmlSnippet.ts` — Extracts headings / intro snippet from `mainHtml` for the overlap block.
- `contentRouteKind.ts` — `routeKindForContentType()` maps `content_type` → `content_localizations.route_kind` (slug scope + similar-article query).
- `generate.ts` — OpenAI Chat Completions (`generateForLocale` per locale with `GenerationContext`; `generateAllLocales` runs locales in parallel with similarity guard + retry). Temperature: `0.3` for `legal_update`, else `0.4`.
- `pipeline.ts` — `loadArchiveForGeneration()` / `runGenerationPipeline()`: **idempotency** — if `content_archive_items.created_from_archive_to_content_item_id` is already set, returns an error and the existing `content_item` id (no second draft). Maps archive rows to `GenerationBrief` including `page_role`, `complexity`, `target_word_range` columns and optional overrides from structured **`notes`** JSON (`page_role` / `pageRole`, `complexity`, `target_word_range` / `targetWordRange`). Loads CMS settings → fetches similar articles per target locale → generates → creates `content_items` + `content_localizations` + `content_revisions` → links archive row. `buildBriefFromArchive()` remains for callers that only need a brief (returns `null` if archive missing or already converted).

**Admin-editable prompts** (stored in `cms_settings.settings_json`, edited at **Admin → Resources → Settings → AI generation prompts**):
- `generationSystemPrompt` — Full system message (optional; if blank, built-in default from `prompts.ts` is used). UI toggle shows the built-in text read-only when using defaults.
- `generationUserPromptSuffix` — Appended under “Additional instructions” before the final JSON instruction. **Omit this key** in saved JSON (admin saves blank field without key) to use the built-in anti-repetition block; set to `""` explicitly to disable the extra block.
- `generationLocaleInstructions` — Partial map of locale → style line; non-empty values override defaults.
- `generationContentTypeInstructions` — Partial map of `content_type` → instruction line; non-empty values override defaults.

**API Routes**:
- `POST /api/admin/resources/archive-items` — Creates an archive/backlog row (`idea` \| `backlog` \| `brief_ready`). Sets `backlog_rank` to **max existing + 100** so it sorts after the current queue unless reorder is used. Admin session required.
- `DELETE /api/admin/resources/archive-items` — Deletes all `content_archive_items` where `status` is not **`converted`** (clears the editorial backlog; converted trace rows remain). Returns `{ deleted: number }`. Admin session required.
- `POST /api/admin/resources/archive-items/reorder` — Body `{ orderedIds: string[] }` (dedupe ids, max **300**). Writes `backlog_rank` = `index * 100` per id. Admin session required. Errors that indicate `backlog_rank` is missing are normalized for operators (apply migration `20260330180000_content_archive_backlog_rank.sql`).
- **Bulk backlog import (ops):** `npm run import:backlog` — `scripts/import-content-backlog.mjs` reads a JSON array (default `scripts/backlog-import.json` or a path argument); uses **service role** (`SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`). Optional `--clear` deletes non-`converted` archive rows first. **`scripts/merge-backlog-json-parts.mjs`** merges `scripts/b2-part-*.json` into a single file for import.
- `POST /api/admin/resources/generate` — Triggers **editorial** pipeline for an archive item (`runGenerationPipeline` without autopilot flags). Returns 503 if disabled; **207** if `error` is set but `contentItemId` is present (e.g. archive already converted); 500 on hard failure; 200 on success.
- `POST /api/admin/resources/generate-autopilot` — Body `{ archiveItemId }`. Runs `runGenerationPipeline(id, { autopilot: true, autopilotDrainBacklog: false })` for a **specific** backlog row (same publish-queue behavior as manual admin autopilot: only that article’s locales publish in-request). Returns **400** if **`autopilotEnabled`** is false in `cms_settings.settings_json`. Otherwise same status codes as **`/generate`** (503 / 400 missing id / 207 / 500 / 200). Admin session required. `maxDuration` = **300s**. Backlog UI: **Auto Pilot** link.
- `POST /api/admin/resources/cron/autopilot` — Manual autopilot tick (admin session). Calls `executeAutopilotTick({ bypassRateLimit: true, overrideCount })` — **bypasses the cron daily cap** (unlike `GET/POST /api/cron/autopilot-generate`). Optional query: **`limit`** = max articles this request (integer **1–50**, default **1**). Each article still runs **all target locales** in parallel with similarity guards, so a single item can take minutes; keep default **1** unless you accept timeout risk. Route `maxDuration` = **300s** (Vercel **Pro+**; Hobby’s lower cap may still 504 on slow OpenAI). The Vercel cron route uses the same tick **without** `bypassRateLimit` and respects `autopilotArticlesPerDay` / burst rules.
- `POST /api/admin/resources/cron/publish` — Manual run of the publish-queue cron (admin session). Same behavior as `GET /api/cron/publish-content` with `CRON_SECRET`.
- `POST /api/admin/resources/publish-repair` — Admin repair: (1) `repairStuckPublishedWorkflow()` for `workflow_status='published'` with `published_at IS NULL`; (2) `repairPublishedItemsWithUnpublishedLocales()` for workflow published but any localization still `is_published = false` (re-enqueues + priority publish). Response JSON: `{ stuckPublishedAt, unpublishedLocales }`.
- `POST /api/admin/resources/publish-queue/[id]/retry` — Admin retry endpoint that resets a failed publish-queue row to `pending`, sets `scheduled_for=now`, and clears `last_error`.
- `POST /api/admin/resources/reading-time-backfill` — Admin utility to populate `content_localizations.reading_time_minutes` for rows where it is null, using an HTML word-count estimate (call from API client / curl; not exposed as a Settings button).
- `POST /api/admin/resources/reset-and-rebuild` — Archives AI-generated content (`generated_at` set), deletes matching `content_publish_queue` rows, sets `workflow_status` to `archived`, and resets linked `content_archive_items` to `backlog` with high `priority_score` so autopilot can regenerate. Body: `{ ids: string[] }` for selected items, or `{ all: true }` for every AI item in live workflows; optional `{ dryRun: true }` returns counts without writing. **Content List** bulk bar and **Settings** (dry-run + execute-all) call this route; it supersedes the removed `archive-ai-articles` and `regenerate-with-inline-links` endpoints.
- `POST /api/admin/resources/ai-assist` — In-editor AI tools: `improve_readability`, `generate_meta`, `suggest_related`. Each calls OpenAI with task-specific system prompts.

**Editor Integration**:
- `AIAssistantPanel` component (`components/admin/editor/AIAssistantPanel.tsx`) — Sidebar panel with three AI actions. Results can be applied directly to editor state.

**Backlog Integration**:
- Status column uses `ArchiveItemStatusBadge` + `getArchiveItemStatusDisplay` (`lib/resources/archiveItemStatus.ts`) because `content_archive_items.status` is snake_case (`brief_ready`), not the content workflow’s kebab-case (`brief-ready`). Feeding archive status into `WorkflowStatusBadge` mislabeled **Brief ready** rows as **Idea**.
- The backlog table **Title** column shows **`proposed_title`** (with optional **`notes`** subtitle); keyword is a separate column.
- **Autopilot archive pick** (`lib/resources/cron/autopilotTick.ts` → `pickNextArchiveItem`): eligible rows (`backlog` / `brief_ready`, not linked to a content item) are ordered by **`backlog_rank` ascending**, then **`priority_score` descending**, so manual queue order beats score within the same rank band.
- **Generate** on each backlog item → `POST /api/admin/resources/generate` → editor for the new draft. **Auto Pilot** → `POST /api/admin/resources/generate-autopilot` → autopilot path (scheduled + publish queue); redirects to the content item when done. Auto Pilot requires **AI Autopilot** on in Settings.

**Shopify chargeback launch cluster (content briefs in DB):**
- Editorial spec + linking plan: `docs/content-briefs/shopify-chargeback-cluster-launch.md`.
- Seed eight `content_archive_items` rows (idempotent by `proposed_slug`): `npm run seed:shopify-chargeback-cluster` (`scripts/seed-shopify-chargeback-cluster.mjs`). Pillar uses `content_type = pillar_page`, **`page_role = pillar`**, **`complexity = high`**, and highest `priority_score` so autopilot picks it first. Support articles use **`page_role = support`**, **`complexity = medium`**; the evidence checklist row uses **`page_role = checklist`**, **`complexity = medium`** (see seed script).
- Run **one** autopilot cron tick (temporarily forces `autopilotArticlesPerDay = 1` and restores prior `cms_settings`): `npm run run:autopilot-once` (`scripts/run-autopilot-once.mjs`). Requires reachable app URL (`CRON_TRIGGER_URL` / `NEXT_PUBLIC_APP_URL`), `CRON_SECRET`, and server-side `GENERATION_ENABLED` + `OPENAI_API_KEY`.

**Analytics** (migration `032_generation_analytics.sql`):
- `content_items`: `generated_at`, `generation_tokens`, `rejection_reason`, `time_to_publish`.
- `content_revisions`: `change_summary`, `edit_distance`, `tokens_used`.
- `getGenerationStats()` query in `admin-queries.ts`.

## Async Jobs

### Architecture

Jobs table (`007_jobs.sql`) + claim RPC (`008_claim_jobs_rpc.sql`) +
worker endpoint (`/api/jobs/worker`).

### Job Types

| Type                          | Trigger                                                | Handler                                                  |
|-------------------------------|--------------------------------------------------------|----------------------------------------------------------|
| sync_disputes                 | Cron, manual, or dispute webhooks                      | lib/jobs/handlers/syncDisputesJob.ts                     |
| build_pack                    | Automation pipeline or manual                          | lib/jobs/handlers/buildPackJob.ts                        |
| render_pdf                    | POST /api/packs/:packId/render-pdf                     | lib/jobs/handlers/renderPdfJob.ts                        |
| save_to_shopify               | Auto-save gate or POST .../approve                     | lib/jobs/handlers/saveToShopifyJob.ts                    |
| snapshot_shop_daily_metrics   | Daily cron (`/api/cron/snapshot-daily-metrics`)         | lib/jobs/handlers/snapshotShopDailyMetricsJob.ts         |
| backfill_shop_daily_metrics   | OAuth callback (install/reinstall) — fire-and-forget   | lib/jobs/handlers/backfillShopDailyMetricsJob.ts         |

### Execution Flow

1. API route validates + creates resource → enqueues job → returns 202.
2. Vercel Cron hits worker every 2 minutes.
3. Worker claims jobs via `SELECT ... FOR UPDATE SKIP LOCKED`.
4. Per-shop concurrency: max 1 running job (V1).
5. Retry: 3 attempts, 30s × attempt backoff on failure.
6. UI polls `GET /api/jobs/:id` every 3 seconds until terminal state.

The worker route declares `export const maxDuration = 300` so that the bulk `backfill_shop_daily_metrics` handler — which loops through 90 UTC days × ~700ms/day ≈ 63s — completes inside one invocation rather than fanning out as 90 separate jobs (which would queue serially against the per-shop concurrency cap and stretch a backfill over ~3 hours).

### sync-disputes cron — due-queue + adaptive cadence

**Time-to-discovery for a new dispute is sub-minute, not the reconcile interval.** Shopify pushes `disputes/create` the instant a chargeback opens; the webhook handler enqueues a `sync_disputes` job; the worker (`*/2 * * * *`) processes it within 2 minutes worst case. The reconcile cron does NOT gate discovery — it is a backstop for missed webhooks (Shopify retries delivery for 48h, but if every retry fails or the handler returns non-2xx, reconcile is what eventually catches the drift). At a 1-hour reconcile interval, a stuck dispute is still found well inside any chargeback evidence-due window (typically 7-14 days).

Webhooks (`disputes/create`, `disputes/update`) drive primary sync; the cron at `/api/cron/sync-disputes` is a **reconciliation safety net** for missed webhooks. It does NOT loop over every shop on every tick — that pattern doesn't scale past a few thousand tenants. Instead it claims a bounded batch of *due* shops via the `claim_due_shops` SQL function (migration `20260502120000_shop_reconcile_schedule.sql`).

**Schedule columns on `shops`:**

| Column                          | Default | Meaning                                                |
|---------------------------------|---------|--------------------------------------------------------|
| `next_reconcile_at`             | `now()` | When the cron should next pick this shop. Backfilled to a random offset within 1 hour to avoid stampedes. |
| `reconcile_interval_seconds`    | `3600`  | Per-shop cadence in seconds. Adapted automatically.    |
| `last_reconciled_at`            | `null`  | Stamped by `recordReconcileOutcome()` after each run.  |

**Claim flow (`claim_due_shops(p_limit int)`):**

```
WITH due AS (
  SELECT id FROM shops
  WHERE uninstalled_at IS NULL AND next_reconcile_at <= now()
  ORDER BY next_reconcile_at LIMIT p_limit
  FOR UPDATE SKIP LOCKED
)
UPDATE shops s
  SET next_reconcile_at = now() + (s.reconcile_interval_seconds * '1 second'::interval)
  FROM due WHERE s.id = due.id
  RETURNING s.id, s.shop_domain;
```

`FOR UPDATE SKIP LOCKED` makes the claim safe under concurrent cron invocations. The `next_reconcile_at` advance happens in the same statement, so a claimed shop can't be re-claimed for one full interval — even if the worker hasn't started yet.

The cron route (`CLAIM_BATCH = 200`) is bounded regardless of tenant count. At 100k shops with 1-hour cadence → ~140 shops/5-min tick, well under the cap.

**Adaptive cadence** (`lib/disputes/reconcileSchedule.ts`): after each `syncDisputes` run, `recordReconcileOutcome()` adjusts the shop's interval:

- drift detected (`created > 0 || updated > 0`) → halve, floor 15 min
- clean reconcile (no drift, no errors) → multiply by 1.5, ceiling 24 h
- errors present → leave interval alone (the circuit-breaker handles repeated failures)

Active shops settle near 15-30 min, dormant shops drift toward 24 h. Webhook-driven syncs do NOT call `recordReconcileOutcome` — only the cron reconciliation path adapts cadence (otherwise normal webhook activity would constantly halve the interval and defeat the purpose).

**Per-shop guards (kept from earlier fix):**

1. **No-session skip:** if the shop has no offline `shop_sessions` row, skip enqueue with `reason: "no_offline_session"`. Prevents enqueueing work that can only fail.
2. **Circuit-breaker:** if the last 5 terminal `sync_disputes` jobs for the shop all failed, skip with `reason: "circuit_breaker_open"` until an admin clears the streak.

Job retention: terminal jobs (`succeeded` | `failed`) older than 30 days are pruned by `/api/cron/retention-cleanup` (weekly, `0 3 * * 0`). Job rows are operational telemetry, not audit data — `dispute_events` is the audit source.

### Admin overview job counts

`/api/admin/metrics` returns `jobs: { queued, running, succeeded, failed }` (totals across the table — no `LIMIT`). The `/admin/jobs` page reads `succeeded` from this endpoint for its stats row, while still rendering only the most recent 200 rows in the table for performance. The job status enum on disk is `queued | running | succeeded | failed` (per `007_jobs.sql`); the dashboard uses these names verbatim — never label them as "Completed" (a non-existent enum value).

## Chargeback Rate (PRD §8 + §9)

### Snapshot pipeline

`shop_daily_metrics(shop_id, date, order_count, dispute_count, chargeback_count, inquiry_count, last_synced_at)` (migration `20260501100000_shop_daily_metrics.sql`) is the single source of truth for the chargeback-rate metric. The dashboard KPI and the admin Risk profile both read from this table; **never live Shopify** at the read side (PRD §6, §12).

Snapshot writers:
- **`/api/cron/snapshot-daily-metrics`** — Vercel Cron `30 0 * * *` (00:30 UTC, after the prior UTC day fully closes). Enqueues one `snapshot_shop_daily_metrics` job per active shop with `entity_id = yesterday's YYYY-MM-DD`. Skips when a job for the same (shop, date) is already queued/running (idempotent).
- **`enqueueShopDailyMetricsBackfill(shopId)`** — fire-and-forget call from the OAuth callback (`/api/auth/shopify/callback`) right after `storeSession()`. Enqueues a single `backfill_shop_daily_metrics` job that walks the trailing 90 UTC days. Idempotent: skips when any rows already exist for the shop (re-installs after uninstall don't re-pay the cost), and skips already-snapshotted dates inside the loop so retries are cheap.

Each per-day snapshot:
1. Resolves the shop's offline session via `getShopBackgroundSession`.
2. Calls `fetchOrdersInWindow(session, dateIso, dateIso+1)` (`lib/shopify/queries/ordersForSnapshot.ts`) — paginated Shopify GraphQL `orders` connection sorted by `CREATED_AT`, selecting `id`, `createdAt`, `test`. Buckets results by UTC day in code via `bucketOrdersByUtcDay()`. **Test-order exclusion was reverted 2026-05-01** so dev shops with Bogus-Gateway orders read realistic numbers during local testing; the `testOrderGidSet()` helper remains exported for the eventual prod re-enable.
3. Reads the local `disputes` table filtered by `initiated_at` ∈ [day, day+1) → `dispute_count` total, split into `chargeback_count` (phase = 'chargeback') and `inquiry_count` (phase = 'inquiry'). Phase-NULL legacy rows are excluded from both buckets but counted in `dispute_count`.
4. Upserts on (shop_id, date) and stamps `last_synced_at`.

**Why not `ordersCount`:** the snapshot pipeline previously called Shopify's `ordersCount(query: …)` field per UTC day. In API version 2026-01 that field returns wrong counts for narrow `created_at:>=…Z created_at:<…Z` compound range filters — it double-counts orders straddling day boundaries (verified against `surasvenne` 2026-05-01: window-level count = 7 but per-day-summed count = 14). The orders LIST connection honors the same range filter correctly, so the snapshot now goes through the connection and counts in code. Removed `lib/shopify/queries/ordersCount.ts` — no remaining callers.

**Backfill efficiency:** `backfillShopDailyMetrics` fetches the entire 90-day window in one paginated stream (typically one page; high-volume shops paginate), groups locally by UTC date, and writes 90 daily rows in one bulk upsert. Replaces the prior 90-sequential-calls approach. Test-order filtering applies to the bulk path identically.

UTC day boundary is intentional: card-network reporting standards are UTC-based, and merchant timezones are not considered.

### Read path

`lib/disputes/chargebackRate.ts → computeChargebackRate({ shopId, fromDate?, toDate? })` returns `{ rate, rateChange, numerator, denominator, available, lowVolume, daysCovered, daysExpected, lastSyncedAt }`. Rules:
- Rate is `100 × chargeback_count / order_count`, rounded to one decimal place.
- `available: false` when zero snapshot rows cover the window — UI renders "Calculating…" rather than a misleading 0%.
- `available: true, rate: null` when all rows have `order_count = 0` (avoids 0/0 → NaN).
- `lowVolume: true` when `denominator < 50` (PRD §11). UI suppresses the numerator/denominator subtext in favour of a "Low volume — rate may be volatile" hint.
- `rateChange` is the **percentage-point** delta vs. the prior equal-length window. Same unit convention as `winRateChange` (PRD §7).
- `lastSyncedAt` is the most-recent `last_synced_at` in the window — drives the admin Sync freshness signal.

`computeDisputeMetrics` (`lib/disputes/metrics.ts`) calls `computeChargebackRate` once with the period derived from `periodFrom/periodTo`, surfaces the result on `DisputeMetrics` as `chargebackRate`, `chargebackRateChange`, `chargebackRateNumerator`, `chargebackRateDenominator`, `chargebackRateAvailable`, `chargebackRateLowVolume`, `chargebackRateLastSyncedAt`. Every consumer route (`/api/dashboard/stats`, `/api/admin/metrics`) gets these for free via the existing `...m` spread.

### Dashboard KPI tile (Figma alignment 2026-05-01)

Fifth card on the existing `Performance overview` row (no new sections, no chart, no nav per PRD §8). `DashboardKpis.tsx` exports a dedicated **`ChargebackKpiTile`** component — separate from the shared `DesktopKpiTile` / `MobileKpiTile` — because the chargeback card carries affordances the standard tile doesn't have (info tooltip, threshold pill in the title row top-right, lucide-equivalent arrow icon for the delta). The other 4 KPI tiles (Active / Win Rate / Recovered / At Risk) are unchanged.

**Layout — 3 rows matching the visual rhythm of the other 4 tiles:**

1. **Title row** (`flex justify-between, align-items: flex-start`):
   - Left: label "Chargeback rate (30d)" (`12px / #6D7175`) + Polaris `Tooltip`-wrapped Info icon (12×12). Tooltip body is a `BlockStack` with the three threshold bands (Healthy `<0.6%` / Watch `0.6%–0.9%` / High risk `>0.9%`) plus a card-network penalty footnote.
   - Right: threshold pill — `Healthy` green (`#D1FAE5`/`#065F46`), `Watch` amber (`#FEF3C7`/`#92400E`), `High risk` red (`#FEE2E2`/`#991B1B`). `padding: 2px 6px`, `border-radius: 6px`, `font-size: 10px`.
   - Label has `overflow-wrap: anywhere` so "(30d)" wraps to a second line at narrow grid widths instead of truncating to "Chargeback r…".
2. **Value row:** `24px bold #111827` rate value, alone on the row. Renders `—` when `!chargebackRateAvailable || chargebackRate === null`.
3. **Delta row:** custom `ChargebackDelta` helper — Polaris `ArrowUpIcon` (red `#DC2626`) for an increase, `ArrowDownIcon` (green `#059669`) for a decrease, neutral subdued for zero. Format: `↑ +0.1 pp` / `↓ 0.1 pp`. **Does NOT use `ChangeIndicator`** (the helper used by the other 4 tiles), because (a) chargeback's "vs last month" suffix isn't shown on the card and (b) the arrow icon matches Figma's `TrendingUp/Down` lucide treatment more faithfully.

**Card chrome:** `border: 1px solid #E1E3E5; border-radius: 10px; padding: 16px`. Natural content height matches the other 4 tiles in the auto-fit grid — no `flex-direction: column; justify-content: space-between` tricks needed.

**Mobile:** the chargeback card lives in Row 4 of the custom mobile stack (full width). Same `ChargebackKpiTile` component; the card is the same shape as on desktop.

The card renders **only** label, info tooltip, threshold pill, value, and pp delta — per PRD §8 explicit "DO NOT add subtext / numerator-denominator / explanations on the card." Numerator/denominator, last-synced timestamp, and explanatory hints live in the inline `ChargebackRateDetailsStrip` below the KPI grid (see next section).

### Inline details strip (`ChargebackRateDetailsStrip`)

A non-card affordance directly below the KPI grid, inside the same Performance Overview container, separated by a 1-px `#E1E3E5` border-top. **No background box, no shadow, no heavy padding** per PRD §8 styling rules. Mirrors Figma `shopify-home.tsx:331-365` literally.

- **Default state:** right-aligned `Details` link only — Shopify-blue `#005BD3` with underline-on-hover. Always rendered after initial load (only suppressed during the loading skeleton). Earlier "hide-when-empty" was an invented optimization and was removed.
- **Expanded state:** vertical stack of 12px subdued lines (Figma `mt-2 space-y-1.5`):
  - `{numerator} chargebacks / {denominator} orders` — numerator bolded against subdued parent text (`font-medium #202223` inside `#6D7175`).
  - pp delta sentence — color-keyed: red `#DC2626` for an increase, green `#059669` for a decrease, neutral for flat. Format from i18n: `+0.1 pp increase` / `0.1 pp decrease` / `No change vs prior period`.
  - **Optional** `Approaching risk threshold (0.9%)` — surfaces whenever `chargebackRate >= 0.7%` (matches Figma's literal trigger; spans the upper Watch band through High risk).
  - `Last synced 12m ago` — locale-aware relative time: `just now` / `Xm ago` / `Xh ago` / `Xd ago` / `no snapshot yet`.
  - **Optional** `Low volume — rate may be volatile` rendered as a yellow pill (`bg-[#FEF3C7] / text-[#92400E] / px-2 py-1 rounded inline-block`) when `chargebackRateLowVolume === true`.
- **No-snapshot fallback:** when `!chargebackRateAvailable`, the expanded panel collapses to a single italicized "Calculating…" line so the affordance still feels responsive on fresh installs / mid-backfill. The Details button itself remains visible.
- **Toggle:** `Details` ⇄ `Hide details`, no animation beyond simple expand. Self-contained `useState` — no global state, no URL param.

i18n keys (`messages/{locale}.json`, all 12 locales):
- KPI tile: `dashboard.chargebackRate`, `dashboard.chargebackRateThresholdHealthy / Watch / High`, `dashboard.chargebackRateTooltipFootnote`
- Details strip: `dashboard.chargebackRateDetailsShow / Hide`, `chargebackRateSubtext` (`{numerator}` / `{denominator}`), `chargebackRateDeltaIncrease / Decrease / Flat` (`{value}` placeholder), `chargebackRateLastSynced` (`{ago}` placeholder), `chargebackRateLowVolume`, `chargebackRateApproachingThreshold`, `chargebackRateRelativeJustNow / Minutes / Hours / Days / Never`, `chargebackRateUnavailable` (the "Calculating…" italicized fallback)

### Admin shops list (Figma `pages/admin/shops-admin.tsx`)

`/admin/shops/page.tsx` displays a sortable table of installed shops with billing + dispute data.

- **Stats row (top):** 4 cards — Total Shops · Active (green) · Total Disputes · Total MRR (sum of `monthlyRevenueUsd` across active shops, derived from `shops.plan` via `lib/billing/plans.ts → PLANS[plan].price`).
- **Table columns:** Domain · Plan · Status · Disputes (count) · Packs (count) · MRR · Chargeback Rate (90d, sortable) · Installed · Actions.
- **Filter chips:** All Plans · Scale · Growth · Starter · Free.
- **Data source:** `/api/admin/shops` returns the shop row plus 4 computed fields per shop:
  - `chargebackRate90d{,Numerator,Denominator,Available}` — single batched `shop_daily_metrics` read for the trailing 90 UTC days, aggregated in JS.
  - `disputeCount` — count of `disputes` per shop_id, batched.
  - `packCount` — count of `evidence_packs` per shop_id, batched.
  - `monthlyRevenueUsd` — `monthlyRevenueForPlan(shop.plan).monthlyUsd`.
- **Sorting:** click toggles `asc ⇄ desc` two-state on the chargeback rate column (matches Figma `shops-admin.tsx:42-49`). Nulls always sink regardless of direction.
- **AdminTable** sortable-header form: `headers` accepts `string | { label, sortable?, sortDirection?, onSort?, align? }`. Existing string-array call sites are unchanged.

### Admin shop detail (`/admin/shops/[id]`, Figma `pages/admin/shop-detail.tsx`)

The page replaces the prior `AdminPageHeader` / `AdminStatsRow` chrome with a Figma-aligned custom layout:

- **Header row:** 48×48 Store icon in a `bg-[#EFF6FF]` rounded square + `<h1 text-2xl>` shop domain + plan pill + status pill + Calendar + "Installed [date]". Right side: "View in Shopify" (links to `https://{domain}/admin`) + "Contact Shop" (placeholder, disabled until a contact-support flow lands).
- **Risk Profile card** — see next section.
- **Quick Stats footer:** 3 cards (Monthly Revenue $ · Evidence Packs · Total Disputes) sourced from `shops.plan`, `evidence_packs.count(*)`, `disputes.count(*)`.
- **Admin Overrides card:** unchanged (plan override, pack limit override, admin notes).

### Admin Risk Profile section (Figma `shop-detail.tsx:170-413`)

`components/admin/ShopRiskProfile.tsx` renders the period-aware risk panel inside the detail page.

- **Period selector:** 30d · 90d · 180d · All time. Selection triggers a re-fetch of `/api/admin/shops/[id]/risk?period=…` so each period yields exact period-scoped numbers (not pre-loaded). API handler: `app/api/admin/shops/[id]/risk/route.ts` validates the param against `["30d","90d","180d","all"]`, defaulting to `90d`.
- **Snapshot row (6 cards, light-gray containers):**
  - Chargeback rate — threshold pill (Healthy / Watch / High risk) on the right, `numerator / denominator` subtext.
  - Total disputes — count + period-vs-prior trend pill (`+12% vs prev`, inverse-colored: increase = red).
  - Total orders — count + period-vs-prior trend pill (increase = green).
  - Amount at risk — red value, "{n} pending" subtext (active disputes only, all-time).
  - Total invoiced — `monthlyPrice × monthsInPeriod` via `totalInvoicedForPeriod()`. Marked approximate via a "≈" tooltip ("Approximate: monthly price × months in window. No invoice history yet.") — see `lib/admin/shopBilling.ts`.
  - Win rate — green value, "{n} won" subtext. Denominator is `won + lost`, so "Pending" disputes don't deflate the rate.
- **Charts grid (2 cols):**
  - Dispute breakdown — three labeled progress bars: Fraud / Unauthorized (red), Item not received (blue), Other (amber). Family classification from `DISPUTE_REASON_FAMILIES` (Fraud + Authorization → fraud; Fulfillment + Quality → fulfillment; everything else → other).
  - Outcomes — three rows with colored 40×40 icon boxes (Won / Lost / Pending) + helper rate.
- **Trend chart (full-width):** dual-bar per bucket — disputes red + orders gray, side-by-side. Bucket plan adapts to period: 30d → 4 weekly buckets, 90d → 13 weekly, 180d → 13 bi-weekly, all → 12 monthly. Date label rotates -45° to fit horizontal space.
- **Additional Signals (3 cards):**
  - Inquiry ratio — `inquiry / chargeback` ratio formatted as `X.X:1` ("Inquiries per chargeback"), or "—" when chargeback count is zero.
  - Last sync — relative time ("12 minutes ago"), with "Data is current" green text when `dataCompleteness ≥ 90%`, otherwise "Partial coverage" gray.
  - Data completeness — `% = (snapshot rows in window) / (window days)`. Surfaced as a value + horizontal progress bar.

All numbers come from `shop_daily_metrics` + the local `disputes` table + `shops.plan` (no live Shopify calls). Period-vs-prior deltas use a same-length prior window immediately before the current one; for the "All time" view there's no prior window so deltas show "—". `getShopRiskProfile(shopId, { period })` in `lib/admin/shopRisk.ts` is the single composer.

### Billing helpers (`lib/admin/shopBilling.ts`)

Two pure helpers wrap the existing `lib/billing/plans.ts → PLANS` map for the admin metrics:

- `monthlyRevenueForPlan(plan)` → `{ planId, planName, monthlyUsd }`. Used by the shops list MRR column and the detail-page Quick Stats footer.
- `totalInvoicedForPeriod(plan, windowDays)` → `{ totalUsd, monthsInPeriod, isApproximate: true, … }`. **Approximation**: `monthlyPrice × (windowDays / 30)`. Doesn't account for plan changes mid-window, trial periods, or top-up purchases. Replace with real invoice records when a `billing_invoices` table is built.

Migrations live in `supabase/migrations/`. **Primary workflow** is the **Supabase CLI** (tracks migrations in the remote `supabase_migrations` history — this is what the project uses day to day).

### Supabase CLI (recommended)

- **One-time:** `npx supabase login` then `npx supabase link --project-ref <ref>` (ref from `SUPABASE_URL` / Dashboard, e.g. `sddzuglxdnkhcnjmcpbj`). Enter the database password when prompted; link state stays local (see `.gitignore` for `supabase/.temp/`).
- **Apply migrations:** `npm run db:migrate` (alias for `npx supabase db push`) to push any new SQL files not yet applied remotely.
- **Existing DB:** If the database was created outside the CLI (e.g. Dashboard SQL or an old script), the CLI may have no migration history. Run `npx supabase migration repair <001> <002> … --status applied` once to mark already-applied files without re-running SQL; then `db push` applies only new migrations.
- **Without CLI link:** `npm run db:migrate:script` runs `scripts/run-migration.mjs`, which uses a local `_migrations` table and requires `SUPABASE_URL_POSTGRES` (or `SUPABASE_URL` + `SUPABASE_DB_PASSWORD`). Prefer the CLI when possible so there is a single source of truth with hosted Supabase.

### Ad-hoc SQL / ops queries (canonical path)

**Use this for one-shot reads, diagnostics, and targeted cleanups** — anything that is not a migration and not application code. It runs SQL via the Supabase Management API against the linked project, so it needs no DB password and does not depend on `SUPABASE_URL_POSTGRES` being in sync (that env var rots when the DB password is rotated in the dashboard).

```bash
# Inline query — service-role-equivalent privilege
npx supabase db query --linked "select count(*) from disputes where status = 'NEEDS_RESPONSE'"

# From a file — preferred for any multi-statement / transactional block
npx supabase db query --linked --file scripts/sql/my-cleanup.sql

# CSV / table output for humans
npx supabase db query --linked --output table "select shop_domain, plan from shops limit 20"
```

**Privilege & safety notes:**
- Runs with privileges sufficient to `ALTER TABLE … DISABLE TRIGGER` and set session GUCs (e.g. `app.allow_audit_mutation = 'on'`), which means it can bypass audit-immutability triggers when needed. **Always wrap destructive ops in a `do $$ … end $$` block with explicit structural guards** (assert the dispute_gid pattern, shop_domain, etc.) before the deletes — see `scripts/sql/delete-dispute-384652be.sql` for the reference pattern.
- `raise notice` output is **swallowed** by `db query`; only `select` result rows come back. Verify destructive ops with a follow-up `select` (or a separate inspection script using `SUPABASE_SERVICE_ROLE_KEY` via `@supabase/supabase-js`).
- For deletes that touch `audit_events` and/or `dispute_events`, remember the two different escape hatches: `audit_events` honours the `app.allow_audit_mutation` GUC (set via `perform set_config(...)` inside the DO block); `dispute_events` has no GUC — you must `alter table dispute_events disable trigger trg_dispute_events_no_delete` and re-enable inside the same transaction. See *E2E fixtures and audit immutability* below.

**When to reach for something else:**

| Need | Use |
|------|-----|
| Apply a migration file | `npm run db:migrate` (alias for `supabase db push`) |
| Read rows from app code or scripts | `@supabase/supabase-js` with `SUPABASE_SERVICE_ROLE_KEY` (RLS-bypassing, but trigger-respecting — cannot delete audit/dispute_events rows) |
| Direct `psql`-style session (multi-statement transactions outside Management API, `\copy`, large bulk loads) | `pg.Client` with `SUPABASE_URL_POSTGRES` in `.env.local`. **This password is rotated periodically in the Supabase dashboard;** if `password authentication failed for user "postgres"` shows up, refresh the value from Dashboard → Project Settings → Database → Connection string before re-running. Do **not** reach for this when `db query --linked` would have worked. |
| Bypass `audit_events` immutability from an RPC | The existing `delete_e2e_fixture_dispute(uuid)` RPC is scoped to E2E fixtures only; for other one-shot ops, use `db query --linked` with the DO-block pattern above. |

`scripts/sql/` holds the reference SQL files (`cleanup-e2e-fixtures-*.sql`, `verify-audit-triggers.sql`, `delete-dispute-384652be.sql`). Drop new one-shot ops SQL there alongside them.

| File | Contents |
|------|----------|
| 001_core_shops_sessions.sql | shops + shop_sessions (online/offline, key_version) |
| 002_disputes.sql | disputes with dispute_evidence_gid |
| 003_evidence_packs_items.sql | evidence_packs + evidence_items |
| 004_audit_events.sql | audit_events + immutability triggers |
| 005_rules_policies.sql | rules + policy_snapshots |
| 006_rls_policies.sql | RLS policies (service role access) |
| 007_jobs.sql | jobs table for async work |
| 008_claim_jobs_rpc.sql | claim_jobs() RPC with SKIP LOCKED |
| 009_portal.sql | portal_user_profiles + portal_user_shops + RLS |
| 010_automation.sql | shop_settings + evidence_packs automation fields |
| 011_rules_name.sql | rules.name column |
| 012_shops_retention.sql | shops.retention_days, uninstalled_at |
| 013_shops_admin_overrides.sql | pack_limit_override, auto_pack_enabled, admin_notes |
| 014_shops_locale.sql | shops.locale (BCP-47) for merchant locale preference |
| 015_pack_credits.sql | plan_entitlements, pack usage, RLS |
| 016_pack_templates.sql | pack_templates + pack_template_documents (reusable evidence templates) |
| 017_bcp47_locales.sql | user_locale, pack_template_i18n |
| 018_template_library_narratives.sql | template library narrative fields |
| 019_seed_global_templates.sql | seed global pack templates |
| 020_setup_wizard.sql | shop_setup, integrations, integration_secrets, evidence_files, app_events + evidence-samples bucket |
| 021_fix_offline_session_duplicates.sql | fix duplicate offline session handling |
| 022_disputes_order_customer_display.sql | disputes order/customer display fields |
| 023_policy_uploads_bucket.sql | storage bucket `policy-uploads` for policy document uploads (portal) |
| 024_evidence_packs_nullable_dispute.sql | evidence_packs.dispute_id nullable (library/template packs) |
| 025_policy_snapshots_privacy_contact.sql | policy_snapshots: allow policy_type `privacy`, `contact` |
| 026_shops_policy_template_lang.sql | shops.policy_template_lang (language of policy template content) |
| 027_policy_template_lang_explicit.sql | policy_template_lang values: en, de, fr, es, pt, sv (explicit choice) |
| 20260408120000_packs_add_description.sql | packs.description (optional text description for library packs) |
| 20260409130000_disputes_phase.sql | disputes.phase (inquiry/chargeback) |
| 20260411160000_normalize_dispute_type_to_reason_codes.sql | normalize pack template dispute_type codes |
| 20260411170000_cleanup_stale_pack_sections.sql | cleanup stale pack sections |
| 20260412120000_purge_orphan_legacy_rules.sql | purge orphan legacy rules |
| 20260412130000_dispute_reminder_sent_at.sql | disputes.reminder_sent_at |
| 20260412140000_shops_first_win_at.sql | shops.first_win_at |
| 20260413100000_dispute_events_and_normalized_status.sql | dispute_events ledger + disputes normalized status/submission/outcome columns |
| 20260425120000_disputes_customer_email.sql | `disputes.customer_email` — populated from Shopify `disputeEvidence.customerEmailAddress` in `syncDisputes`; required for argument route / jobs that select this column |
| 20260501100000_shop_daily_metrics.sql | `shop_daily_metrics(shop_id, date, order_count, dispute_count, chargeback_count, inquiry_count, last_synced_at)` — daily snapshot powering the dashboard chargeback-rate KPI and the admin Risk profile (PRD §5/§8/§9). Service-role-only RLS, mirrors the convention in `audit_events`. |
| 20260509130000_audit_events_cleanup_guc_and_orphan_wipe.sql | Relaxes the `audit_events` BEFORE-DELETE/UPDATE trigger to honour an `app.allow_audit_mutation = 'on'` session GUC, and wipes the 30 orphan E2E fixture disputes that had accumulated on the production project. See *E2E fixtures and audit immutability* below. |
| 20260509140000_e2e_fixture_cleanup_rpc.sql | `delete_e2e_fixture_dispute(uuid)` SECURITY DEFINER RPC — the only path E2E `cleanup()` and `npm run cleanup:e2e-orphans` use to delete audit/jobs/pack/dispute rows for fixture disputes. Refuses any `dispute_gid` that doesn't match the test pattern. |

### E2E fixtures and audit immutability

`004_audit_events.sql` made `audit_events` strictly append-only via two BEFORE triggers (`trg_audit_no_update`, `trg_audit_no_delete`) plus NO ACTION foreign keys to `disputes` and `evidence_packs`. The combination is intentional for prod data — audit history is unforgeable, and accidental deletes of a parent dispute fail loudly. But it also meant **once any audit event referenced a dispute or pack, that dispute/pack was undeletable** — including the seeded rows from the E2E fixture helper at [`e2e/helpers/dbFixtures.ts`](../e2e/helpers/dbFixtures.ts).

Because the DisputeDesk codebase shares one Supabase project across dev / E2E / prod (`sddzuglxdnkhcnjmcpbj`), every E2E run that hit `POST /api/packs/:id/save-to-shopify` (which writes audit events) was leaking the fixture dispute, pack, and audit rows into the live merchant dashboard — visible as ghost "Active disputes: 36" with empty order/customer cells. The original `cleanup()` swallowed FK violations silently, which masked the leak for weeks. **30 orphans** were discovered on 2026-05-09 and wiped via migration `20260509130000`.

The fix layers three guarantees:

1. **Trigger escape-hatch (migration 20260509130000).** `reject_audit_mutation()` now allows DELETE/UPDATE only when `current_setting('app.allow_audit_mutation', true) = 'on'`. App code never sets the GUC, so the immutability invariant still holds for normal traffic. Privileged paths set it for one transaction at a time.
2. **Cleanup RPC (migration 20260509140000).** `delete_e2e_fixture_dispute(uuid)` is the **only** way the test helper or recovery scripts reach audit_events. It is SECURITY DEFINER, scoped to `dispute_gid LIKE 'gid://shopify/ShopifyPaymentsDispute/test-%'` (refusing anything else with `raise exception`), and granted to `service_role` only. PostgREST clients cannot set GUCs from outside, so the RPC is the practical wrapper that flips the GUC and runs the deletes atomically.
3. **Prod-DB safety guard (`e2e/helpers/dbFixtures.ts:openSb`).** Refuses to seed when `SUPABASE_URL` points at the production project ref unless `E2E_ALLOW_PROD_DB=true` is explicitly set. Until a separate test Supabase project is provisioned, this opt-in is the structural defence against accidental fixture leaks.

**Recovery for crashed tests:** if a spec dies between seed and `cleanup()`, run `npm run cleanup:e2e-orphans` (dry-run) and `npm run cleanup:e2e-orphans -- --apply` to wipe via the same RPC. The script is idempotent and refuses to touch anything outside the test-fixture pattern.

**What this does NOT do:** it does not change the FK ON DELETE behaviour (still NO ACTION) and does not add CASCADE — cascading deletes would silently wipe audit history when a parent dispute is deleted by ordinary code, defeating the audit guarantee.

## Shopify Fraud Intelligence (Phase 1)

Positioning: **chargeback operations + merchant intelligence**, NOT fraud prevention. The layer surfaces Shopify's existing fraud analysis (risk levels, fraud-protection tier, fulfillment patterns) as historical context — it does **not** make checkout decisions, block orders, or attempt approval optimization. Copy throughout the embedded app must hold this distinction.

### Schema (migration `20260510150000_fraud_intelligence_orders.sql`)

Three tables + columns on `shops`:

- **`shopify_orders`** — one row per Shopify order, immutable risk snapshot. Carries the columns the dashboard, future timing analytics, and risk-to-dispute conversion all depend on:
  - identity: `shopify_order_id`, `shopify_order_number`, `shop_id`
  - timing: `processed_at`, `created_at_shopify`, `cancelled_at`, **`fulfilled_at`** (first fulfillment — load-bearing for "time-to-fulfillment after high-risk classification" intelligence)
  - geography: `country`, **`is_cross_border`**, **`distance_bucket`** (nullable freeform `local|regional|international|long_distance_domestic|…`; persisted at ingest so future cross-border analytics never re-derive from raw addresses)
  - money: `currency`, `order_total`, `payment_gateway`
  - status: `financial_status`, `fulfillment_status`, `cancel_reason`
  - **immutable risk snapshot:** `risk_level_initial`, `risk_recommendation_initial`, `risk_provider_initial` — enforced by `shopify_orders_lock_initial_risk_trg` (BEFORE UPDATE trigger raises `check_violation` if any of the three previously-set non-null values change). The trigger permits the `null → first-observed` transition, so backfill can populate the snapshot lazily.
  - fraud protection: `fraud_protection_level` (`fully_protected | partially_protected | not_protected | pending | not_eligible | not_available`)
  - denormalized chargeback flags: `has_chargeback`, `chargeback_type`, `chargeback_status` — reconciled by job from `disputes`, NEVER a substitute for it.
  - Indexes: `(shop_id, processed_at desc)`, `(shop_id, risk_level_initial) where risk_level_initial is not null`, `(shop_id, risk_level_initial) where has_chargeback`, `(processed_at)`.

- **`shopify_order_risk_assessments`** — many-to-one per `(shop, order, provider, snapshot_at)`. Mutable. Stores per-provider revisions; the dashboard reads the **latest** snapshot per `(order, provider)`. The immutable `risk_level_initial` on `shopify_orders` is the source of truth for "what Shopify thought at the time" — this table is the source of truth for "what Shopify thinks now."

- **`shop_fraud_daily_metrics(shop_id, date, …)`** — per-day rollup parallel to `shop_daily_metrics`. Powers the embedded fraud KPI row with O(1) window aggregation. Carries `orders_total`, `orders_low / orders_medium / orders_high / orders_none / orders_pending`, `orders_fulfilled_high_risk`, `fraud_disputes`, `total_disputes`, `chargebacks`, `fully_protected_value`, `eligible_protected_value`, `last_synced_at`. Acceptance-rate denominator = `orders_low + orders_medium`; `orders_none` and `orders_pending` are intentionally excluded and the dashboard tooltip **must** disclose this ("Acceptance rate is calculated from orders classified by Shopify as low or medium risk. Orders without completed fraud analysis are excluded.").

- **`shops.historical_import_*`** — backfill state machine that gates the onboarding banner:
  - `historical_import_status` ∈ `not_started | in_progress | complete | failed` (default `not_started`)
  - `historical_import_progress_pct` 0–100
  - `historical_import_since_date`, `historical_import_completed_at`
  - `historical_import_orders_total`, `historical_import_orders_processed`
  - `historical_import_scope_granted` ∈ `default_window | read_all_orders` — drives `historical_import_since_date` (60-day default vs full history)

All three new tables are service-role-only (RLS enabled, no policies — matches `shop_daily_metrics`).

### Onboarding banner copy contract

The dashboard insight banner only renders when `shops.historical_import_status = 'complete'`. Pre-completion the dashboard shows a neutral "Analyzing your order history…" progress card with processed/total counts.

Once complete, the banner leads with **insight, not verdict**:

- **Headline:** "We analyzed {N} historical Shopify orders."
- **Body:** "{X}% of recent orders were classified as high-risk by Shopify's fraud analysis. {Y}% of Shopify high-risk orders were still fulfilled. You can now monitor fraud-risk exposure, operational patterns, and dispute trends directly inside DisputeDesk."
- **Supporting metric (secondary hierarchy):** "Current chargeback health: {status}" — never the lead, never headline-weight.

Never lead onboarding with `Your chargeback health is At Risk` — banner must create curiosity and perceived value, not defensive reaction. CTAs: `View Risk Profile`, `Understand Chargeback Health`.

### Verification

`scripts/verify-fraud-intel-schema.mjs` (service-role; cleans up after itself) asserts: tables present, columns present (including `fulfilled_at`, `is_cross_border`, `distance_bucket`), `shops.historical_import_*` defaults applied, immutability trigger rejects all three `risk_*_initial` mutations, trigger permits `null → first observed` transition, `historical_import_status` check constraint enforced. Run after touching the migration.

### Backfill GraphQL query (`lib/shopify/queries/ordersForBackfill.ts`)

Separate from `ordersForSnapshot.ts` (which carries only `id|createdAt|test` and powers the cheap chargeback-rate bucketing). The backfill query carries the richer projection persisted to `shopify_orders`: identity (`id`, `name`), timing (`createdAt`, `processedAt`, `cancelledAt`, first-fulfillment `createdAt`), money (`totalPriceSet`, `paymentGatewayNames`), status (`displayFinancialStatus`, `displayFulfillmentStatus`, `cancelReason`), geography (`shippingAddress.countryCode`), and the fraud-signal projection: `shopifyProtect.status` plus `risk { recommendation, assessments { riskLevel, provider, facts } }`. `PAGE_SIZE = 100` (vs. 250 on the snapshot query) to keep cost-per-page within Shopify's 1000-bucket / 50-restore-rate budget after the risk + fulfillment expansion.

Defensive parsing: every nested object is typed as nullable even where the 2026-01 schema declares non-null. The `normalizeBackfillOrder` helper:
- **Picks the highest-severity risk level across all assessments** (`HIGH > MEDIUM > LOW > PENDING > NONE`) for `risk_level_initial`. The provider attached to that winning assessment becomes `risk_provider_initial`; falls back to `"shopify"` when blank/missing.
- **Leaves all three `risk_*_initial` fields null when no assessments are present** — never writes `NONE` as a stand-in. The immutability trigger relies on the null → first-observed transition; writing a synthetic NONE would lock real future assessments out.
- **`fraud_protection_level` stores raw `shopifyProtect.status`** (`PROTECTED | ACTIVE | PENDING | INACTIVE | NOT_PROTECTED`). The PRD's normalized vocabulary (`fully_protected | partially_protected | …`) is a future presentation-layer mapping, not a storage concern.
- **`is_cross_border`** is null when either the shipping country or the store country is unknown — never guessed. Compared case-insensitively.
- **`distance_bucket`** is null in v1; the column exists so future ingest passes can backfill it without a migration.

Pure helpers (`pickInitialRisk`, `pickFulfilledAt`, `normalizeBackfillOrder`) are unit-tested in `lib/shopify/queries/__tests__/ordersForBackfill.test.ts` (23 tests).

### Backfill orchestrator + job (`lib/disputes/backfillOrders.ts`, `lib/jobs/handlers/backfillOrdersJob.ts`)

`backfillShopOrders(shopId, opts)` is the orchestrator. One slice does the following:
1. **First-run bookkeeping** (when `opts.cursor` is null): reads the offline session's `scopes` string, classifies as `default_window` vs `read_all_orders` via `classifyScopeGrant`, persists `historical_import_scope_granted`, derives `historical_import_since_date` via `deriveSinceDate` (60 days back for default; `2010-01-01` anchor for `read_all_orders`), flips `historical_import_status` to `in_progress`.
2. **Store-country lookup** (one extra `shop { billingAddress { countryCodeV2 } }` GraphQL call per slice) so `normalizeBackfillOrder` can populate `is_cross_border`. Failure falls back to null — cross-border is best-effort.
3. **Page loop**: `fetchOrdersBackfillPage` until the soft time budget (`DEFAULT_SOFT_BUDGET_MS = 240_000` ms, leaves 60s headroom under `maxDuration = 300`s on `/api/jobs/worker`) is exhausted or the connection ends. Each page:
   - Normalizes via `normalizeBackfillOrder`.
   - `persistOrders` partitions incoming rows into INSERT (new GIDs) vs. UPDATE (existing GIDs). Updates exclude `risk_*_initial` so the immutability trigger never fires — the trigger would reject any rewrite, and re-asserting the same value is wasted work.
   - Risk-assessment rows are append-only: each page's assessments insert with a fresh `snapshot_at`, growing the per-`(shop, order, provider)` history naturally.
   - `shops.historical_import_orders_processed` is bumped after each page.
4. **Termination**: when `hasNextPage = false`, flips `historical_import_status = 'complete'`, writes `progress_pct = 100` + `orders_total = processed` + `completed_at = now()`. The dashboard banner gates on this status.
5. **Soft timeout**: returns `{ status: 'continue', nextCursor }`. The handler re-enqueues a `backfill_shop_orders` job with the cursor stashed in `entity_id`; the worker's per-shop concurrency cap (1) prevents the resumed job from racing the orchestrator's own writes.

`enqueueShopOrdersBackfill(shopId)` is the install hook (wired in Commit 5). Idempotent: skips when a backfill job is already queued/running, or when `historical_import_status` is already `complete`. Force-refresh path goes through the admin panel.

Failure path: any throw inside the orchestrator sets `historical_import_status = 'failed'` on the shops row, then re-throws so the worker's standard retry path can re-claim.

Pure helpers (`classifyScopeGrant`, `deriveSinceDate`, `tomorrowUtcIso`) are unit-tested in `lib/disputes/__tests__/backfillOrders.test.ts`.

### Fraud-rollup pipeline (`lib/disputes/snapshotFraudDailyMetrics.ts`)

`snapshotFraudDailyMetrics(shopId, dateIso)` is the per-day aggregator. **Does not call Shopify** — all source data is local: `shopify_orders` (populated by the backfill orchestrator) plus `disputes` (kept fresh by the existing 5-minute `sync_disputes` cron). One pass over each table for the UTC date, then a single upsert on `shop_fraud_daily_metrics(shop_id, date)`.

Bucket semantics that the dashboard tooltip copy commits to:
- `orders_total`: rows whose `processed_at` (or `created_at_shopify` fallback when null) falls inside the UTC day.
- `orders_low / medium / high / none / pending`: bucketed by `risk_level_initial`. **`null` risk_level_initial buckets as `none`, not `pending`** — pending is reserved for orders Shopify explicitly returned as `PENDING`. The acceptance-rate denominator is `low + medium`; `none + pending` are excluded and the tooltip must disclose this.
- `orders_fulfilled_high_risk`: subset of `orders_high` where `fulfillment_status` ∈ `{FULFILLED, PARTIAL, PARTIALLY_FULFILLED}`. Drives the high-risk fulfillment-rate KPI (critical metric per PRD §13).
- `fraud_disputes`: count of disputes initiated on this UTC day with `reason = 'FRAUDULENT'` (Shopify's canonical code post the 2026-04 normalization migration).
- `chargebacks`: subset of total disputes with `phase = 'chargeback'`.
- `fully_protected_value`: sum of `order_total` where `fraud_protection_level = 'PROTECTED'`.
- `eligible_protected_value`: sum of `order_total` where `fraud_protection_level` ∈ `{PROTECTED, ACTIVE, PENDING}` — orders Shopify Protect could underwrite if a chargeback lands.

`backfillFraudDailyMetrics(shopId)` is the bulk-backfill path: bounded scan of distinct UTC dates with rows in `shopify_orders`, snapshot each one. Triggered automatically by the order-backfill orchestrator when it flips `historical_import_status = 'complete'` — guarantees the dashboard window selectors have rollup data the moment the banner unlocks.

Cron + handlers:
- **`/api/cron/snapshot-fraud-daily-metrics`** — Vercel Cron `45 0 * * *` (00:45 UTC, 15 min after `snapshot-daily-metrics` to avoid contention). Enqueues `snapshot_fraud_daily_metrics(shop, yesterday)` per active shop with `historical_import_status = 'complete'`. Idempotent against in-flight (shop, date) jobs.
- **`snapshot_fraud_daily_metrics` job** — single-day; entity_id is the date, falls back to yesterday UTC when absent.
- **`backfill_fraud_daily_metrics` job** — one-shot bulk backfill chained from order-backfill completion. Bounded by `maxDuration=300s` on the worker.

Pure helpers (`aggregateOrderCounts`) are unit-tested in `lib/disputes/__tests__/snapshotFraudDailyMetrics.test.ts` (10 tests pinning risk-bucketing, high-risk fulfillment counting, Protect coverage value math).

### Install hook

`/api/auth/shopify/callback` (offline phase) fires `enqueueShopOrdersBackfill(shopInternalId)` alongside the existing `enqueueShopDailyMetricsBackfill`. Fire-and-forget — backfill runs in the worker, not on the OAuth request path. Idempotent: skips when a backfill job is already queued/running or when `historical_import_status = 'complete'`.

The new scope `read_all_orders` was added to `shopify.app.toml` and `.env.example` (the drift-guard test enforces both stay in sync). Until Partners-side approval for Protected Customer Data lands, `classifyScopeGrant` resolves the offline session's actual granted scopes string and falls back to the default 60-day window automatically — the code path is scope-aware so we ship without blocking on App Review.

### Embedded dashboard panel (`app/(embedded)/app/DashboardFraudIntelligence.tsx`)

A single Polaris Card slotted between `DashboardKpis` and the recent-disputes preview. Self-contained — fetches its own data from `/api/dashboard/fraud-metrics?window=30d|90d|365d|all` so it does not disturb the existing `stats` flow on `/api/dashboard/stats`.

State machine (driven by `shops.historical_import_status`):
- `not_started` / `in_progress` → progress card with the moving order count ("We've analyzed N orders so far…"). **KPIs are hidden — we never show partial numbers during backfill.**
- `failed` → snag-state banner with retry guidance.
- `complete` → KPI grid with six tiles:
  - **Acceptance rate** = (low + medium) ÷ (total − none − pending). Tooltip discloses the NONE + PENDING exclusion verbatim.
  - **High-risk orders** = high ÷ total.
  - **Fraud dispute rate** = fraud disputes ÷ total orders.
  - **High-risk fulfilled** = orders fulfilled with `risk_level_initial = HIGH` ÷ `orders_high`. PRD §13 flags this as a critical operational signal.
  - **Shopify Protect coverage** = fully-protected value ÷ eligible-protected value.
  - **Orders analyzed** = total orders in the window.

Each KPI carries an `available` boolean — false when its denominator is zero so the UI renders `—` instead of a misleading `0.0%`. Window selector is a Polaris `Select`; default `90d` per PRD §9. Rate rounding uses 1 decimal place (matches `chargebackRate.ts`).

API: `GET /api/dashboard/fraud-metrics` reads exclusively from `shop_fraud_daily_metrics` plus three columns on `shops` — no Shopify fan-out, no `shopify_orders` table scans on the hot path.

i18n: the `fraudIntel` namespace is injected into all 12 locale files (`scripts/inject-fraud-intel-i18n.mjs`) with an English baseline. Native-language translation is a follow-up pass; the script is idempotent so re-running it after translation merges only fills missing keys.

### Insight banner + Initial Analysis page

**Banner** (`DashboardInitialAnalysisBannerWrapper` in `DashboardInitialAnalysisBanner.tsx`) renders ONLY when `historical_import_status = 'complete'`. Dismissible via localStorage (`dd_fraud_intel_banner_dismissed`); the permanent home is `/app/insights/initial-analysis`.

Copy contract — load-bearing, must not regress:
- Headline LEADS with insight: `"We analyzed {count} historical Shopify orders."` — never with the chargeback-health verdict.
- Body cites concrete percentages from the data: `"{X}% of recent orders were classified as high-risk by Shopify's fraud analysis. {Y}% of Shopify high-risk orders were still fulfilled. You can now monitor fraud-risk exposure, operational patterns, and dispute trends directly inside DisputeDesk."`
- Chargeback-health is a SECONDARY/SUPPORTING line, lower visual hierarchy: `"Current chargeback health: {status}"` rendered with `variant="bodySm" tone="subdued"`. Never headline weight.
- CTAs: `View Risk Profile` (primary) and `Understand Chargeback Health` (deep-link to `#chargeback-health`).

The PRD's original "Your current chargeback health is At Risk" as the dominant onboarding message was explicitly rejected — the banner must create curiosity and perceived value, not defensive reaction. `classifyChargebackHealth` (pure, exported for tests) buckets `<0.40% → good`, `0.40–0.60% → at_risk`, `>0.60% → elevated`.

**`/app/insights/initial-analysis` page** (titled **"Chargeback Exposure"** in the merchant UI as of 2026-05-11; renamed from "Risk Intelligence" to avoid the fraud-prevention framing that would attract Riskified/Signifyd/NoFraud expectations DisputeDesk does not own). Always reachable; banner dismiss does not hide it. Linked from the embedded sidebar as **"Insights"** (`nav.insights`) — generic label reserves room for sub-pages (Trends, Benchmarking) without another rename.

Hierarchy (operational behavior is the hero, Shopify's classification is supporting context):
1. Hero — orders analyzed + leading observation.
2. KPI strips — three thematic cards in this order: **Delivery operations** (median fulfill, high-risk fulfilled, confirmed delivery, signed-for) → **Payment verification** (3-DS auth, Protect coverage) → **Fraud-risk profile** (acceptance, high-risk, fraud-dispute rate). Each KPI tile carries an info-icon tooltip explaining the metric in 1–2 sentences. Reads as the interpretation layer, not a Shopify wrapper.
3. **Operational Checkpoints** — rule-engine output (see below).
4. Risk classification breakdown — stacked bar always visible; per-bucket prose lives behind a "Show classification details" disclosure to reduce visual weight.
5. Two-column row — risk-to-dispute correlation chart + chargeback-health gauge.
6. "What this means" footer.

Color severity is intentionally softened: HIGH risk is amber-orange (`#F97316`), not red. True red (`#DC2626`) is reserved for actual network-threshold breaches (the gauge "elevated" band, breach-severity checkpoint rows).

API: `GET /api/dashboard/insights/initial-analysis` bundles everything the banner + page need — historical totals, 90d fraud-rollup percentages, 90d chargeback rate + classified health, risk breakdown, and import state. Single endpoint, single fetch per surface.

### Operational Checkpoints

Rule-engine layer in `lib/insights/checkpoints.ts` that turns the already-computed page metrics into a sorted, capped list of sourced observations. Every rule emits a severity in `{healthy | info | consider | breach}`; the UI sorts by severity (most urgent first, ties resolve by declaration order) and caps at 5 visible.

**Network-rule citations** (verified 2026-05-11, scheduled recheck 2026-08-11):
- **Visa VAMP** (effective April 1, 2026): merchant Excessive ratio **1.5%** (count-based, CNP). Approaching band: **0.9–1.5%**. Fine at Excessive: $8 per disputed/fraudulent transaction. [Visa fact sheet](https://corporate.visa.com/content/dam/VCOM/corporate/visa-perspectives/security-and-trust/documents/visa-acquirer-monitoring-program-fact-sheet-2025.pdf).
- **Mastercard ECM**: **1.5%** chargeback-to-transaction ratio AND **100+** chargebacks/month. **HECM**: 3.0% + 300/month. [Mastercard ECP guide](https://www.jpmorgan.com/content/dam/jpm/merchant-services/payment-network-updates/documents/mastercard-excessive-chargeback-program-guide.pdf).
- **Visa 3-DS liability shift**: authenticated CNP payments shift fraud-chargeback liability to the issuer.

**Not cited**: Visa CE3.0. CE3.0 is about *historical-footprint matching* (two prior transactions 120–365 days old, two matching data points incl. IP or device ID) — not about signature confirmation. Signature is general delivery evidence under traditional CNP rules and is cited as such, not as a CE3.0 requirement.

**Own-baseline observations** (DisputeDesk heuristics, not network rules): high-risk-fulfilled ≥50% → `consider`; signature-rate <30% → `consider`; 3-DS rate ≥25% → `healthy`, <10% → `consider`; Protect coverage <20% → `info`; median fulfillment regressed ≥12 h → `consider`, improved ≥6 h → `healthy`.

**RECHECK_RULES**: Card networks refresh these thresholds periodically (VAMP changed materially in April 2025 and again April 2026). Schedule a quarterly source-recheck and update the constants in `lib/insights/checkpoints.ts` if any threshold moves. Last verified date is held in the file header.

Tests: `lib/insights/__tests__/checkpoints.test.ts` — 19 cases covering boundary transitions, sort order, the top-5 cap, and a surasvenne dev-shop sanity test (must never emit a `breach` for realistic dev-shop numbers).

### Scope-upgrade nudge (`DashboardScopeUpgradeBanner`)

Re-OAuth banner for installs that pre-date the `read_all_orders` grant (Shopify approved 2026-05-10). The endpoint exposes `currentScopeGrant` derived from the live offline session's scopes string (not the persisted `historical_import_scope_granted` column, which captures the grant as of the last backfill). The banner renders when:
- `historicalImportStatus === 'complete'` (don't pile a re-auth ask on top of an active backfill), AND
- `currentScopeGrant === 'default_window'` (the merchant has the narrow grant in their current session).

Clicking the CTA navigates the **top frame** (`window.top.location.href`) to `/api/auth/shopify?phase=offline&shop=<domain>`. The Shopify consent screen would be blocked by `X-Frame-Options` inside the embedded iframe, so the breakout is required.

After re-OAuth, `resetBackfillIfScopeUpgraded` (in `lib/disputes/backfillOrders.ts`) fires in the callback. It detects the upgrade (new scopes include `read_all_orders`, prior backfill ran under `default_window`, `historical_import_status='complete'`) and resets the import state to `not_started`. The standard `enqueueShopOrdersBackfill` call that follows then runs a fresh wider-window backfill. Idempotent — no-op on first install, re-installs without scope change, and in-flight backfills (those let their own first-run bookkeeping pick up the new scopes).

Banner dismissal: localStorage flag `dd_scope_upgrade_banner_dismissed`. Per-device "remind me later" — no server-side state.

## Dispute History & Timeline (Phase 1)

Merchant-facing event ledger and normalized status model for dispute lifecycle tracking.

### dispute_events table

Append-only, immutable ledger (DB triggers reject UPDATE/DELETE). Each event has:
- `event_type` — canonical identity (UI localizes from `disputeTimeline.eventTypes.{type}`)
- `actor_type` — merchant_user, disputedesk_system, disputedesk_admin, shopify, external_unknown
- `source_type` — system, user_action, pack_engine, shopify_sync, admin_override, webhook, manual_entry
- `visibility` — merchant_and_internal (default) or internal_only
- `dedupe_key` — UNIQUE constraint for idempotent emission (safe retries, reruns, backfills)

### Normalized status model

Snapshot columns on `disputes` for fast rendering without recalculating from events:
- `normalized_status` — new, in_progress, needs_review, ready_to_submit, action_needed, submitted, submitted_to_shopify, waiting_on_issuer, submitted_to_bank, won, lost, accepted_not_contested, closed_other
- `submission_state` — not_saved, saved_to_shopify, submitted_confirmed, submission_uncertain, manual_submission_reported
- `final_outcome` — won, lost, partially_won, accepted, refunded, canceled, expired, closed_other, unknown

**Merchant-facing status naming:**
- `submitted_to_shopify` — evidence has been saved to the Shopify dispute (`submission_state = saved_to_shopify`). Shopify auto-submits at the deadline if the merchant doesn't click Submit in Shopify Admin first, so this is treated as a commit (info tone, not warning). Replaces the old `action_needed` branch for this submission state.
- `submitted_to_bank` — Shopify has forwarded the representment to the card network (raw `status = under_review`). Replaces the jargony `waiting_on_issuer` label. The legacy `waiting_on_issuer` enum value is retained for backwards compat but is no longer emitted by active derivation.
- `action_needed` still fires for genuine problems: `submission_state = submission_uncertain` or a blocked pack.

**Key rule:** "submitted" (confirmed by Shopify `evidenceSentOn` or merchant self-report) is distinct from `submitted_to_shopify` (evidence saved but not yet confirmed/forwarded).

### Event emission points

- `syncDisputes()` — dispute_opened, status_changed, due_date_changed, outcome_detected, dispute_closed, submission_confirmed
- `runAutomationPipeline()` — auto_build_triggered, auto_save_triggered, parked_for_review, pack_blocked
- `handleBuildPack()` — pack_created, pack_build_failed (internal_only)
- `handleSaveToShopify()` — evidence_saved_to_shopify, evidence_save_failed (internal_only)
- `handleRenderPdf()` — pdf_rendered
- `POST /api/disputes/:id/approve` — merchant_approved_for_save

### Timeline API

`GET /api/disputes/:id/timeline` — returns events + summary snapshot. Internal-only events require verified admin/support role via Supabase auth.

### Phase 3 additions

- `dispute_notes` table — support notes with visibility control (merchant_and_internal / internal_only)
- `has_admin_override` + `overridden_fields` columns on disputes — tracks which fields were manually set by admin
- Overrides are a separate layer: resyncs skip overridden fields, admin can clear overrides to restore sync behavior

### Phase 3 API routes

- `GET/POST /api/disputes/:id/notes` — support notes (admin/support auth)
- `POST /api/admin/disputes/:id/override` — admin field override with snapshot consistency (admin auth)
- `POST /api/disputes/:id/resync` — single-dispute resync respecting override locks (admin/support auth)
- `GET /api/admin/disputes` — cross-shop disputes list with note_count and override indicators (admin auth)

### Phase 3 event types

- `support_note_added`, `admin_override`, `admin_override_cleared`, `dispute_resynced` (all internal_only)

### Shared metrics layer

- `lib/disputes/metrics.ts` — `computeDisputeMetrics({ shopId?, periodFrom?, periodTo? })`. Single source of truth for both merchant and admin dashboards. Shop-scoped when shopId provided, cross-shop when omitted. Admin-only fields (overriddenCount, syncIssueCount, disputesWithNotesCount) populated only for cross-shop queries.

### Key modules

- `lib/disputeEvents/` — emitEvent, normalizeStatus, deriveFinalOutcome, updateNormalizedStatus, eventTypes, types
- `lib/disputes/metrics.ts` — shared dispute metrics aggregation

## Network Reason Code Resolution (LSE-0)

Shopify Admin GraphQL **2026-01 exposes only the coarse 14-value
`ShopifyPaymentsDisputeReason` enum** on `Dispute.reasonDetails.reason`
(`FRAUDULENT`, `PRODUCT_NOT_RECEIVED`, `SUBSCRIPTION_CANCELED`, …). There
is no typed `networkReasonCode` field. The Liability-Shift Engine
(EPIC-LSE-0 through EPIC-LSE-6, PRD: [`docs/liability-shift-engine-prd.md`](liability-shift-engine-prd.md))
needs the underlying Visa / Mastercard network code (e.g. `10.4`, `4837`)
to detect CE 3.0 eligibility, FPT eligibility, and to pick more specific
rebuttal templates and evidence checklists than the coarse enum allows.

### Confidence chain

The resolver in [`lib/disputes/networkReasonCode.ts`](../lib/disputes/networkReasonCode.ts) returns one of four confidence levels:

| Confidence | Source | When it fires |
|------------|--------|---------------|
| `direct` | `shopify_dispute_field` | Future-proofing only — Shopify does not currently expose this field. Architecture is in place for a one-line change when they do. |
| `derived` | `shopify_receipt_json` | Shopify Payments orders only. Parses `OrderTransaction.receiptJson` defensively for `dispute.network_reason_code`, `network_reason_code`, `failure_code`, etc. Rare in practice — the contract is gateway-specific and explicitly "not stable" per the same 3-D Secure caveats. |
| `inferred` | `enum_inference` | The workhorse. Maps `(ShopifyPaymentsDisputeReason, CardNetwork)` → best-guess network code via the table in `networkReasonCode.ts`. Visa + Mastercard only; Amex / Discover fall through to `unknown` for v1. |
| `unknown` | `unresolved` | Card network missing, Shopify enum missing, or enum has no merchant-side mapping (e.g. `INSUFFICIENT_FUNDS`). Downstream consumers fall back to the coarse Shopify enum. |

The verification spike confirmed `direct` is unreachable in API version 2026-01, so `inferred` carries the load. `derived` is best-effort and never required.

### Catalog

The canonical reason-code catalog lives in [`lib/disputes/reasonCodeCatalog.ts`](../lib/disputes/reasonCodeCatalog.ts) as a code-first TypeScript constant (not a runtime DB table — changes go through PR review). Each entry carries:

- `code` + `network` + `family` (`fraud` / `authorization` / `processing_error` / `consumer_dispute` / `fpt_eligible` / `ce30_eligible`)
- `shortName` + `description` (English source; localized via `i18nKey`)
- `rebuttalTemplateKey` + `evidenceChecklistKey` for downstream consumers
- `shopifyEnumFallbacks` — which `ShopifyPaymentsDisputeReason` values most commonly collapse here (drives the inference fallback)
- `introducedDate` / `retiredDate` for audit

V1 ships ~30 entries (Visa 10.1–10.5, 11.1–11.3, 12.1–12.7, 13.1–13.9; Mastercard 4807, 4808, 4812, 4831, 4834, 4837 [FPT], 4841, 4842, 4846, 4849, 4853, 4854, 4855, 4859, 4860, 4863 [FPT], 4870, 4871, 4999). Catalog `CATALOG_VERSION` bumps on each rule-update pass; current as of `2026-05-01` (Visa Core Rules Oct 2025 / Mastercard Chargeback Guide Jun 2025).

### Persistence

Migration `20260514120000_disputes_network_reason_code.sql` adds three columns to `disputes`:

| Column | Type | Notes |
|--------|------|-------|
| `network_reason_code` | text | e.g. `10.4`, `4837`. Null when card network unknown or enum has no mapping. |
| `network_reason_code_confidence` | text | Constrained to `direct | derived | inferred | unknown`. |
| `network_reason_code_resolved_at` | timestamptz | Last resolver write. |

Index: `(shop_id, network_reason_code)` partial WHERE NOT NULL.

### Enrichment hook

Resolution happens during pack build, **not** during sync — the sync path doesn't fetch order transactions, so it has no card-network signal. The enrichment helper [`lib/disputes/enrichNetworkReasonCode.ts`](../lib/disputes/enrichNetworkReasonCode.ts) is called by [`lib/packs/buildPack.ts`](../lib/packs/buildPack.ts) immediately after the order GraphQL fetch, with full context (network from `OrderTransaction.paymentDetails.company`, receiptJson from `OrderTransaction.receiptJson` if `gateway === "shopify_payments"`, refund signal from `Order.totalRefundedSet`).

Enrichment failures are non-fatal — a failed persist logs a warning and falls through, leaving the dispute with whatever the previous resolver write set (or NULL).

### Downstream consumers (planned)

- **LSE-1 CE 3.0 qualification** reads `network_reason_code` to detect Visa 10.4
- **LSE-3 FPT readiness** reads it to detect Mastercard 4837 / 4863
- **Rebuttal engine** (`lib/argument/rebuttalReason.ts`) will be extended to switch on the network code when present, falling back to the Shopify enum when null. Extension lands with LSE-1.
- **Completeness engine** will be extended to use code-specific evidence checklists (e.g. Visa 13.1 vs 13.2 vs 13.3 each ask for different proofs). Extension lands with LSE-1.

### Open questions

Tracked in [`docs/epics/EPIC-LSE-0-reason-codes.md`](epics/EPIC-LSE-0-reason-codes.md) §Open questions. The biggest is whether a future Shopify API version exposes a typed `networkReasonCode` field — re-verify on each API version bump.

## CE 3.0 Qualification Engine (LSE-1)

For every Visa dispute on reason code 10.4, decide whether the dispute would qualify for **Visa Compelling Evidence 3.0** liability shift, via one of three branches (auto-qualified / initial-billing / standard). Persists verdict to `dispute_qualifications`. Source PRD: [`docs/liability-shift-engine-prd.md`](liability-shift-engine-prd.md) §4. Epic: [`docs/epics/EPIC-LSE-1-qualification-engine.md`](epics/EPIC-LSE-1-qualification-engine.md).

Built per primary-source research against Verifi (Visa-owned), Visa public PDFs, Checkout.com, and cside.com on 2026-05-14. Three findings shaped the implementation:

1. **October 17, 2025 — Visa Secure auto-qualification.** Visa now auto-pre-qualifies any Visa-Secure-authenticated or Visa-Data-Only transaction. Per-qualification fee starts April 17, 2026.
2. **Subscription / MIT — initial billing exception.** Recurring billings where IP/device legitimately differ between bills may use the initial subscription billing transaction as the matching anchor.
3. **Operational matching strictness.** Acquirers enforce tighter matching than the rule allows: shipping defaults to exact match (normalized fallback flagged), IP allows /24-subnet fallback (also flagged), device fingerprints must be deterministic.

### Six verdict states

| Verdict | Meaning | Branch |
|---------|---------|--------|
| `qualifies_network_prequalified` | Visa auto-qualified via 3DS (since 2025-10-17) | `auto_qualified` |
| `qualifies_via_initial_billing` | Recurring/MIT order matched against initial subscription billing | `initial_billing` |
| `qualifies` | Standard CE 3.0 — 2 priors in window + 2 matches incl. IP/Device anchor | `standard` |
| `partial` | Close but missing one gate (1 prior, no anchor, etc.) | `none` |
| `does_not_qualify` | Cleanly fails a gate (window, no anchor, etc.) | `none` |
| `not_applicable` | Wrong network / wrong reason code / no card-network signal | `none` |

### Pipeline integration

Resolution runs from [`lib/packs/buildPack.ts`](../lib/packs/buildPack.ts) immediately after the LSE-0 enrichment, so the qualification engine has both the resolved `network_reason_code` and the full disputed-order GraphQL detail to work with:

```
dispute synced → runAutomationPipeline → build_pack job
                                              │
                                              ▼
                            order fetched (ORDER_DETAIL_QUERY)
                                              │
                                              ▼
                            LSE-0: enrichDisputeWithNetworkReasonCode
                                              │
                                              ▼
                            LSE-1: evaluateQualification
                              ├─ map order → QualificationOrder
                              ├─ Branch 1: 3DS auto-qualified?
                              ├─ Branch 2: subscription? → fetch initial billing
                              ├─ Branch 3: standard → fetch priors via
                              │            customer.orders GraphQL query,
                              │            date-filtered server-side to
                              │            120–365 day window
                              └─ persist verdict to dispute_qualifications
                                              │
                                              ▼
                            existing evidence collectors run
```

Enrichment + qualification are both **non-fatal** — failures log but never block pack build.

### Modules

| File | Purpose |
|------|---------|
| [`lib/liabilityShift/types.ts`](../lib/liabilityShift/types.ts) | Verdict / branch / match-point / confidence types + window constants |
| [`lib/liabilityShift/matching.ts`](../lib/liabilityShift/matching.ts) | Field-level matchers (IP, device, shipping, account) with strength signals |
| [`lib/liabilityShift/autoQualified.ts`](../lib/liabilityShift/autoQualified.ts) | Branch 1: Visa Secure / Data Only detection + April 2026 fee flag |
| [`lib/liabilityShift/priors.ts`](../lib/liabilityShift/priors.ts) | Pure filtering: 120–365 day window, undisputed, non-refunded, non-validation; plus initial-subscription-billing picker |
| [`lib/liabilityShift/fetchPriors.ts`](../lib/liabilityShift/fetchPriors.ts) | Shopify `customer.orders` GraphQL fetch + mapping into `QualificationOrder` |
| [`lib/liabilityShift/qualifyCE30.ts`](../lib/liabilityShift/qualifyCE30.ts) | Orchestrator: gates → Branch 1 → Branch 2 → Branch 3 → verdict |
| [`lib/liabilityShift/evaluateQualification.ts`](../lib/liabilityShift/evaluateQualification.ts) | Pipeline integration: derives 3DS state from receiptJson, fetches priors, persists verdict |

### Shopify queries

The customer-orders fetch uses a focused query (`lib/shopify/queries/customerOrdersForCE30.ts`) — date filtering is server-side via Shopify's order-search syntax (`created_at:>= … created_at:<= … financial_status:paid`). Field selection deliberately excludes per-prior transactions and receiptJson — those are expensive to fetch across 50 priors and not needed for the standard branch's matching logic. Device fingerprints come from LSE-4's checkout_sessions table when available.

The disputed order's `ORDER_DETAIL_QUERY` was expanded with `customer { id }` (for the customer-orders fetch) and the full shipping/billing address shape (`address1`, `address2`, `province`, `country`) for tight matching.

### Match strength signals

The matcher returns a `MatchStrength` per field — `exact`, `normalized`, `subnet`, or `none`. Non-exact matches surface in `confidence_reasons` so the merchant UI can communicate the qualification's strength:

- `ip_match:subnet_only` — /24 subnet match, weaker than exact-IP
- `shipping_match:normalized_only` — matched after libpostal-style normalization
- `device_match:fingerprint_too_short` — fingerprint rejected as non-deterministic
- `guest_checkout` — no customer ID; matched on email + IP + shipping
- `single_anchor` — only one of IP/device matched, not both

### API + UI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/disputes/:id/qualification` | Returns the verdict + machine-readable match/confidence reasons. Pending sentinel when the verdict hasn't been computed yet. |

UI surface: [`components/liability-shift/LiabilityShiftPanel.tsx`](../components/liability-shift/LiabilityShiftPanel.tsx) — client component mounted in the embedded dispute Overview tab. Renders null when CE 3.0 is not applicable. i18n namespace `liabilityShift.*` translated across all 6 BCP-47 locales (en-US, pt-BR, es-ES, fr-FR, de-DE, sv-SE).

### Schema

Migration `20260514130000_dispute_qualifications.sql` creates the `dispute_qualifications` table. Service-role-only access (matches `disputes` / `evidence_packs` policy — RLS is defense-in-depth, all writes go through the pipeline).

Key columns:
- `ce30_status` — one of six verdict states (CHECK-constrained)
- `ce30_branch` — `auto_qualified | initial_billing | standard | none`
- `ce30_auto_qualification_via` — `visa_secure | visa_data_only | merchant_confirmed`
- `auto_qualification_fee_applies` — true when verdict is auto-qualified AND disputed transaction is on or after 2026-04-17
- `confidence_reasons` — machine codes (see "Match strength signals" above)
- `missing_evidence` — machine codes for partial-state UI

Unique index `(shop_id, shopify_dispute_id)` enables upsert on re-evaluation.

## CE 3.0 Evidence Package + Submission Router (LSE-2)

Generates Visa-CE-3.0-formatted PDF evidence packages from LSE-1 qualifying verdicts and routes them through the best channel available today: Shopify dispute API as best-effort (`uncategorized_text` summary + `uncategorized_file` PDF) plus a manual-acquirer-handoff workflow. Direct Verifi submission is LSE-6 (partnership-gated).

Source: [`docs/epics/EPIC-LSE-2-evidence-package.md`](epics/EPIC-LSE-2-evidence-package.md).

### Modules
- [`lib/liabilityShift/packageTemplates.ts`](../lib/liabilityShift/packageTemplates.ts) — verdict → strongly-typed `CE30PackageData` (cover / branch-specific evidence body / merchant statement). Localized statement (EN + PT-BR shipped, other locales English fallback per PRD §10 Phase 2).
- [`lib/packs/pdf/CE30PackDocument.tsx`](../lib/packs/pdf/CE30PackDocument.tsx) — React-PDF document (3 pages: cover + evidence table + statement) consuming `CE30PackageData`. Visual match indicators on the qualification table (✓ where matched).
- [`lib/liabilityShift/submissionRouter.ts`](../lib/liabilityShift/submissionRouter.ts) — decides channel activation per shop settings + verdict; never auto-claims "submitted to Visa" — only "package attached via Shopify dispute API."
- Outcome tracking: `recordOutcomeForPack(packId, outcome)` updates `submission_logs.final_outcome` from `pending` to the eventual `won` / `lost` / `withdrawn`.

### Submission strategy (v1)
For every qualifying verdict, both channels can fire in parallel:
1. **`shopify_dispute_api`** (default on) — attach PDF to evidence_pack, the existing `saveToShopifyJob` will deliver it via `uncategorized_file` + a structured summary in `uncategorized_text`.
2. **`manual_acquirer`** (default on) — surface download link + acquirer-upload instructions in the merchant UI; merchant marks the upload via `POST /api/packs/:id/mark-submitted` (LSE-2 endpoint).

`submission_logs` records both as `pending` and tracks the final outcome — the data we need to answer "is best-effort via Shopify worth it vs. manual upload?" — which is the input to the LSE-6 partnership-investment decision.

### Schema
Migration `20260514140000_lse2_evidence_and_submissions.sql`:
- Extends `evidence_packs` with `package_type` (`standard_representment` | `ce_30` | `fpt`), `template_version`, `qualification_id`, `language`.
- Creates `submission_logs` (one row per `(evidence_pack, channel)`, unique-indexed; tracks `confirmation_id`, `raw_response`, `final_outcome` enum, `retry_count`).
- Adds `shop_settings.lse_auto_submit_ce30_via_shopify` (default true) and `lse_show_manual_handoff_instructions` (default true).

### Coverage gate
Coverage gate (CLAUDE.md non-negotiable) still short-circuits before any LSE-2 work — covered disputes do not receive a CE 3.0 package.

## Mastercard FPT Readiness (LSE-3)

Mirrors LSE-1 for the Mastercard side. Reason-code allowlist + region gate + three-category scoring (Device, Delivery, Identity) determines FPT readiness for first-party-fraud disputes (reason codes **4837** "No Cardholder Authorization" and **4863** "Cardholder Does Not Recognize").

Source: [`docs/epics/EPIC-LSE-3-fpt-readiness.md`](epics/EPIC-LSE-3-fpt-readiness.md).

### Region eligibility ([`lib/liabilityShift/fptRegions.ts`](../lib/liabilityShift/fptRegions.ts))
- **US** — since 2024-10-01 (full availability after 2023 pilot)
- **Canada, LATAM, Caribbean, APAC** — since 2025-06-01 (global rollout)
- **EU** — not yet (TBD by Mastercard)

A dispute in an eligible region whose *disputed transaction date* is before the region's launch date returns `not_applicable` with reason `region_pre_launch:<region>:before:<date>`.

### Three-category scoring ([`lib/liabilityShift/fptCategories.ts`](../lib/liabilityShift/fptCategories.ts))
- **Device** — IP, device fingerprint (when LSE-4 data exists), 3DS authentication, session duration. Score 0–1.
- **Delivery** — Shipping address presence, delivery confirmation, digital-goods + account combo. Score 0–1.
- **Identity** — Customer account, customer tenure (90+/30+ day bands), repeat-customer signal (prior order count), email presence. Score 0–1.

Verdict (in [`qualifyFPT.ts`](../lib/liabilityShift/qualifyFPT.ts)):
- All three category scores > 0 AND sum ≥ 2.0 → `ready` (high confidence when sum ≥ 2.5, medium otherwise)
- All positive but sum 1.2–2.0 → `partial` with `overall_too_weak`
- Any category score = 0 → `partial` with `<category>_category_empty`
- All positive but sum < 1.2 → `not_ready`

Thresholds intentionally conservative — `FPT_READY_TOTAL_THRESHOLD` is encoded in code so calibrating against real outcome data is a config change, not a logic change.

### Reason-code allowlist
[`lib/disputes/reasonCodeCatalog.ts`](../lib/disputes/reasonCodeCatalog.ts) marks 4837 and 4863 with `family: "fpt_eligible"`. `isFPTEligibleCode(network, code)` is the gate.

## Storefront Session Capture (LSE-4)

Privacy-safe v1 session capture across **two zero-config storefront surfaces** — Web Pixel + Checkout UI extension — joined to orders via `cart_token`. Used by LSE-1 / LSE-3 to match IP, device, and login state across the disputed order and priors.

Source: [`docs/epics/EPIC-LSE-4-session-capture.md`](epics/EPIC-LSE-4-session-capture.md).

### Zero-config merchant install

No theme app embed, no merchant-pasted shop ID, no settings page. The Web Pixel and Checkout UI extension auto-install with the app, identify the merchant by `shop_domain` (which every Shopify surface exposes at runtime), and the server resolves to `shops.id` via [`resolveShopFromDomain.ts`](../lib/liabilityShift/sessions/resolveShopFromDomain.ts) with a 60-second cache.

| Surface | When it fires | Merchant install action |
|---------|---------------|-------------------------|
| **Web Pixel** | Every `page_viewed`, `checkout_started`, `checkout_completed` | Auto-installs with the app |
| **Checkout UI extension** | At checkout step (authoritative login state + cart_token) | Auto-installs; `network_access` approved at OAuth screen |

A previous theme-app-embed surface was removed — the Web Pixel covers what it captured, with the merchant-friendly bonus of zero theme-editor configuration.

### v1 capture set (privacy-safe)
`cart_token`, `session_started_at`, `user_agent`, IP (hashed + encrypted), IP-derived geo (country + region only), `customer_id`, account age, login state at checkout, page-view history, time on checkout page, DNT / GPC consent signals. **Never** captures form input values. Device fingerprinting deferred to a future v2 epic under legal review.

`customer_account_age_days` is enriched server-side via the Shopify Admin API ([`enrichCustomerTenure.ts`](../lib/liabilityShift/sessions/enrichCustomerTenure.ts), 1-hour cache per shop+customer) — neither storefront surface exposes `customer.createdAt` directly.

### Privacy controls
- **DNT and GPC** honored at the server boundary (request headers OR body) — defense against malicious or buggy storefront installs
- **IP hashing** — sha256(salt + IP) for query-time matching; raw IP encrypted via AES-256-GCM and only decrypted during qualification
- **18-month TTL** — `checkout_sessions.retention_expires_at` column + nightly `expireCheckoutSessions` job
- **Subject deletion** — `POST /api/sessions/forget` deletes by `customer_id` and/or `cart_token` for LGPD/GDPR/CCPA right-to-be-forgotten
- **Match-back** — orders/create webhook calls `matchSessionToOrder(cart_token)` to bind the session to the resulting `shopify_order_id`
- **CORS** — `Access-Control-Allow-Origin: *` on `/api/sessions/ingest` because the body is non-credentialed and auth lives in the server-resolved `shop_domain`

### Modules
- [`lib/liabilityShift/sessions/ingest.ts`](../lib/liabilityShift/sessions/ingest.ts) — ingest validation, IP hashing/encryption, customer-tenure enrichment, upsert
- [`lib/liabilityShift/sessions/enrichCustomerTenure.ts`](../lib/liabilityShift/sessions/enrichCustomerTenure.ts) — Shopify Admin GraphQL lookup for `customer.createdAt`, 1-hour cached
- [`lib/liabilityShift/sessions/resolveShopFromDomain.ts`](../lib/liabilityShift/sessions/resolveShopFromDomain.ts) — `shop_domain` → `shops.id` resolution with 60s cache
- [`lib/liabilityShift/sessions/expireSessions.ts`](../lib/liabilityShift/sessions/expireSessions.ts) — nightly retention job
- [`app/api/sessions/ingest/route.ts`](../app/api/sessions/ingest/route.ts) — POST endpoint, fail-open, CORS-enabled
- [`app/api/sessions/forget/route.ts`](../app/api/sessions/forget/route.ts) — subject-deletion POST endpoint

### Storefront extensions (already scaffolded under `extensions/`)
- `extensions/dispute-desk-pixel/` — Web Pixel, strict-runtime sandbox, subscribes to checkout-flow events
- `extensions/dispute-desk-checkout/` — Preact Checkout UI extension, captures final state

### Schema
Migration `20260514150000_lse4_checkout_sessions.sql` creates `checkout_sessions` with:
- Unique `(shop_id, cart_token)` for match-back
- `ip_hash` (sha256) for queries + `ip_raw_encrypted` (bytea, AES-256-GCM) for matching-only decryption
- `consent_signals` jsonb recording DNT/GPC at ingest time
- `retention_expires_at` defaulting to `now() + interval '18 months'` (indexed for the nightly job)

## Ratio & Compliance Dashboard (LSE-5)

Monthly per-shop calculated **VAMP** / **MC ECM** / **MC EFM** ratios with the counterfactual "without-DisputeDesk" line and estimated fees-avoided / revenue-recovered. Always labeled **calculated estimate** in the UI — only the acquirer has the authoritative number.

Source: [`docs/epics/EPIC-LSE-5-ratio-dashboard.md`](epics/EPIC-LSE-5-ratio-dashboard.md).

### Calculation ([`lib/liabilityShift/ratios/calculate.ts`](../lib/liabilityShift/ratios/calculate.ts))

```
VAMP_ratio = (count(TC40_fraud) + count(TC15_other)) / count(TC05_settled)
```

Approximations from Shopify data:
- `TC40_fraud` ≈ disputes with `reason=fraudulent` AND `phase=chargeback`
- `TC15_other` ≈ all other disputes
- `TC05_settled` ≈ paid orders in the month, refunds/voids excluded
- **Exclusion from numerator:** disputes with `final_outcome='won'` whose attributed evidence pack was `package_type='ce_30'` or `'fpt'` (drives the counterfactual)

Mastercard ratios partition by `network_reason_code` prefix `"48"`:
- `mc_ecm_ratio` = MC chargebacks / settled
- `mc_efm_ratio` = MC fraud-only chargebacks / settled

### Thresholds ([`lib/liabilityShift/ratios/thresholds.ts`](../lib/liabilityShift/ratios/thresholds.ts))
- VAMP standard 0.65%, excessive 1.50%
- MC ECM 1.00%, MC EFM 0.50%
- Yellow band: 80% of threshold

### Schema
Migration `20260514160000_lse5_ratio_snapshots.sql`:
- `ratio_snapshots` — one row per `(shop_id, period_month)`. Includes `vamp_ratio_calculated`, `vamp_ratio_without_dd` (counterfactual), `ce30_excluded_count`, `fpt_excluded_count`, `estimated_fees_avoided_usd`, `estimated_revenue_recovered_usd`.
- `ratio_alerts` — `vamp_yellow|red`, `ecm_yellow|red`, `efm_yellow|red`. Active-row dedup so a shop has one undismissed alert per type at a time.

### API
- `GET /api/ratios/current` — last snapshot with threshold bands
- `GET /api/ratios/trend?months=12` — chronological series for the trend chart

### Cron
The nightly `calculate_ratios` job runs `calculateRatiosForMonth` per shop for the current month (re-run for late-arriving data) and the previous month if it's the first 7 days of the new one. Wire to Vercel cron when ready to enable.

## Direct Network Submission (LSE-6) — schema stub only

LSE-6 enables direct Verifi VROL (CE 3.0) and Ethoca Consumer Clarity (FPT) submission **once commercial partnership agreements are signed**. Engineering does not start until credentials are in hand.

Source: [`docs/epics/EPIC-LSE-6-direct-submission.md`](epics/EPIC-LSE-6-direct-submission.md).

### Schema in place (migration `20260514170000`)
- `shop_settings.lse_verifi_enabled` / `lse_ethoca_enabled` / `lse_keep_shopify_parallel` (default false / false / true)
- `lse_partner_credentials` table — empty until partnerships sign
- `submission_logs.channel` already accepts `verifi` and `ethoca` (added in LSE-2 migration)

### What's intentionally NOT built
- Verifi VROL API client
- Ethoca Consumer Clarity API client
- Outcome webhook endpoints (`/api/webhooks/verifi/outcome`, `/api/webhooks/ethoca/outcome`)
- A/B period dashboards
- Connection-status UI

These come online when commercial credentials are validated against a real sandbox. The schema is positioned so partnership signing → activation is a single PR + credential population step, not a full feature build.

## Automation Pipeline

DisputeDesk is **automation-first**. The pipeline runs automatically
when disputes are detected:

### Flow

1. `sync_disputes` job fetches disputes from Shopify (cron or manual).
2. For each new dispute, `runAutomationPipeline()` checks `shop_settings`:
   - If `auto_build_enabled` → enqueue `build_pack` job.
3. `build_pack` collects evidence sources, evaluates completeness.
4. `evaluateAndMaybeAutoSave()` checks the auto-save gate:
   - `auto_save_enabled` + `score >= threshold` + `blockers == 0` + review status.
   - Decision: `auto_save` | `park_for_review` | `block`.
5. If `auto_save` → enqueue `save_to_shopify` job.

When the gate decision is `block`, the pipeline writes the gate's `reasons` to both the `auto_save_blocked` audit event (`event_payload.reasons`) and the `pack_blocked` dispute event (`description` + `metadata_json.reasons`). The embedded app surfaces this in two places so the merchant is never left guessing why auto-submit stopped:

- **Dispute Overview tab** — renders a "Auto-submit paused" warning banner above the Case status card when the most recent pack audit event is `auto_save_blocked` (see `app/(embedded)/app/disputes/[id]/tabs/OverviewTab.tsx`, `autoSaveBlock` derivation). The banner lists the gate reasons, names the biggest missing evidence field, and exposes "Add missing evidence" / "Submit now anyway" CTAs.
- **Case status card — Automation rule row** — inside the Case status card, directly below the recommendation line, the overview surfaces which rule decision was applied to this dispute (`Auto-Pack` / `Send to Review` / `Notify Only` / `Manual`) plus a **Change rule** button that deep-links to `/app/rules?family={family}`. The mode is read from the latest `rule_applied` audit event for the dispute (`resulting_action.mode`) via the `appliedRule` field on `GET /api/disputes/:id/workspace`; `null` (no matching rule) surfaces as `Manual`. This makes the Rules page the single discoverable place to change routing for future disputes of the same family — the old "Automate this for future cases" post-submit CTA was retired in favour of this always-visible row.
- **Dashboard Recent Activity + dispute-detail timeline** — the `pack_blocked` row shows the gate reasons inline. Dashboard rows localize the common "Completeness score X% is below threshold Y%" reason via `eventDescriptions.pack_blocked_score`; unknown reasons fall through to the raw English description.

### Key modules

| Module | Path | Purpose |
|--------|------|---------|
| Settings | `lib/automation/settings.ts` | Read/write shop_settings with auto-upsert |
| Completeness | `lib/automation/completeness.ts` | Context-aware templates, conditional requirements, weighted scoring. V2 engine (`evaluateCompletenessV2`) adds priority/blocking/waive model with `SubmissionReadiness` (ready/ready_with_warnings/blocked/submitted) |
| Auto-Save Gate | `lib/automation/autoSaveGate.ts` | Decision logic for auto-save |
| Pipeline | `lib/automation/pipeline.ts` | Orchestrator: trigger build + evaluate gate |
| Payment Source | `lib/packs/sources/paymentSource.ts` | Card evidence (AVS/CVV/BIN/wallet), risk assessments, customer IP |
| 3-D Secure Source | `lib/packs/sources/threeDSecureSource.ts` | 3DS authentication signal, best-effort read from Shopify Payments `receiptJson` |
| Coverage Source | `lib/packs/sources/coverageSource.ts` | Shopify Protect status — Coverage Gate input |

### Pack Status Flow

```
queued → building → ready → saved_to_shopify
                  → ready (auto-save blocked by gate, merchant can still act)
                  → ready (parked for review → approve → saved_to_shopify)
                  → failed
```

**Core principle:** Packs are ALWAYS generated (`ready` or `failed`). Missing evidence never blocks pack creation — blockers only gate auto-save/submission. The `blocked` status is no longer set by the build step.

**Rebuilds never un-submit a pack:** When `evaluateAndMaybeAutoSave` runs after a rebuild of a pack that was already saved to Shopify (`status` in `saved_to_shopify*`), it leaves `status` unchanged even if the new build would otherwise be parked for review. `saved_to_shopify_at` is the authoritative signal that a save really happened; the Overview UI treats any pack with `saved_to_shopify_at` set as submitted, so the "Auto-submit paused" banner and "Not submitted" badge never appear on a dispute that was already pushed to Shopify.

### Conditional Requirement Modes

Template items have a `requirement_mode` column (`pack_template_items`):
- `required_always` — always required
- `required_if_fulfilled` — required only when order has been shipped (AVS/tracking items)
- `required_if_card_payment` — required only when payment is a card (AVS/CVV)
- `recommended` — not required but weighted in scoring (0.5x)
- `optional` — nice to have (0.1x)

`OrderContext { isFulfilled, hasCardPayment, avsCvvAvailable, hasShippingEvidence }` is derived in `buildPack.ts` from the fetched order and passed to the completeness engine. Items that are inapplicable for the order context are marked `unavailable` with a reason string, not counted as blockers. `avsCvvAvailable` is true only when a card transaction actually returned AVS/CVV codes — external gateways (Stripe via Shopify, Adyen) often return null even for card payments. `hasShippingEvidence` is true when the order carries at least one fulfillment record with a tracking number or URL — used to swap the `delivery_proof` `unavailable` reason from "Order is unfulfilled" to "Awaiting delivery confirmation" in the partial-shipment case (Shopify still reports `displayFulfillmentStatus === "UNFULFILLED"` while a fulfillment with tracking exists). Only `delivery_proof` consumes the flag; `shipping_tracking` would have short-circuited via `isPresent === true` in that branch.

### Evidence Model V2 — Priority + Blocking + Waive

The v2 evidence model (`lib/types/evidenceItem.ts`) replaces the binary required/not-required model with:
- **Status**: `available | missing | unavailable | waived`
- **Priority**: `critical | recommended | optional` (win-rate impact)
- **Blocking**: `boolean` — only `true` for platform-mandated blockers (currently `false` for ALL default templates since Shopify accepts partial submissions)
- **Submission readiness**: orthogonal to completeness score — `ready | ready_with_warnings | blocked | submitted`

DB columns (`evidence_packs`): `checklist_v2` (jsonb), `submission_readiness` (text), `waived_items` (jsonb array of `WaivedItemRecord`). Dual-written alongside v1 `checklist`/`blockers` for backward compat.

**Waive flow**: `POST /api/packs/:packId/waive` — merchant can skip any missing/unavailable item with a controlled reason. Waived items count as present in scoring. Audit events: `evidence_waived`, `evidence_unwaived`. Un-waive via `DELETE /api/packs/:packId/waive?field=...`.

**Save gate**: `submission_readiness === "blocked"` → 422. `ready_with_warnings` → requires `confirmWarnings: true`. Sidebar shows warning count; header distinguishes "blocked" from "ready with warnings".

### AVS/CVV Collection

`ORDER_DETAIL_QUERY` fetches `transactions.paymentDetails` (typed `CardPaymentDetails` with `avsResultCode`, `cvvResultCode`, `bin`, `name`, `expirationMonth`, `expirationYear`, `wallet`). The `paymentSource.ts` collector extracts card evidence from the first successful SALE/AUTHORIZATION transaction and reports a three-state `avsCvvStatus`:
- `available` — AVS/CVV codes present (Shopify Payments typically provides these)
- `unavailable_from_gateway` — card payment but gateway returned null (common with Stripe via Shopify, Adyen, etc.)
- `not_applicable` — non-card payment (PayPal, manual, etc.)

The `required_if_card_payment` mode now checks `OrderContext.avsCvvAvailable`: when a card payment exists but the gateway didn't return codes, AVS/CVV is marked `unavailable` (not `missing`) — it does not penalize the completeness score or appear as a warning. In v2: `priority: "critical"`, `blocking: false`.

### Risk Assessment Collection

Risk assessment collection removed (2026-04-20). `Order.riskAssessments` does not exist on Shopify Admin API `2026-01` and caused every pack build with an `order_gid` to fail. The `risk_analysis` field is no longer emitted by the collector; it was `recommended`/`blocking: false`, so its absence does not affect completeness scoring. Migration to `orderRisks` is a follow-up.

### 3-D Secure Collection

`threeDSecureSource.ts` reads 3DS authentication signals from `OrderTransaction.receiptJson` for **Shopify Payments only**. The Admin GraphQL typed schema does NOT expose 3DS on any `PaymentDetails` union member in 2026-01 (verified across `CardPaymentDetails`, `PaypalWalletPaymentDetails`, `ShopPayInstallmentsPaymentDetails`, `LocalPaymentMethodsPaymentDetails`); the data only lives inside the JSON-scalar receipt blob, which Shopify documents as gateway-defined and explicitly *not a stable contract*.

**Wire shape:** `receiptJson` arrives as a JSON **string** that mirrors Stripe's PaymentIntent. The collector parses it defensively and walks `latest_charge.payment_method_details.card.three_d_secure.authenticated` (modern shape) with a fallback to `payment_method_details.card.three_d_secure.authenticated` (legacy charge-level shape). `three_d_secure: null` is the normal "3DS not used" state on test cards / non-3DS rails.

**Emission rule:** the collector ONLY emits a `tds_authentication` evidence row when `authenticated === true`. Absence of 3DS is never a negative signal — `null`, `false`, missing path, malformed receipt, or non-Shopify-Payments gateway all collapse to "no signal" (no row emitted).

**Classification rule (in `canonicalEvidence.ts → categorizeEvidenceField('tds_authentication')`):**

| Payload | Category | Source path |
|---|---|---|
| `tdsVerified === true` | **Strong** | Manual merchant confirmation (uploaded gateway receipt + ticked the verify box) |
| `tdsAuthenticated === true && verifiedSource === "shopify_receipt"` | **Moderate** | Auto-collected from receiptJson |
| anything else | Invalid | — |

The auto-collector is downgraded one tier (Moderate, not Strong) on purpose: the receipt contract is unstable, and we cannot independently verify the read. The merchant-facing UI may surface a "Verify in Shopify Admin → order timeline → Information from gateway" hint to upgrade auto-Moderate → manual-Strong. Bank-rebuttal text never auto-claims 3DS from the receipt-read path alone.

**Why it's only Shopify Payments:** receipt JSON shape is provider-specific. The `SUPPORTED_GATEWAYS` set in the collector is the single gate; never widen it without a separate verified probe of that gateway's receipt shape.

**Path-stability evidence (2026-04-26).** Verified across 18 SUCCESS transactions on 2026-01 (10 via `orders(query:"financial_status:paid")`, 8 via dispute-tied real orders): `three_d_secure` was located at `latest_charge.payment_method_details.card.three_d_secure` on every single transaction, and the dynamic recursive walker (`scripts/test-3ds-extraction.mjs`) agreed with the hardcoded modern path on every receipt. The legacy charge-level path (`payment_method_details.card.three_d_secure` at the receipt root) never resolved in the sample — it remains in the collector as defensive insurance only. The populated-object case (`authenticated: true`) was *not* observed in the sample (Stripe test cards do not trigger real 3DS challenges), so the live verification confirms field/path stability but not the live-extraction path. The REST endpoint `/admin/api/{ver}/orders/{id}/transactions.json` returned identical receipt shapes — kept as a future GraphQL-removal fallback, not currently wired in.

**Re-running the verification.** `node scripts/test-3ds-extraction.mjs [shopId] [orderLimit]` runs the recursive walker + REST cross-check + structured reliability report against any shop with an offline session. Re-run after any Shopify API version bump or whenever 3DS scoring behavior is questioned.

### Coverage Gate (Shopify Protect)

**Source: `lib/packs/sources/coverageSource.ts`. Routing primitive: PRD v1.1 §3 step 1.**

The Coverage Gate is the highest-priority routing decision in the pipeline. When Shopify Protect actively underwrites a dispute, there is no merchant workflow — no auto-save, no review, no block. It runs *before* the rule-mode resolution and the auto-save quality gate.

**Source field:** `Order.shopifyProtect.status` (Admin GraphQL, 2026-01). Surfaced as a typed enum on `OrderDetailNode`. Null when the program isn't applicable (non-Shopify-Payments order, ineligible region, older order). Verified queryable on the live API; `eligibility { ... }` is intentionally not queried until its sub-shape is verified.

**Status → coverage mapping** (in `summarizeCoverage()`):

| `shopifyProtect.status` | Coverage state | Meaning |
|---|---|---|
| `PROTECTED` | `covered_shopify` | Chargeback already covered — Shopify reimbursed |
| `ACTIVE` | `covered_shopify` | Order is eligible & live in the program |
| `PENDING` | `not_covered` | Decision not made yet — fall through to normal flow |
| `INACTIVE` | `not_covered` | Order didn't meet eligibility |
| `NOT_PROTECTED` | `not_covered` | Chargeback received without coverage |
| null | `not_covered` | Program not applicable to this order |

**Persisted on `pack_json.coverage`** (parallel to `pack_json.device_location`) so consumers — pipeline + workspace API — read it without re-walking sections.

**Pipeline short-circuit (`evaluateAndMaybeAutoSave` in `lib/automation/pipeline.ts`):** when `coverage.state === "covered_shopify"`, returns `{ action: "skip_covered" }` and emits a `covered_by_shopify` audit event. Pack stays `status: "ready"` so the merchant can still see what was collected. The rule-mode resolution and auto-save gate do NOT run for covered packs.

**Case strength surface (`calculateCaseStrength` in `lib/argument/caseStrength.ts`):** accepts an optional `coverage` parameter. When `state === "covered_shopify"`, `heroVariant` is forced to `"covered"` and `strengthReason` is replaced with the covered copy ("This dispute is protected under Shopify's payment protection. No action is required from you."). Underlying `overall` / counts are still computed for diagnostics, but UI consumers should branch on `heroVariant` first.

**UI (`OverviewTab.tsx`):** new `"covered"` hero variant with a distinct cool-blue palette so the merchant doesn't read it as green-go. Strength label per PRD §10: "Covered by Shopify". No layout changes — only label + tone.

**Hard rules:**
- Never auto-save a covered pack (pipeline short-circuits before the gate).
- Never widen the `COVERED_STATUSES` set beyond `PROTECTED` and `ACTIVE` — `PENDING` must fall through to normal flow until Shopify decides.
- Never override coverage based on user automation mode (Coverage Gate runs before mode resolution).
- Never reuse the green "Strong case to challenge" palette for covered — they are semantically different.

### PRD §9 Strength Gate (auto-mode strength gating)

**Routing primitive: PRD v1.1 §1 ("Auto mode executes ONLY on Strong cases") + §9 matrix.**

The strength gate sits between the Coverage Gate and the legacy quality gate inside `evaluateAndMaybeAutoSave`. It enforces the PRD §9 matrix for shops on auto rules:

| `pack_json.case_strength.overall` | Action when `ruleMode === "auto"` |
|---|---|
| `strong` | Fall through to the existing quality gate (completeness + readiness) |
| `moderate` | `park_for_review` — merchant must approve manually |
| `weak` | `block` — auto-submit refused |
| `insufficient` | `block` — no decisive evidence at all |
| missing (legacy pack) | Fall through to the existing quality gate (back-compat) |

`ruleMode === "review"` always parks regardless of strength — "User control is absolute" (PRD §1).

**Source field:** `pack_json.case_strength.overall`, persisted by `buildPack` via a server-side `calculateCaseStrength` call. The build passes `argumentMap: null` because that table isn't loaded server-side; `overall` is independent of the argument map (it depends only on checklist + payloads + reason + coverage). The UI hook still computes its own full `CaseStrengthResult` with the argument map for `supportedClaims/totalClaims`.

**Audit + dispute events:**
- `auto + moderate`: `parked_for_review` audit event with `case_strength: "moderate"` in payload, plus a `PARKED_FOR_REVIEW` dispute event with the strength in `metadataJson`.
- `auto + weak | insufficient`: `auto_save_blocked` audit event with `case_strength` in payload, plus a `PACK_BLOCKED` dispute event with merchant-and-internal visibility.

**Precedence (verified by `lib/automation/__tests__/pipelineMatrix.test.ts`):**

```
pack.status === "failed"            → block (system error)
coverage === covered_shopify        → skip_covered          (PRD §4)
ruleMode === "review"               → park_for_review       (PRD §1)
ruleMode === "auto" + strength gate → see matrix above       (PRD §9)
ruleMode === "auto" + strong + completeness gate fails → block (existing)
```

**Hard rules:**
- Never gate `review` mode on strength — review is absolute.
- Never silently flip legacy-pack behavior. Packs without `case_strength` on `pack_json` (built before the P2 commit `24235cc`) keep the existing quality-gate-only behavior. Rebuild a pack to opt in to the new strength gate.
- The strength gate is `ruleMode === "auto"` only — review-mode behavior is untouched.

### Fatal-loss Gate (PRD §3 step 2 / §5)

**Routing primitive: PRD v1.1 §5.** Sits between the Coverage Gate and the strength gate. Detects cases where evidence-strength scoring is misleading because the case is structurally unwinnable. When triggered:

- `caseStrength.overall` is capped at `"weak"` (UI hero turns red, label "Low likelihood case" per PRD §10).
- `strengthReason` is replaced with a fatal-loss-specific merchant-facing message.
- `auto`-mode in `evaluateAndMaybeAutoSave` returns `block` regardless of completeness or strength.
- `review`-mode falls through and parks normally — the merchant still sees the pack and decides for themselves.

**Triggers (LOCKED scope, v1):**

| Trigger | Detection rule |
|---|---|
| `refund_issued` | `order.totalRefundedSet.amount >= dispute.amount` AND `dispute.amount > 0` |
| `inr_no_fulfillment` | `dispute.reason ∈ {PRODUCT_NOT_RECEIVED, ITEM_NOT_RECEIVED}` AND `order.displayFulfillmentStatus === "UNFULFILLED"` AND `order.fulfillments.length === 0` |

The refund check requires a non-null `dispute.amount` to avoid false positives on legacy disputes (we don't trigger when amount is unknown). The detector matches reasons case-insensitively. Refund check is evaluated first when both could match.

**Out of scope for v1 (deferred to a future P4.1+):**
- "Valid cancellation before billing" — no clean source today.
- "Confirmed fraud accepted by merchant" — no UI for this today.
- "Evidence contradiction" — needs a contradiction model.

**Source field:** `pack_json.fatal_loss = { triggered, reason, message }`, persisted by `buildPack` via `detectFatalLoss(order, dispute.reason, dispute.amount)`. Pure function over the order + dispute context — no I/O.

**Precedence (verified by `lib/automation/__tests__/pipelineMatrix.test.ts` and `lib/argument/__tests__/caseStrength.test.ts`):**

```
covered_shopify   → skip_covered                (PRD §4 — coverage beats fatal-loss)
auto + fatal_loss → block                       (PRD §5)
review + fatal_loss → park_for_review           (review is absolute)
```

**Hard rules:**
- The fatal-loss gate only ever makes auto-mode stricter. Never loosen the rule based on it.
- Never trigger refund_issued without a positive `dispute.amount` — partial refunds on legacy disputes risk false positives.
- The `MESSAGES` copy in `lib/automation/fatalLoss.ts` is merchant-UI only. Bank-rebuttal text generation must NEVER cite "we already refunded" — that's a confession, not a defense.
- Coverage beats fatal-loss. A covered case is never "fatal" because Shopify pays regardless.

### Risk-weakness diagnostics (internal-only)

**Status (2026-05-15):** the Phase 2 CAP was rolled back. Surfacing Shopify's pre-auth risk score to the merchant doesn't change what they can do — the case is defensible (or not) based on AVS/CVV/delivery/auth, regardless of the risk score at checkout. The merchant-facing surfaces (embedded banner, email callout, strength-reason override) were all removed. Diagnostics are retained for internal analytics + support debugging.

**What still runs:**

- `detectRiskWeakness` in `lib/automation/riskWeakness.ts` — pure detector, unchanged.
- `loadRiskWeakness` in `lib/packs/buildPack.ts` — still reads the persisted snapshot from `shopify_orders` with the live-fetch-failure fallback.
- `pack_json.risk_weakness` — still persisted on every pack with `{ triggered, reason, message, diagnostics }`.
- `calculateCaseStrength` accepts `riskWeakness` as input and propagates it to the result for pack_json persistence, but **never** caps `overall`. Auto-mode continues to submit on Strong cases regardless of risk-weakness.

**What was removed:**

- The cap-to-Moderate behavior in `lib/argument/caseStrength.ts`.
- The "Auto-submit held" embedded banner (F3 in `OverviewTab.tsx`).
- The localized review-email "park reason" callout in `lib/email/sendNewDisputeAlert.ts`.
- The `parkReason` parameter on `claimAndSendDeferredNewDisputeAlert`.
- The `park_cause` discriminator on `parked_for_review` audit events.

---

**Historical (pre-2026-05-15) cap description — kept for context:**

The cap sat between the Fatal-loss Gate and the standard scoring path. It detected fraud-family disputes where Shopify's pre-authorization fraud screening flagged the order as HIGH-risk with an INVESTIGATE / REJECT / CANCEL recommendation, and the merchant fulfilled anyway. When triggered, the case-strength engine **capped** `caseStrength.overall` at `"moderate"` (cap-as-ceiling — never elevated a Weak case to Moderate, never demoted below the natural score).

The cap routes through the existing `auto + moderate → park_for_review` branch in `evaluateAndMaybeAutoSave`. No new pipeline gate is required — this is the elegance of cap-via-strength-engine: a Strong-would-have-been case auto-parks for merchant review instead of auto-submitting, without introducing a new auto-save terminal state.

**Trigger conditions (ALL must hold):**

| Condition | Detection rule |
|---|---|
| Fraud-family | `isFraudFamilyReason(dispute.reason)` returns true (`FRAUDULENT` / `UNRECOGNIZED`) |
| High risk | `shopify_orders.risk_level_initial === "HIGH"` |
| Warning recommendation | `shopify_orders.risk_recommendation_initial ∈ {"INVESTIGATE", "REJECT", "CANCEL"}` (verified against live shop data 2026-05-15: INVESTIGATE most common, CANCEL strongest, REJECT defensive) |
| Merchant fulfilled | `order.fulfillments.length >= 1` |

**Source field:** `pack_json.risk_weakness = { triggered, reason, message, diagnostics: { riskLevel, recommendation, fulfillmentCount } }`, persisted by `buildPack` via `detectRiskWeakness(...)`. Pure function over the persisted snapshot — no Shopify call. The snapshot comes from the orders backfill ingestion (`lib/shopify/queries/ordersForBackfill.ts`).

**Precedence (verified by `lib/argument/__tests__/caseStrength.test.ts`):**

```
covered_shopify    → skip_covered                (PRD §4 — coverage beats everything)
auto + fatal_loss  → block                       (PRD §5 — fatal-loss beats risk-weakness)
auto + risk_weak   → cap to moderate → review    (cap routes through existing branch)
review             → park_for_review             (review is absolute)
```

**Hard rules:**
- **Cap, never block.** A HIGH-risk order with strong delivery, AVS, or authentication evidence is still defensible. Auto-blocking would over-trigger.
- **Cap is a ceiling, never a floor.** If the underlying case already scores Moderate or Weak, the cap is a no-op. The cap NEVER elevates.
- **Fraud-family only.** Risk screening is irrelevant to PRODUCT_NOT_RECEIVED / DUPLICATE / etc. Extending scope would require revisiting family-specific scoring; deferred.
- **Never cited in bank text, evidence PDF, or Shopify mutations.** This is a merchant-UI-only signal. Citing "Shopify flagged this as high-risk" would be a confession — same logic as the fatal-loss gate. Locked by `lib/argument/__tests__/fraudRiskNegativeLeakage.test.ts`.
- **No re-fetch.** Reads only the persisted `risk_level_initial` / `risk_recommendation_initial` snapshot. Shopify can rescore late; tracking that is out of scope for v1.

**Merchant comms when the cap fires:**

The cap routes through the existing `auto + moderate → park_for_review` branch, which means the merchant's auto-mode rule did NOT submit. Three surfaces explain *why* so they aren't left wondering:

1. **Audit + dispute timeline event.** `parked_for_review` event payload includes `park_cause: "risk_weakness"` (vs `"natural_moderate"` for the standard Moderate park). Visible in the dispute timeline tab and audit logs.
2. **Deferred new-dispute email (review variant).** `claimAndSendDeferredNewDisputeAlert(disputeId, "review", "risk_weakness")` renders a localized amber callout between `bodyP1` and the meta table: *"Your automation rule was set to auto-submit, but Shopify's pre-authorization fraud screening flagged this order as high-risk before fulfillment. Auto-submit was held so you can review the evidence before submitting."* Translated across all 6 supported locales (en, es, pt, fr, de, sv).
3. **Embedded UI banner.** `OverviewTab.tsx` renders a Polaris `Banner tone="warning"` titled *"Auto-submit held — high-risk order flagged before fulfillment"* above the Case Summary card whenever the most recent `parked_for_review` event carries `park_cause === "risk_weakness"` and the pack isn't yet submitted. Sits next to the existing `autoSaveBlock` banner.

The merchant-facing strength reason (rendered inside the Case Summary card's "Why" block via `caseStrength.strengthReason`) already carries the risk-weakness sentence — the banner + email are the *anomaly explanations* that surface the auto-mode-but-parked distinction the strength card alone can't convey.

**Hard rule:** the audit `park_cause`, email `parkReason`, and banner all live exclusively on merchant-facing surfaces. None reach bank text, evidence PDF, or Shopify mutations.

**v2 escape hatch (not implemented):** when 3-D Secure liability shift is verified (`tdsVerified === true` from manual confirmation), the cap should be skipped — the network has explicitly transferred liability and pre-auth risk score is no longer the dominant signal. Marked as a TODO in `lib/automation/riskWeakness.ts`.

### Customer IP Collection

`ORDER_DETAIL_QUERY` fetches `clientIp` (often null on many stores due to Shopify privacy restrictions). When present, the `paymentSource.ts` collector provides a `customer_ip` field. Shopify's `ShopifyPaymentsDisputeEvidenceUpdateInput` does **not** have a dedicated `customerPurchaseIp` field (verified via introspection 2026-04-21; earlier codebase claim was stale). When IP evidence exists the save-to-Shopify job appends `Customer purchase IP: <ip>` to `accessActivityLog` so the IP still reaches the bank in the "Activity logs" field. Priority: `recommended` for fraud disputes.

## Dispute Workspace

The dispute detail page (`/app/disputes/:id`) is a **unified tabbed workspace** with 3 tabs: Overview, Evidence, Review & Submit. It replaces the previous separate dispute detail + pack detail pages.

**Architecture:** `page.tsx` → `WorkspaceShell.tsx` (custom Figma-style tab strip) → `OverviewTab`, `EvidenceTab`, `ReviewSubmitTab`. Central data hook `useDisputeWorkspace.ts` loads all data from `GET /api/disputes/:id/workspace` (composite endpoint). Tab state is React state, not URL params (avoids App Bridge iframe re-renders). The tab strip is a `role="tablist"` with three `role="tab"` buttons that share borders with the panel below into a single rounded-12 white card; the active tab carries a 2-px blue underline (`#005BD3`), inactive tabs use `#6D7175`. Replaces the Polaris `<Tabs>` so the visual matches the Figma `shopify-dispute-detail.tsx` design (lines 105-139): connected card, blue (not gray) underline, `text-sm font-medium` labels at `padding 12 24`. ARIA wiring uses `aria-controls`, `aria-selected`, and `aria-labelledby` between each tab and its panel; the inactive tab is `tabIndex={-1}`.

**Argument Engine** (`lib/argument/`):
- `templates.ts` — per-reason counterclaim templates (toWin, strongestEvidence, claims with required/supporting evidence). **Title↔requirement contract:** every claim title must be supportable by ALL of its `requiredEvidence`. A title that asserts two facts (e.g. "Order was fulfilled and delivered") must require evidence for both (e.g. `["shipping_tracking", "delivery_proof"]`). Listing one of the asserted facts as `supportingEvidence` is a bug — it lets the claim rate Strong on partial proof and contradicts the row-level checklist (where the missing field is `unavailable` or `missing`). Audited 2026-04-26: FRAUDULENT `fraud-2` and PRODUCT_NOT_RECEIVED `pnr-1` promote `delivery_proof` from supporting to required. **`partialTitles` (optional):** when only a subset of `requiredEvidence` is present, `generateArgumentMap` looks up `partialTitles[sortedKey]` (key = sorted comma-joined list of present-required fields) and uses it instead of the full `title`. Lets a claim re-headline to "Order was shipped to the customer" (Moderate) when only tracking is backed, instead of asserting "fulfilled and delivered" without delivery evidence. Falls back to `title` when no entry matches.
- `generateArgument.ts` — builds `ArgumentMap` from reason + checklist (evaluates per-claim strength)
- `generateRebuttal.ts` — generates structured rebuttal sections (summary + per-claim + conclusion)
- `caseStrength.ts` — overall + per-claim strength scoring + improvement signal
- `whyThisCaseWins.ts` — auto-generated strengths/weaknesses
- `riskExplanation.ts` — risk assessment for submit tab
- `nextAction.ts` — computes single next step for merchant

**Auto-generation:** When the workspace loads and finds a pack but no argument map, it auto-generates one (`POST /api/disputes/:id/argument` with `{ packId }`). No manual trigger needed.

**Regenerate / stale letter:** `GET /api/disputes/:id/workspace` includes `rebuttalOutdated` when `evidence_packs.updated_at` is newer than `rebuttal_drafts.updated_at`. Review & Submit shows a warning and **Regenerate defense letter**, which POSTs `{ packId, regenerate: true }`. The client surfaces load/save errors (loading state + message); `credentials: "include"` is set on the fetch.

**`POST /api/disputes/:id/argument` errors:** True missing dispute or pack → **404** (`PGRST116` from `.single()`). Any other PostgREST error on load (e.g. invalid `select` list) → **500** with `{ error, detail }` — avoids masking schema problems as “not found”. Deletes/insert/upsert for `argument_maps` and `rebuttal_drafts` check `{ error }` and return **500** on failure (no “success” JSON if the DB did not persist).

**DB tables:** `argument_maps` (dispute_id, pack_id, counterclaims jsonb, overall_strength), `rebuttal_drafts` (pack_id, sections jsonb, source), `submission_attempts` (full submission audit).

### Pack status model — system failures vs evidence gaps

`evidence_packs.status` reflects whether the build itself completed as a system operation, not whether evidence is sufficient:

- **`failed`** — upstream/system error (e.g., couldn't load the order from Shopify). The merchant did nothing wrong. UI must render a system-error banner with a Retry CTA — never the evidence-gap surfaces.
- **`ready`** — build completed; whether it can be submitted is encoded in `submission_readiness` (`ready` / `ready_with_warnings` / `blocked`).
- **`saving`** / **`save_failed`** / **`saved_to_shopify`** — submission lifecycle.

When a build fails, `evidence_packs.failure_code` (machine-readable, e.g. `order_fetch_failed`) and `evidence_packs.failure_reason` (internal full error text) are persisted. The merchant UI maps `failureCode` → safe copy via `FAILURE_COPY` in `OverviewTab.tsx` / `EvidenceTab.tsx`; `failureReason` is **never rendered** to merchants.

Build pipeline contract (`lib/packs/buildPack.ts`, `lib/jobs/handlers/buildPackJob.ts`, `lib/automation/pipeline.ts`):

1. `buildPack` sets `status = "failed"` + `failure_code` + `failure_reason` whenever the order fetch fails (caught error or null node returned by Shopify).
2. `buildPackJob` emits `PACK_BUILD_FAILED` (not `PACK_CREATED`) on the dispute timeline when `result.status === "failed"`, so merchants see *"Couldn't load order data from Shopify"* rather than *"Score: 0%, 1 evidence items collected"*.
3. `evaluateAndMaybeAutoSave` short-circuits on `pack.status === "failed"` and never emits `auto_save_blocked` — evidence-gap signals would be misleading on a build that never completed.
4. `Retry build` is the merchant CTA in both Overview and Evidence tabs; it calls `actions.generatePack()` which `POST /api/disputes/:id/packs` (already filters `failed` packs out of the "active pack exists" check, so retries always create a fresh pack). The workspace hook tracks a `retrying` flag so the retry button is disabled while a pack-creation request is in flight — prevents double-submit and duplicate pack rows.

**Failed-pack invariants (enforced end-to-end):**

- `buildPack` NULLs all evidence-derived fields (`submission_readiness`, `checklist`, `checklist_v2`, `blockers`, `recommended_actions`) and zeroes `completeness_score` whenever `status === "failed"`. Evidence-derived fields are meaningful iff `status === "ready"`.
- `POST /api/packs/:packId/save-to-shopify` and `POST /api/packs/:packId/approve` return **409 `PACK_NOT_READY`** when `pack.status !== "ready"`. A failed (or still-building/saving) pack can never enter the submission flow.
- **Job-layer defense-in-depth:** `saveToShopifyJob` refuses to call Shopify when the pack's status at job-start is not in `{ "ready", "saving", "saved_to_shopify" }`. This catches direct job inserts (admin tools, future code paths, race conditions) that bypass the API gate. The job logs a `job_failed` audit event with `reason: "pack_status_failed"` and throws before any Shopify call is made.
- `deriveNormalizedStatus` maps `packStatus === "failed"` → `action_needed` with `next_action = "rebuild_pack"` (never falls through to `new`).
- `ReviewSubmitTab` early-returns a failure Banner when `derived.isFailed` — no submit button, no readiness messaging.

**Key feature:** Argument map claims are clickable — clicking an evidence badge switches to the Evidence tab, expands the correct category, scrolls to the item, and highlights it.

### Overview tab structure (backend-driven, audit-grade)

**Plan v3 rebuild (2026-04-25):** The Overview tab was rewritten end-to-end to satisfy the spec rule that *the UI is a debuggable surface of the backend, not a simplified dashboard*. Every render value cites a backend field; cross-collection references resolve through stable IDs only. The full plan and audit checklist live in `.cursor/plans/figma-dispute-detail-3tabs.plan.md` (v3 patch 1).

**Backend prerequisites shipped before the UI rebuild:**
- **3.A.5 — Stable cross-collection IDs (commit `7493b3c`).** Workspace API now exposes `argumentMap.counterclaimsById: Record<id, CounterclaimNode>` and `pack.evidenceItemsByField: Record<evidenceFieldKey, EvidenceItem>`. Every `counterclaim.supporting/missing/systemUnavailable[*]` row gets an `evidenceFieldKey` alias for its existing `field` (back-compat — both keys present). `WhyWinsResult.strengths/weaknesses` are now `Array<{ text, counterclaimId }>` instead of bare strings, so consumers resolve back to the surfacing counterclaim by ID rather than by description text.
- **3.A.2 — Single-source mutation payload + raw preview (commit `119914b`).** New `lib/shopify/composeShopifyMutationPayload.ts` is the only place that builds the `disputeEvidenceUpdate.input` payload; both `saveToShopifyJob.ts` and the submission-preview API call it. `GET /api/packs/:id/submission-preview?format=raw` returns the actual mutation payload, byte-equivalent to what the submit job sends. Guaranteed by 7 unit tests (purity, customer-name splitting, single-word fallback, all-null omission, the 6 reason families, attachments append, URL-as-input).
- **3.A.6 — Backend-derived recommendation copy (commit `9b07cf5`).** New `lib/argument/recommendation.ts` produces the merchant-facing `Recommendation:` sentence + helper line. `useDisputeWorkspace.ts` exposes `derived.recommendationText` and `derived.recommendationHelperText`; the Overview tab renders both verbatim. The previous inline composition in `OverviewTab.tsx:382-415` is gone.
- **3.A.4 — First-class attachments[] (commit `565ae72`).** Workspace API derives `attachments[]` from `pack.evidenceItems[*].payload.fileId`. Always an array; empty array is the explicit empty state for the Review tab's Supporting-documents section.
- **3.A.3 — Rebuttal section provenance (commit `9a60ea2`).** `RebuttalSection.evidenceRefs[]` is normalized at the API boundary so the Review tab can always render per-claim "Citing:" footnotes (or the explicit "Per-claim provenance unavailable" empty state for legacy drafts that lack the field).

**Overview tab body (`tabs/OverviewTab.tsx`, commit `23904a1`).** Sections in plan order:

1. **F1 — Failure short-circuit.** When `derived.isFailed`, render the safe `FAILURE_COPY[failureCode]` Banner and a Retry button. Internal `failure_reason` is never shown to merchants.
2. **F2 — Auto-save denied Banner.** Driven by the latest `auto_save_blocked` audit event; lists `reasons[]` and exposes Add-missing / Submit-anyway CTAs.
3. **O1 — Hero card.** Adaptive green/amber/red palette keyed off `caseStrength.overall`. Title comes from one of two 1:1 mappings depending on submission state: pre-submit copy prompts a merchant decision (`Strong case to challenge` / `Review before challenging` / `Low likelihood case` / `Covered by Shopify`); once `data.pack.savedToShopifyAt` is set the hero shifts to a status framing (`Likely to win` / `Moderate case submitted` / `Low-likelihood case submitted` / `Covered by Shopify`) so the title no longer dangles a stale CTA. Coverage pill `{coveragePercent}% evidence collected` from `caseStrength.coveragePercent` — a real 0-100 ratio of registered checklist items present, **not** the count-based `score` (which is a small integer like 3 or 5 and shouldn't be suffixed with `%`). Body: pre-submit shows `caseStrength.strengthReason` (composed, not looked up — guaranteed never to claim a contribution is "missing" while it appears as Strong/Moderate elsewhere on the page); post-submit shows a one-line "Submitted to Shopify on {date} — bank review in progress." that replaces all pre-submit advisory copy (`recommendationText`, `recommendationHelperText`, `improvementHint`) since the merchant can no longer act on it. The static `STRENGTH_REASONS[family][overall]` table is reserved for the only case where it's accurate: zero strong + zero moderate contributions. The Recommendation card below the timeline mirrors the same submission-state gate — pre-submit advice is suppressed when submitted, leaving only the submission/deadline line and `EVIDENCE_EVALUATION_HELPER`.
4. **O2 — "What happens now" timeline.** Three-step state machine over `submitted` and `dispute.finalOutcome`. Pre-submit: Build → Review & submit → Bank review. Submitted: Submitted ✓ → Bank review ⏰ → Outcome (turns green when `finalOutcome` is set).
5. **O3 — "What supports your case" (REMOVED).** This card iterated `derived.contributions.strong[]` then `.moderate[]` and surfaced each as a row. After O3a was reordered strongest-first, every row in O3 was an exact duplicate of the first N rows of O3a. The card was deleted to remove the duplication; the actionable "Missing signals" subsection that lived inside it (with `Add this evidence` → `actions.navigateToEvidence(field)`) folded inline into O3a's missing rows — same gating (default category strong/moderate, manually collectable, pre-submit only), same handler. It was briefly re-introduced as a top-3 summary card on 2026-04-26 to mirror the Figma overview prototype, then removed the same day per merchant feedback that the separate card visually fragmented the column without adding information beyond what O3a's strongest-first ordering already shows. **Argument Purity Rule (P2.6) is still upheld** — O3a does not promote supporting fields above strong/moderate ones; ordering is by strength.
6. **O3a — "Evidence collected".** The single source of truth for the per-field view: lists every canonical field in the checklist (supporting items included) as a **single list ordered by strength, strongest first**. Sort tier: strong (0) → moderate (1) → supporting (2) → missing (3) → not_applicable / waived (4); within a tier the checklist's natural order is preserved (`Array.prototype.sort` is stable). Each row carries **exactly one pill** — the redundant "Collected" pill has been dropped because presence in the list already implies collected unless the pill says otherwise. When collected, the pill is the strength category (Strong / Moderate / Supporting / Invalid); when not, the pill is the row status (Missing / Not applicable / Waived). Each row uses the Figma `shopify-dispute-detail` row pattern (`bg #F6F8FB` / `bg #FEF2F2` for missing, `rounded-lg`, 16px padding, leading icon + bold title + subdued source descriptor + trailing pill). Leading-icon palette: green `CheckCircleIcon` for collected, red `AlertCircleIcon` for missing, neutral `#8C9196` for waived/not applicable. **Missing rows render an inline `Add this evidence` button** (pre-submit only) → `actions.navigateToEvidence(field)` whenever `canMerchantUpload(item)` returns true. The helper and its underlying `MERCHANT_ACTIONABLE_FIELDS` allowlist (derived from `FIELD_ACTIONS` keys: `supporting_documents`, `customer_communication`, `product_description`, `duplicate_explanation`) live in `useDisputeWorkspace.ts` and are imported by both Overview and Evidence tabs so the merchant-actionable policy is single-sourced. The previous gate (`defaultCat ∈ {strong, moderate}` AND `collectionType === "manual"`) silently hid the CTA for fields that only become Strong via merchant content — `customer_communication` defaults to `supporting` in the registry but elevates to Strong when `payload.customerConfirmsOrder === true`, and `supporting_documents` elevates to Strong via `payload.signedContract === true`. The new gate makes the upload path discoverable on the Overview surface where it previously collapsed to a bare `Missing` pill. Categorization still runs through `classifyEvidenceRow({fieldKey, status, payload})` (`lib/argument/categoryBadge.ts`), the safe wrapper that — unlike `categorizeEvidenceField` — never lets missing/incomplete payload surface as "Invalid". Always-supporting fields always classify as Supporting; conditional fields (avs/cvv, delivery proofType, ip_location_check, billing_address_match, tds_authentication, device_session_consistency) only classify as Invalid when the payload carries explicit negative evidence (label-only shipment, both-fail AVS, etc.). Manual uploads from `data.attachments[]` (filtered `source === "manual_upload"`) render as a `+N attached file(s) included` line with filenames.

**Workspace API payload fallback (`app/api/disputes/[id]/workspace/route.ts`).** The `evidenceItemsByField` map preferentially keys off `evidence_items.payload.fieldsProvided` (set by `buildPack` since the persistence fix). For older packs whose evidence_items rows predate that fix, the API now falls back to `pack_json.sections[*].fieldsProvided` and synthesizes pseudo-evidence-item entries with the section's `data` as the payload. Without this fallback, the UI categorizer sees null payloads, AVS/CVV/IP signals classify as Invalid by default, and `caseStrength.score` collapses to 0 — turning evidence-rich submitted packs into "Hard to win / 0% confidence" hero pills. This fix restores payload reachability for every legacy pack on read.

### Evidence strength rubric (P2.7)

Per-signal verdicts come exclusively from `categorizeEvidenceField()` in `lib/argument/canonicalEvidence.ts`. The rubric below is the **canonical contract** every category badge in the embedded UI agrees with — Overview "What supports your case", Overview "Evidence collected", Evidence tab pills, and the strengthReason composer in `caseStrength.ts`. Merchant-facing version of this rubric lives in `messages/{locale}.json` under `help.articles.evidenceStrengthRubric.body` and is rendered by the embedded help drawer (slug `evidence-strength-rubric`).

**Strong (weight 3) — materially improves likelihood of winning:**
1. `avs_cvv_match` — AVS match AND CVV match (both).
2. `shipping_tracking` / `delivery_proof` — `proofType === "signature_confirmed"`.
3. `supporting_documents` — `payload.signedContract === true` (signed customer agreement uploaded).
4. `device_session_consistency` — `consistent && loginPresent && ipMatch` all true.
5. `customer_account_info` — `priorUndisputedOrders >= 1` OR (`totalOrders >= 1` AND `disputeFreeHistory !== false`).
6. `customer_communication` — `payload.customerConfirmsOrder === true`.
7. `activity_log` — `decisiveSessionProof === true` OR `digitalAccessUsed === true`.
8. `refund_policy` / `shipping_policy` / `cancellation_policy` — `acceptedAtCheckout === true` AND `acceptanceTimestamp` set.
9. `shipping_tracking` / `delivery_proof` — `proofType === "delivered_confirmed"` AND `deliveredToVerifiedAddress === true`.
10. `tds_authentication` — `tdsVerified === true` (merchant-confirmed manual upload only; the auto-collector never sets this).
11. `billing_address_match` — `match === true`.

**Moderate (weight 2) — useful but not decisive alone:**
- `avs_cvv_match` — exactly one of AVS / CVV matches.
- `shipping_tracking` / `delivery_proof` — `proofType === "delivered_confirmed"` without `deliveredToVerifiedAddress`.
- `ip_location_check` — clean match, no VPN/proxy/hosting flags, `bankEligible !== false`.
- `device_session_consistency` — `consistent === true` only.
- `tds_authentication` — `tdsAuthenticated === true` AND `verifiedSource === "shopify_receipt"` (auto-collected from `OrderTransaction.receiptJson` — see below).

**Supporting (weight 0) — never elevates the hero:**
- `order_confirmation`, `product_description`, `duplicate_explanation` — strict `supportingOnly: true`. Always supporting regardless of payload.
- All conditional fields without their decisive payload discriminator: policy text only, account info without prior orders, activity log without session proof, customer communication without explicit confirmation, supporting documents without `signedContract`, IP data with privacy flags or `bankEligible: false`, `delivered_unverified` shipments.

**Invalid (weight 0) — only on explicit negative evidence:**
- `avs_cvv_match` — both codes present, neither matches.
- `shipping_tracking` / `delivery_proof` — `proofType === "label_created"` (label only, no movement).
- `billing_address_match` — `match === false`.
- `tds_authentication` — payload is present but neither `tdsVerified === true` nor (`tdsAuthenticated === true` AND `verifiedSource === "shopify_receipt"`). Absence of 3DS is *not* invalid — the auto-collector never emits a row when 3DS was not used, so a missing `tds_authentication` row is the normal "no signal" state.
- Unknown / unregistered field keys (filtered out before reaching the UI).

The categorizer NEVER returns Invalid because payload is missing. The UI wrapper `classifyEvidenceRow()` further enforces this for display: when the discriminator key isn't present in payload, the row falls back to Supporting, never Invalid. **Collected ≠ Strong; Supporting ≠ bad; Invalid only fires on explicit harmful/unusable data.**

**Family-specific scoring.** Default formula (every reason except fraud): `strongCount >= 2 → Strong`; `strongCount === 1 && moderateCount >= 1 → Moderate`; `else → Weak`. Supporting items NEVER affect strength regardless of volume (P2.1.1). Signal-level dedup means multiple `evidenceFieldKey`s sharing a `signalId` (e.g., `delivery_proof` + `shipping_tracking`, `avs_cvv_match` + `tds_authentication`, `activity_log` + `customer_account_info`) count once.

**Fraud / unauthorized-transaction rule (overrides the default formula when `family === "fraud"`).** Payment authentication is the decisive signal for these disputes; the rule reflects that:

- **Strong** —  
  `strongCount >= 2`  
  OR `avs_cvv_match` Strong + delivery (signalId `delivery`) Strong/Moderate  
  OR `avs_cvv_match` Strong + device/session (signalId `device_session`) Strong/Moderate  
  OR `avs_cvv_match` Strong + customer communication (signalId `communication`) Strong
- **Moderate** —  
  `avs_cvv_match` Strong (alone — no other Strong/Moderate corroboration)  
  OR `strongCount === 1 && moderateCount >= 1`  
  OR `moderateCount >= 2`
- **Weak** — otherwise (no Strong AND fewer than 2 Moderate signals).

The "AVS-Strong-alone" path is special-cased so the hero never reads as "Hard to win" while AVS+CVV match — the case is shown as **Needs strengthening** (amber tone, distinct from "Could win") with the body copy *"Payment authentication supports this defense, but additional decisive evidence such as delivery confirmation, device/session consistency, or customer confirmation would improve the case."*

`caseStrength.heroVariant` exposes this UI accent (`likely_to_win` / `could_win` / `needs_strengthening` / `hard_to_win`) so `OverviewTab.tsx` can pick the right label + tone without re-deriving from `overall + strongCount + family`.
7. **O4 — Evidence coverage (compact 2026-04-26).** Headline reflects critical-missing count; bar driven by `pack.completenessScore` (server-computed). Bottom row flips between "Supporting evidence complete ✓" (when the recommended bucket is fully present) and "{N} supporting item(s) missing". The previous Critical / Supporting / Optional breakdown rows and "View all evidence" button were removed to match the Figma overview body — the Evidence tab is the canonical source of truth for the per-bucket view, so duplicating it on Overview was redundant.

**Checklist reconciliation (`lib/packs/checklistReconcile.ts`).** Pure helper. `collectedFieldsFromPack({sections, evidenceItems})` unions every `fieldsProvided` entry; `reconcileChecklistWithCollectedFields(checklist, collected)` flips rows from `missing` → `available` for fields the pack actually carries. `unavailable`, `waived`, and already-`available` rows are preserved. Wired in two places: (a) `buildPack.ts` runs it after `evaluateCompletenessV2` so the persisted `checklist_v2` and metrics match the collected sections; (b) the workspace API runs it on read so older packs (built before the build-time wiring) normalize for the UI without a rebuild. This fixes the regression where pack-template paths could leave policies / IP / supporting fields flagged `missing` even though the collectors had produced them, making the Overview look empty for evidence-rich packs.
7. **Automation rule card.** Applied-mode pill + helper from `appliedRule.mode` + `Change rule` button → `/app/rules?family={mapReasonToRulesFamily(reason)}`.
8. **Footer CTAs.** Pre-submit: `Edit evidence` + `Submit to Shopify`. Post-submit: `Set up policies for future cases` (only when `missingItems` includes a refund/shipping/cancellation policy) + `View in Shopify Admin` (deep link via `getShopifyDisputeUrl`).

**§3.E empty-state taxonomy.** Every rendered evidence/payload field uses exactly one of: `Present` / `Missing` / `Not applicable` / `System unavailable` / `Waived`. Mapping rules from `ChecklistItemV2`:
- `status === "available"` → **Present** (success tone).
- `status === "missing"` AND `collectionType ∈ {"auto", "conditional_auto", "unavailable"}` → **System unavailable** (the source can't supply it; not a merchant gap).
- `status === "missing"` AND `collectionType === "manual"` → **Missing** (critical tone, with `Add this evidence` CTA when not submitted).
- `status === "waived"` → **Waived**.
- Default: **Missing**.

**What was removed from the previous OverviewTab.** `synthesizeDefenseBullets` + `DEFENSE_RULES` (UI synthesis), the local `WHY_EVIDENCE_MATTERS` description map (UI synthesis), `STRENGTH_LABEL` and `strengthTone` helpers (no UI strength classification), `extractIpLocationPayload` (IP verdict surfaces from the per-row taxonomy state), the inline status/strength/deadline grid + recommendation block (replaced by O1 hero reading the same fields from `derived.*`).

**Shared header card (`WorkspaceShell.tsx`).** A single white card above the tab strip — title `Dispute #<id8> — <reason>` (`text-xl/600`), two flat status pills (`px-2 py-0.5 rounded-md text-xs/600` — Submitted/Needs action + Strong/Moderate/Weak case from `derived.caseStrength.overall`), and a 4-column responsive facts grid (Amount, Customer, Date filed, Dispute reason) separated from the title row by a `border-top: 1px solid #E1E3E5` divider. Card is `border-radius: 8`, `padding: 20`, `box-shadow: 0 1px 2px 0 rgba(22,29,37,.05)` to match the Figma `shopify-dispute-detail` Make source (lines 68-103). The pills are flat rectangular spans (not Polaris `<Badge>`) so the shape matches Figma; colors map by strength: strong → `#D1FAE5/#065F46`, moderate → `#FEF3C7/#92400E`, weak/insufficient → `#FEE2E2/#991B1B`. Shared by Overview, Evidence, and Review & Submit.

**Decision rule.** Backend prerequisites land before any UI rebuild. The UI never synthesises strength labels, defense claims, or numeric confidence values. Anything not visible in this section's source list is not allowed in the JSX.

---

### Overview tab structure (legacy decision-engine description, retained for context)

The earlier (pre–v3 rebuild) Overview tab was structured as a **decision-oriented recommendation engine**. Its sections — Case Summary card, Page header, Case Status with recommendation, How we defend this case, Your supporting evidence, Evidence by category — described below for historical context. The merchant-facing copy (recommendation strings, taxonomy labels, automation rule helpers) is preserved in the new layout via the backend prerequisites listed above.

The Overview tab is structured as a **decision-oriented recommendation engine**, not a dashboard. It answers three questions only: *what is this page for, what is the current state, what should the user do next.* Sections, in order:

0. **Polaris page title** (in `WorkspaceShell`) — `"Dispute #1068 — Unauthorized transaction"` using `merchantDisputeReasonLabel()` from `lib/rules/disputeReasons.ts`. The subtitle is intentionally omitted: order/amount/customer/state now live in the Case Summary card so the page header carries identity only.
1. **Case summary card** (first block in `OverviewTab`) — answers *what is this dispute*, scannable in under two seconds. Two-column layout: left column is the **amount at risk** rendered at `heading2xl` size for prominence; right column is a tight grid of order, customer, dispute reason, and submitted-on date (or "Awaiting submission"). Strict separation of concerns: this card is identity-only — it never repeats status, strength, deadline, or recommendation copy.
2. **Page header** — `"Review your defense before submitting to Shopify"` when the pack has not been saved to Shopify, or `"Your defense has been submitted to Shopify"` after submission. Lives inside `OverviewTab` itself between the summary and status cards.
3. **Case status card** (top priority for *what to do*) — single block with three facts (status, strength, deadline/submitted-on date) plus a bold **`Recommendation:`**-prefixed sentence. Submitted + strong/moderate: `"Recommendation: No further action is required. Your defense has been successfully submitted. We will notify you when the bank responds."` Submitted + weak: `"Recommendation: Monitor this case. Consider strengthening evidence for future disputes."` Not submitted: `"Recommendation: Submit now..."` / `"Recommendation: You can submit, but adding <missing>..."` / `"Recommendation: Add <missing> before submitting..."`. Submitted helper line shows elapsed days plus the response window: `"<N> days since submission. The issuing bank typically responds within 30–75 days."` Primary CTA: **Submit to Shopify** + **Edit evidence** when not submitted; **View in Shopify** (deep link to `admin/payments/dispute_evidences/:id`) once submitted. **Secondary post-submit CTA is gated on actual gaps in this case** (`OverviewTab.tsx`): if a refund/shipping/cancellation policy is missing → "Set up policies for future cases" → `/app/policies` (highest leverage: published policies auto-attach to every future pack); else if any non-policy field is missing → "Automate this for future cases" → `/app/rules?family=<id>` deep-linked to the family that matches this dispute's reason; if nothing is missing, no secondary CTA renders.
3. **How we defend this case** — fixed intro `"We are arguing that this transaction was legitimate based on:"` followed by assertive bullets synthesized from which evidence fields are present (`DEFENSE_RULES` in `OverviewTab.tsx`). Examples: *"Payment verification checks passed (AVS/CVV)"*, *"Order was successfully fulfilled and delivered"*, *"Customer behavior matches previous legitimate purchases"*. No counterclaim IDs, no hollow-circle placeholders.
4. **Your supporting evidence** — one row per checklist item with three signals: status badge (Included / Missing), strength badge (Strong / Moderate / Weak without it / Helpful), and an outcome-driven one-liner from `WHY_EVIDENCE_MATTERS` (e.g., *"Security checks passed — strong indicator of legitimate cardholder use."*). Missing items expose an inline "Add this evidence" button that jumps to the Evidence tab focused on the field.
5. **Evidence by category** — a one-sentence interpretation line above the progress bar (*"Coverage is complete. All required evidence categories are fully supported."* / *"Coverage has critical gaps..."* / *"Coverage is mostly complete..."*), then the bar, then per-category rows with a Fix button on gaps.

*(A "What Shopify will receive" card previously sat between *Your supporting evidence* and *Evidence by category*. It was removed because it duplicated the defense messaging already carried by the *How we defend this case* and supporting-evidence cards without adding a decision the merchant could act on.)*

Rule: every section must explain *why* something matters and guide the user toward the next action. No raw scores, no system jargon, no generic dashboard phrasing. Assertive language only.

### Evidence tab structure (4-section IA, 2026-05-02)

**Status:** active. Supersedes the *decision-driven analysis* layout below (retained for context). The 1737-LOC `EvidenceTab.tsx` was replaced with a thin orchestrator that delegates to four labelled sections fed by a pure-derivation hook (`useEvidenceSections`). Backend logic — scoring, classification, payload generation — was **not** touched. The hook reads existing workspace data and produces a typed view-model; no new fetches, no new fields, no new API.

**Hard rules (enforced by the hook + components):**
- **No percentages anywhere.** No "83% evidence collected", no coverage bars, no progress meters.
- **No predictive copy.** No "Likely outcome", no win/loss probability language.
- **Strength is read verbatim from `caseStrength.overall`.** The raw value (`strong | moderate | weak | insufficient`) is preserved through the view-model; `insufficient` is mapped to *Weak* only at the `CaseSummaryCard` display layer, never in the hook.
- **Item-level row strength is exactly `Strong | Moderate | Supporting`.** "Weak" is reserved for the case-level chip; item rows use *Supporting* as the lowest positive label.
- **Three buckets are visually unambiguous:** submitted to Shopify/bank ▸ internal-only (not submitted) ▸ missing/optional. Negative or weakening evidence is visible to the merchant but never appears under any "submitted" section.

**Sections (in order):**

1. **Case summary** (`CaseSummaryCard.tsx`) — single card with a hero-row visual hierarchy (refactored 2026-05-09). Layout: a small subdued caption (`disputes.evidenceTab.sections.summary.title`) above an `InlineStack align="space-between"` hero row that pairs a large strength `Badge` + the next-step sentence as the section heading on the left with the Status and Automation badges anchored on the right. Below the hero row, an optional explanation block renders only when `strength !== "strong"` and at least one of `strengthReason` / `improvementHint` is present — collapsed under a single `whyLabel` subheader so the two paragraphs read as one labelled region instead of two competing fields. The footer disclaimer ("DisputeDesk will handle this automatically..." / "Review required before submission.") sits at the bottom as subdued body text. Signals (unchanged):
   - Case-strength chip (`caseStrength.overall` verbatim; `insufficient → Weak` is display-only).
   - Status chip — `Submitted | Needs attention | In progress`, derived from `derived.isReadOnly`, `derived.isFailed`, and `derived.readiness`.
   - Automation chip — `Automatic | Review required` from `data.appliedRule.mode` (the canonical two-mode rule from `feedback_two_automation_modes.md`; `null` defaults to Review-required).
   - Next-step sentence — one of four fixed copies driven by `readiness × automationMode`, now rendered as the hero-row heading (no preceding "Next step" caption — the sentence is self-explanatory):
     - `ready_no_action` → "Ready — no action needed" (`readiness === "ready"` AND automation = automatic).
     - `submit_now` → "Submit now" (`readiness === "ready_with_warnings"` OR `ready` + review mode).
     - `review_missing` → "Review missing evidence below" (`readiness === "blocked"`).
     - `submitted_no_action` → "Submitted — no further action required" (`isReadOnly === true`).
   - Plus the merchant-facing automation copy sourced from `disputes.evidenceTab.automation.{automatic|reviewRequired}`.

2. **Evidence used in defense** (`EvidenceUsedSection.tsx` + `EvidenceRow.tsx`) — lists **all** signals supporting the case regardless of submission destination, **grouped into Strong / Moderate / Supporting buckets** (refactored 2026-05-09). Sources unchanged: `derived.contributions.strong[]` + `derived.contributions.moderate[]` (the canonical `computeContributions` output from `lib/argument/caseStrength.ts`) plus a third pass over `effectiveChecklist` that picks up `available` items at `supporting` level. The view-model still returns one flat `EvidenceRowViewModel[]` already sorted strong → moderate → supporting; bucketing is a pure-presentational `O(n)` partition in the section component. Each non-empty bucket renders a header row with a strength `Badge` + a parenthesised count (e.g. **`Strong (1)`**), then its rows. **The per-row strength badge is intentionally omitted** because the bucket header carries the strength signal — keeping it on each row would duplicate visual weight across homogeneous rows. Each row now answers: **What it is** (title, with optional native-attachment success badge), **Source** (`Shopify | Merchant upload | Derived`, rendered as a subdued metadata strip on the right of the title row using `InlineStack align="space-between"`), and **Why this matters** (single reason-aware sentence on its own line, no literal `Why this matters:` prefix — the sentence is self-explanatory in context). A short explainer below the section title reads *"Evidence can be included either as structured Shopify fields or inside the rebuttal narrative sent with the case."* The `disputes.evidenceTab.row.whyThisMatters` i18n key is kept in the message catalogue but is no longer rendered as a label prefix; all other `row.*` keys (`source`, `sourceShopify`, `sourceMerchant`, `sourceDerived`) remain in active use.

3. **Missing or weak evidence** (`MissingOrWeakSection.tsx`) — only items with `status === "missing"`, fed from `derived.missingItems`. Each row carries Title, Why-it-matters, Required/Optional chip. **Inline merchant actions** (added 2026-05-02): an `Upload evidence` button (hidden `<input type="file">` → `actions.uploadEvidence(field, files)`) and a `Mark as not applicable` button that opens a section-level Modal (single Polaris `Select` of the existing `WaiveReason` values → `actions.waiveItem(field, reason)`). No DropZone, no per-row state — minimal Polaris primitives only. Section collapses entirely (returns `null`) when the list is empty.

4. **Internal-only signals** (`InternalOnlySignalsSection.tsx`) — **always rendered**, even when empty, so the merchant always has a definitive answer to "is anything being held back?" The disclaimer (`disputes.evidenceTab.sections.internalOnly.disclaimer` — *"These signals inform our assessment but are not submitted to Shopify."*) **leads** the section as a subdued lead-in (refactored 2026-05-09); previously it sat below the list, which surfaced "mismatch!" copy first and read alarmingly. Multiple signals are separated by a thin Polaris `Box` divider (`borderBlockStartWidth="025"`) so the heterogeneous items don't blur together. Populated by a minimal classifier in `useEvidenceSections.ts` reading existing payloads:
   - **AVS or CVV mismatch** when `payload.avsResultCode` is set and not `"Y"/"A"` OR `payload.cvvResultCode` is set and not `"M"`. Absence of codes is never a negative signal.
   - **IP geolocation country mismatch** when `payload.locationMatch === "different_country"` (per `lib/packs/sources/deviceLocationSource.ts`).
   - **High-risk IP routing** when `payload.riskLevel === "high"` (VPN / proxy / data-center).
   - **Generic catch-all** for any field whose payload sets `bankEligible: false`. Future negative-signal collectors light this up automatically without code changes.
   - Empty state copy: *"No internal-only signals. All relevant evidence is included in your defense."*
   This honors `feedback_bank_optimized_rebuttal.md` — weakening signals are visible to the merchant but never appear under §2.

**Destination chip `includedAs` (`form_field` | `rebuttal_text` | `not_included`):** derived in `useEvidenceSections.ts` by `deriveSubmissionDestination()` from the same source the actual mutation reads — `data.submissionFields[].included` plus the `EVIDENCE_TO_SHOPIFY` field-name map. Resolution order: waived/`clientState.excludedFields` → `not_included`; `ATTACHMENT_FIELDS` (currently `supporting_documents`) → `form_field`; mapping with at least one mapped Shopify field in the included set → `form_field`; mapping intentionally empty (AVS/CVV, IP/location, device/session — derived signals folded into the rebuttal narrative) → `rebuttal_text`; mapping known but no mapped Shopify field included → `not_included`. **There is no `unknown` state** — every supporting row resolves to a deterministic destination. Each chip in `RowStatusChip.tsx` is wrapped in a Polaris `Tooltip` with destination-specific copy. Labels (2026-05-02 merchant-facing rewrite): `form_field` → **"Sent as Shopify field"** (tooltip: *"Submitted as structured evidence through Shopify (e.g. tracking, customer details, uploaded files)."*); `rebuttal_text` → **"Included in defense"** (tooltip: *"Included in the bank-facing rebuttal narrative."*); `not_included` → **"Internal only"** (tooltip: *"Not included in the bank submission. Used internally or excluded to avoid weakening the case."*). Internal token names (`form_field` / `rebuttal_text` / `not_included`) and the destination-resolution model are unchanged — only the merchant-facing labels and tooltips were rewritten away from "rebuttal vs field" jargon.

**Build / load / no-pack states:** surfaced as Polaris `Banner`s above the four sections — `isFailed → critical`, `isBuilding → info`, `pack === null → warning`. **Upload confirmation (2026-05):** after a successful `actions.uploadEvidence` call, `clientState.uploadSuccessNotice` holds the file name and checklist label; `EvidenceTab.tsx` renders a dismissible **success** `Banner` (`disputes.evidenceTab.uploadSuccessTitle` / `uploadSuccessBody`), auto-clears after 12 seconds, and `actions.dismissUploadSuccessNotice` clears it on dismiss — so merchants are not left wondering when an item disappears from **Missing or weak evidence** once the refreshed checklist marks it collected. The four sections still render below the banner stack with whatever data is available.

**Files of record:**
- `app/(embedded)/app/disputes/[id]/tabs/EvidenceTab.tsx` (composition only, ~120 LOC)
- `app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections.ts` (pure derivation hook)
- `app/(embedded)/app/disputes/[id]/tabs/sections/{CaseSummaryCard,EvidenceUsedSection,EvidenceRow,RowStatusChip,MissingOrWeakSection,InternalOnlySignalsSection}.tsx`
- i18n keys: `disputes.{caseStrength,itemStrength}` and `disputes.evidenceTab.{sections,row,automation,uploadSuccessTitle,uploadSuccessBody}` across all 12 locale files. English first; other locales mirror English copy until translated.

---

### Evidence tab structure — legacy decision-driven layout (retained for historical context)

The Evidence tab is the analysis surface for a single dispute. It must answer three questions in order: *Will I win this case? Why? What should I do next?* Sections, in order (Figma alignment 2026-04-26 — Plan C, no logic removed):

1. **Strength legend strip** — two flat pills + descriptors (Strong = direct proof; Supporting = reinforces). Pure presentation; no data wiring. Mirrors Figma `shopify-dispute-detail.tsx` lines 278-288.
2. **Claim-vs-defense split card** — 2-col grid. Left card red (`bg #FEF2F2 border-2 #FCA5A5`) reads "CUSTOMER CLAIM" + `argumentMap.issuerClaim.text`. Right card green (`bg #F0FDF4 border-2 #86EFAC`) reads "OUR DEFENSE" + the strongest counterclaim's `title` (sorted strong → moderate). Skips render entirely when `argumentMap` is null. Mirrors Figma lines 290-300.
3. **Top summary card** (`EvidenceTab.tsx`) — single outcome badge from `outcomeFromStrength(caseStrength.overall)`, a `Recommendation:` sentence, key strengths (top 3 from `whyWins.strengths`), and key gaps (top 3 from `missingItems` rendered through `impactSentence()`). Scannable in 3 seconds. The previous "Confidence" pill was removed 2026-04-26 — its `confidenceFrom(level, score)` helper used `score >= 70` / `score < 40` thresholds written against the legacy 0-100 ratio, but after the P2.1 scoring rewrite `score` became a count-based weighted sum (`strongCount * 3 + moderateCount * 2`, typically 0-N), so a moderate case landed in the `score < 40 → "Low"` branch and contradicted the header "Moderate case" pill. Single verdict only — same source as the persistent header. Follow-up (post-bid demo): unify all tabs around `caseStrength.heroVariant` so Overview, Evidence, and Review & Submit speak with one voice. Card chrome restyled to match the Figma rounded-8 + shadow-sm pattern.
4. **What supports this case** — Figma-style argument blocks. One block per `argumentMap.counterclaims[]` entry with strength `strong | moderate` (insufficient/weak excluded), ordered strong-first. Each block is a card with: leading icon (`counterclaimIcon()` picks `CreditCardIcon` / `DeliveryIcon` / `PersonIcon` / `GlobeIcon` / `LockIcon` based on the supporting fields), bold title, flat strength pill (`strengthPillStyle()`), chevron toggle. The collapse body has three row types in this order, all rendered together so the merchant reads what's backing the claim AND what's missing without leaving the block: (1) `claim.supporting[]` as green bullets (`CheckCircleIcon` for `available`, `MinusCircleIcon` for `waived`) — clicking a bullet calls `actions.navigateToEvidence(field)`. (2) `claim.systemUnavailable[]` as gray informational rows (`MinusCircleIcon` + label + italic *"— not yet available"*) — no CTA, since the system can't supply them (e.g. `delivery_proof` when the carrier hasn't reported delivered). (3) `claim.missing[]` as red action rows (`AlertTriangleIcon` + label + *"— add this evidence"* hint), pre-submit only — clicking navigates to the Evidence list where the row's Upload/Skip controls live. Submitted view renders the missing rows as plain text (no underline, no CTA, no hint suffix). Top 2 blocks open by default; the rest collapsed. Surfacing gaps inside the block makes the Strong→Moderate transition self-explanatory: when the partial-titles fix re-headlines a claim to "Order was shipped to the customer" (Moderate), the merchant sees both the supporting bullet (Shipping Confirmation ✓) and the gap row (Delivery confirmation — not yet available) without cross-referencing the Evidence inventory below. Earlier "argument purity" framing has been superseded — gaps belong inside the claim that needs them.
5. **Device & Location Consistency card (added 2026-04-28, Figma section 3)** — sits between argument blocks and Evidence inventory. Renders only when `pack.evidenceItemsByField.ip_location_check.payload` and/or `device_session_consistency.payload` is populated. Header: leading `GlobeIcon`, "Device and location data support a legitimate transaction" + "Supporting evidence" sub-line, trailing strength pill (Strong only when `device.consistent && device.loginPresent && device.ipMatch && ip.locationMatch ∈ {match, country_match}`; Supporting otherwise — matches the canonicalEvidence rubric). Body: green-checked rows for each line of `ipPayload.summary` (first line bold), an additional check-row when `device.consistent === true`, and an info-tinted callout for `ipPayload.merchantGuidance`. Surfaces IP/device data **independently of argument-layer citation**, fixing a long-standing gap where counterclaim templates don't reference these fields so the rich summary copy never reached the merchant on the Evidence tab.

6. **Evidence inventory (Figma alignment 2026-04-27, filter tightened 2026-04-28, inline Upload CTA added 2026-04-30)** — subdued container card (`bg #F6F8FB border #E1E3E5 rounded-lg p-5`). Header: heading + right-aligned status pill `{X} of {Y} included` with a 8-px state dot (green when X===Y, amber when partial, red when zero). Single flat list of rows replacing the prior three-subsection split — collected (`available` / `waived`) first, then missing in priority order (critical/recommended → optional). Each row is a `bg-white border rounded-lg p-3` card with: leading green `CheckCircleIcon` for included or hollow gray ring (`border 2px #6D7175 rounded-full`) for not-included, bold field name (`friendlyLabel`), `WHY_TEXT` descriptor below at `text-xs subdued`, trailing flat pill — green "Included" for collected, gray "Not included" for missing. Not-included rows are dimmed at `opacity 0.7` to match Figma's de-emphasis. **Inline Upload CTA (added 2026-04-30):** for not-included rows where `canMerchantUpload(item) && !readOnly`, an Upload button renders directly under the descriptor. Click triggers `actions.navigateToEvidence(item.field)` which expands the matching category in section 7 and — via the new `EvidenceItemInline` `useEffect` on `focusField` — opens the DropZone for that row. This closes a discoverability gap where the inventory was the merchant's primary "what's missing" surface but offered no action; merchants had to scroll past the Defense letter, find the right collapsed category, expand it, and only then see an upload affordance. **Filter rule (revised 2026-04-28):** suppress collected rows only when their classified category is `"invalid"` (explicit negative payload — AVS-flagged billing mismatch, label-only shipment, etc. via `classifyEvidenceRow`). The prior `!citedFields.has(c.field)` rule was hiding every IP/device/billing-match row because counterclaim templates never reference those fields; that produced the "evidence page seems to miss out on the IP and Locations data" symptom. Other filters preserved: `unavailable` status exclusion, `friendlyLabel` lookup, `WHY_TEXT` descriptors.
6. **Defense letter** (renamed from "Rebuttal letter") — collapsed by default to a 220-character excerpt of the summary section; full letter behind a disclosure control (Polaris `Collapsible`). Heading, toggle, and section labels (`Summary` / `Conclusion` / `Argument` fallback) are localized via `next-intl` keys under `disputes.evidence` (`defenseLetterTitle`, `viewFullDefenseLetter`, `hideFullDefenseLetter`, `defenseSectionSummary`, `defenseSectionConclusion`, `defenseSectionArgument`). Each section renders its evidence-ref tags (deduplicated) as clickable chips → `actions.navigateToEvidence(ref)`. Card chrome restyled.
7. **Evidence categories** — Per-category collapsible card (Figma chrome: rounded-8, shadow-sm, header is a `<button>` with category label + flat count pill + chevron). Each row uses `EvidenceItemInline`: the inventory status badge from `evidenceRowStatus()` (Included / Critical gap / Recommended / Not included), the canonical strength badge from `categoryBadge(categoryFor({ fieldKey, payload }))` (Strong / Moderate / Supporting / Invalid) for collected rows, content preview button, **Upload + Skip popover** when `status === "missing" && !readOnly && !uploading && canMerchantUpload(item)`, Undo button when waived, Spinner while uploading, error banner via `failedFields`, DropZone (`accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"`) calling `actions.uploadEvidence`. Skip popover lists the 5 `WAIVE_REASON_LABELS` calling `actions.waiveItem`. **Upload gate (revised 2026-04-30):** the prior `collectionType !== "auto"` rule hid the upload button for `customer_communication` (which is marked `auto` in the checklist generator because Shopify *attempts* to auto-collect order notes) — but that field only becomes Strong via `payload.customerConfirmsOrder === true`, which requires the merchant to provide a conversation. Auto-collection there is best-effort; merchant upload is the actual path to strength. The new `canMerchantUpload(item)` helper allows upload when the field key is in `MERCHANT_ACTIONABLE_FIELDS = { supporting_documents, customer_communication, product_description, duplicate_explanation }` *or* the prior `collectionType !== "auto"` test passes (preserves the 2026-04-24 manual fallback for `conditional_auto` rows). Mirrors the keys in `useDisputeWorkspace.ts` `FIELD_ACTIONS`. **Focus → DropZone reactivity (2026-04-30):** `EvidenceItemInline` now opens its DropZone via a `useEffect` on `focusField === item.field && status === "missing"`, not just on initial mount, so the new inventory Upload CTA (and the existing Overview "Add this evidence" button) actually surface the upload UI when navigated to the row.

**Submission gate (preserved):** every action (Upload / Skip / Undo / DropZone / Retry build) is hidden when `derived.isReadOnly === true`. The full state matrix (failed pack → Retry-only banner; not-submitted → all CTAs visible per row; submitted → CTAs hidden but inventory + argument blocks + defense letter still render) is unchanged.

**Removed in earlier rewrites:** the standalone "Argument summary" card, "Case strength" card, "Ways to strengthen this case", "Collected automatically" cards, and the closing-action guidance Banner. The 2026-04-26 Figma alignment did not remove any further logic — only swapped Polaris `<Card>` chrome for inline div styling and converted the per-counterclaim flat tag list into expand/collapse argument blocks.

### Review & Submit tab structure (4-section IA, 2026-05-02)

**Status:** active. Supersedes the *Figma alignment 2026-04-27* layout below (retained for context). The 1354-LOC `ReviewSubmitTab.tsx` was replaced with a thin orchestrator that delegates to four labelled sections fed by `useReviewView`. The Shopify mutation payload is rendered byte-for-byte; only the visual grouping is presentational.

**Live submission preview (2026-05-09):** `ReviewSubmitTab` now also calls a small client hook `useSubmissionPreview(packId)` that fetches `GET /api/packs/[packId]/submission-preview?format=raw`. That endpoint runs the **exact same** `composeShopifyMutationPayload` builder as the production save job (`saveToShopifyJob`), so the merchant view of "what will be sent" is byte-equivalent to the actual `disputeEvidenceUpdate` GraphQL input — including customer name/email and native file slot routing that the legacy `submissionFields` list does not expose. The preview hook's `loading: true` state surfaces a discreet inline indicator on §2; it never blocks the page or shows a skeleton (per the "no loading skeletons in §2" rule). The previously-separate `FileEvidenceRoutingCard` was removed in this rewrite — native file slot routing is now an inline attachment row inside the relevant group with an *"Attached to Shipping documentation"* badge.

**Authoritative field source (2026-05-09):** `useReviewView` reads the structured-field list from `submissionPreview.fields[]`, **not** from `data.submissionFields`. The latter is hardcoded to `[]` at the workspace API boundary (`/api/disputes/[id]/workspace`), so a Review tab driven only by workspace data would silently render only "Customer details" + "Final defense statement" — no Order details, no Policies, no Additional evidence text. The preview already maps `mutationPayload[fieldName]` → `{ shopifyFieldName, shopifyFieldLabel, content, included }` via the canonical `FIELD_MAPPINGS` table in `lib/shopify/fieldMapping.ts`. The fallback to `data.submissionFields` is preserved only for forward-compat if the workspace API ever starts populating it.

**Attachment surfacing fix (2026-05-09):** the workspace API (`/api/disputes/[id]/workspace`) previously filtered `evidence_items` to those with `payload.fileId`, but real merchant uploads from the embedded UI write `payload.storagePath` (and `payload.fileType` instead of `payload.mimeType`). The result: every uploaded file was silently dropped from `data.attachments`, so the Review tab never showed them. The filter now accepts either `fileId` or `storagePath` as the stable identifier and falls back to `fileType` for the mime type. The downstream UI uses the id only as a React key, so either source is interchangeable.

**Hard rules:**
- **§2 ("Exact data sent to Shopify") matches the actual mutation byte-for-byte.** The six readable groups are pure presentation; no field content is transformed, no values are reordered inside a group beyond field-by-field rendering.
- **No loading skeletons in §2.** When the payload is absent (pre-build / empty pack), render the explicit empty-state copy *"Save your evidence first to see exactly what will be sent to the bank."* and stop.
- **Bank-visible vs internal split is unambiguous.** §2 is what the bank sees; §3 lists what was excluded with a stable reason from a fixed dictionary; §4 is the rebuttal text.

**Sections (in order):**

1. **Submission status** (`SubmissionStatusCard.tsx`) — single card. Two states:
   - **Submitted**: `Evidence submitted to Shopify` chip + formatted timestamp (via `Intl.DateTimeFormat` with the active `next-intl` locale; bad ISO strings fall back to the raw value rather than throwing) + `Open in Shopify Admin` link from `getShopifyDisputeUrl(shopDomain, disputeEvidenceGid)` in `lib/shopify/shopifyAdminUrl.ts` (link hidden when the helper returns `null`).
   - **Ready to submit**: `Ready to submit` chip + the primary CTA. The CTA stays enabled whenever the system can accept a submit attempt (i.e. NOT `isBuilding` and NOT `isFailed`); readiness alone never disables the button — that would block the merchant outright. When `requiresOverride === true` (readiness blocked or `ready_with_warnings`), the CTA label flips to *"Submit anyway"* and the click routes through the override Modal instead of submitting directly.

2. **Exact data sent to Shopify** (`ExactDataSentCard.tsx`) — bank-visible payload bucketed into six fixed presentational groups in this order. Each group can hold structured text fields **and** files (merchant uploads, native Shopify file slots, the auto-generated pack PDF). Groups are separated by a thin Polaris `Box` divider:
   - **Order details** — `accessActivityLog` (timeline / order activity).
   - **Customer details** — `customerFirstName`, `customerLastName`, `customerEmailAddress` (sourced from the live mutation payload — these are not in the legacy `submissionFields` list).
   - **Payment verification** — currently no dedicated Shopify text field; AVS/CVV codes are embedded in `accessActivityLog` narrative. The header is hidden when the group has no rows (hide-when-empty rule).
   - **Customer activity** — `shippingDocumentation`, `shippingDocumentationFile`, `customerCommunicationFile`, `serviceDocumentationFile`. Native file uploads landing in any of these `*File` slots render as an attachment row with an *"Attached to <slot>"* badge.
   - **Policies** — `refundPolicyDisclosure`, `cancellationPolicyDisclosure`, `refundRefusalExplanation`, `cancellationRebuttal`, plus `refundPolicyFile` and `cancellationPolicyFile` native uploads.
   - **Additional evidence** — `uncategorizedText` plus `uncategorizedFile`, all `data.attachments` (merchant-uploaded files that did NOT land in a native slot), and the **auto-generated pack PDF** (`pack.pdfPath`) as a discrete attachment row with a *"Pack PDF"* badge so the merchant sees it isn't buried in the rebuttal text.
   Empty groups are stripped at the hook layer and not rendered. The six-group routing lives in `GROUP_BY_FIELD` (in `useReviewView.ts`); native slot routing uses `groupForNativeSlot()` in the same file. Maintenance touchpoint: a new Shopify field not in the map silently falls into `additionalEvidence` (matches Shopify's `uncategorizedText` semantics).

3. **Not submitted (transparency)** (`NotSubmittedCard.tsx`) — items present in the pack but excluded from the bank-visible payload. Sources: any `submissionFields` row with `included === false`, plus items in `clientState.excludedFields`. Each row carries a stable reason from a fixed dictionary (`avoid_weakening` / `gateway_gated` / `merchant_waived` / `write_only`) — never free-text. Section collapses (returns `null`) when the list is empty.

4. **Final defense statement** (`FinalDefenseStatementCard.tsx`) — full bank-rebuttal text rendered exactly as it will be sent. Header label *"This is the final statement sent to the card network."* Optional `Derived from:` sub-block lists contributing evidence categories (sourced from `derived.contributions.{strong,moderate}`'s labels — metadata, not weaknesses). When `data.rebuttalOutdated === true`, a warning Banner surfaces *"The evidence pack changed since this statement was generated. Regenerate to pick up the latest signals."* alongside a `Regenerate defense` button that delegates to `actions.regenerateArgument()`. `clientState.regeneratingArgument` drives the button's `loading` + `disabled` state. Card collapses entirely (returns `null`) when no rebuttal text exists.

**Override-submit flow (`ReviewSubmitTab.tsx`):** when the merchant clicks the CTA on a blocked or `ready_with_warnings` case, the tab opens a Polaris `Modal` that captures a reason from a fixed dictionary (`will_provide_separately | merchant_accepts_risk | classifier_uncertain | other`) plus an optional free-text note, then calls `actions.submitToShopify(reason, note)` — the existing API path that already logs override args into the audit log. The merchant is never blocked outright; the override path requires explicit intent.

**Build / load / no-pack states:** surfaced as Polaris `Banner`s above the four sections — same pattern as EvidenceTab.

**Files of record:**
- `app/(embedded)/app/disputes/[id]/tabs/ReviewSubmitTab.tsx` (composition + override modal, ~200 LOC)
- `app/(embedded)/app/disputes/[id]/tabs/useReviewView.ts` (pure derivation hook — merges workspace data + live submission preview)
- `app/(embedded)/app/disputes/[id]/tabs/useSubmissionPreview.ts` (live fetch of `/api/packs/[packId]/submission-preview?format=raw`)
- `app/(embedded)/app/disputes/[id]/tabs/sections/{SubmissionStatusCard,ExactDataSentCard,NotSubmittedCard,FinalDefenseStatementCard}.tsx`
- i18n keys: `disputes.reviewTab.sections.{status,dataSent,notSubmitted,finalStatement,override}` across all 12 locale files (added 2026-05-09: `dataSent.loading` and `dataSent.groups.customerDetails`).

---

### Review & Submit tab structure — legacy Figma alignment 2026-04-27 (retained for historical context)

The Review & Submit tab (`ReviewSubmitTab.tsx`) is the merchant's last decision surface — pre-submit it asks "Should I submit?", post-submit it answers "What did we send?" Two distinct compositions render off `derived.isReadOnly`:

**Pre-submit composition** (no behavior change from prior version, only card chrome restyled to match Overview/Evidence — `border-radius: 8`, `padding: 20`, `box-shadow: 0 1px 2px 0 rgba(22,29,37,.05)`):

1. **Decision Block** — readiness pill (Submitted / Blocked / Risky / Ready to submit, flat rounded-md spans, not Polaris `<Badge>`) + strength pill (Strong/Medium/Weak), dynamic `headline` keyed off `caseStrength.overall`, `whyWins.strengths[]` bullets, missing/`submitOverrideGaps` bullets (with the existing dual-source rule — if any override gap is present render those, else slice top 6 of `missingItems`), `improvement.action` next-step line.
2. **Primary action row** — "Submit evidence to Shopify" (gated by `canSubmit && !isSaving`, loading via `clientState.saving`); secondary "Improve case first" navigates via `actions.navigateToEvidence(improvement.field)` or `actions.setActiveTab(1)` fallback. `handleSubmit` routes weak/`ready_with_warnings`/`warningCount > 0` cases through the override modal.
3. **"What will be submitted" collapsible** — rebuttal-outdated warning Banner with `actions.regenerateArgument()` + local `regenerateError`; disclosure showing the same monospace `submissionMonoBlockStyle` block fed by `GET /api/packs/:packId/submission-preview`.
4. **Override Modal** — Polaris `Modal` (untouched). 5-reason `Select`, conditional "Other" `TextField`, weakness list when `isWeak`, `submitOverrideGaps` list, "Submit anyway" (destructive) calls `actions.submitToShopify(overrideReason, overrideNote)`. Disabled until reason is selected.

**Submitted composition** (Figma `shopify-dispute-detail` lines 535-834, refetch 2026-04-27):

1. **Submission Status Hero** — green card (`bg #F0FDF4 border-2 #86EFAC rounded-lg p-5`), CheckCircle 48×48 icon block, title "Evidence submitted to Shopify" + dark-green "Submitted" pill, formatted timestamp from `pack.savedToShopifyAt` (locale-aware, "Apr 20, 2026 at 3:42 PM"), white "View in Shopify Admin" anchor reusing `getShopifyDisputeUrl(shopDomain, disputeEvidenceGid)` — hidden when URL is null.
2. **Exact Data Sent to Shopify** — blue 2-px outlined card with a Formatted ⇄ Raw toggle. Formatted view renders `SubmissionField[]` as label/value rows with subdued labels and `contentPreview` values (right-aligned, word-break-word). Raw view lazy-fetches `?format=raw` (already supported by `app/api/packs/[packId]/submission-preview/route.ts:33-38`) once and caches `mutationPayload` in component state, then renders `JSON.stringify(payload, null, 2)` in a `<pre>` block. Raw fetch shows a Banner on error.
3. **What Was Sent (structured)** — soft-derived topic accordions built by `buildTopics(pack, fields)` from `pack.evidenceItemsByField` payloads (`order_confirmation`, `avs_cvv_match`, `customer_account_info`) and `SubmissionField[]` (policies). Each topic is silently skipped when its source data is empty. The first topic opens by default; only one open at a time. Layout matches Figma's native `<details>` pattern using a custom button + Polaris `Collapsible` so the chevron rotation animates.
4. **Final Statement Submitted to Bank** — blue 2-px outlined card. Renders `data.rebuttalDraft.sections.map(s => s.text).join("\n\n")` in a `bg #F6F8FB border-2 #E1E3E5 rounded-lg p-5` block. "Copy" button on the header runs `navigator.clipboard.writeText(rebuttalText)` and flips its label to "Copied" for 2 seconds (silent fallback in non-https contexts). Card is skipped entirely when `rebuttalDraft` is null.
5. **Supporting Documents** — iterates `data.attachments?.filter(a => a.source === "manual_upload")`. Per-row: leading icon picked by mime type (`ImageIcon` for `image/*`, `EmailIcon` for `message/rfc822`, `FileIcon` otherwise), filename, `"{TYPE} · {sizeFormatted} · Included in submission"` caption. No external-link action — there is no signed-download endpoint yet; the row is informational only. Card is skipped when `manualUploads.length === 0`.
6. **Important Disclaimer** — amber box (`bg #FEF3C7 border #FDE047 rounded-lg p-4`), `InfoIcon`, "Some evidence data (like IP address and device fingerprint) is not visible in Shopify Admin but has been submitted to the card network for review." Always renders post-submit.

**Activity Log** renders below both compositions when relevant audit events exist (`evidence_waived` / `evidence_unwaived` / `submitted_with_warnings` / `evidence_saved_to_shopify` / `admin_override`), capped at 5 most recent.

**System-failure short-circuit (preserved):** `derived.isFailed` returns a single critical Banner ("This pack can't be submitted"); no other surface renders.

**No-pack guard (preserved):** when `pack` is null, render a single subdued card prompting pack generation.

**State matrix preserved end-to-end:** failure → no-pack → submitted-vs-pre-submit branch → blocked / weak / warnings / saving / rebuttal-outdated. The submission gate (`canSubmit = readiness !== "blocked" && !isReadOnly`), override audit logging, and `submitToShopify` arguments are unchanged. No changes to `useDisputeWorkspace`, the submission-preview route, or any DB migration.

### Language requirement (English-only submission)

All evidence submitted to Shopify must be in English. This includes:
- Policy text (refund, shipping, cancellation, terms, privacy)
- Rebuttal / dispute response argument text
- Any merchant-provided text evidence (notes, explanations)
- Order timeline descriptions

Policy snapshots capture the store's current policy text, which may be in the store's default language. If policies are stored in a non-English language, the merchant must upload English versions before submission. The system should flag non-English content and prompt for replacement.

This rule is enforced in:
- `lib/shopify/fieldMapping.ts` — serialization layer
- `lib/packs/sources/policySource.ts` — collector documentation
- Evidence pack email preview scripts

## Evidence Pack Builder

### Build Pipeline (`lib/packs/buildPack.ts`)

1. Load dispute → shop → offline session from DB
2. Decrypt access token (AES-256-GCM)
3. Run 6 source collectors concurrently (`Promise.allSettled`)
4. Insert `evidence_items` rows + audit events per section
5. Compute completeness from collected fields
6. Assemble `pack_json`, update pack row

### Source Collectors (`lib/packs/sources/`)

| Collector | File | Fields Provided |
|-----------|------|-----------------|
| Order | `orderSource.ts` | `order_confirmation`, `billing_address_match`, `activity_log`, `customer_account_info` |
| Fulfillment | `fulfillmentSource.ts` | `shipping_tracking`, `delivery_proof` |
| Policy | `policySource.ts` | `shipping_policy`, `refund_policy`, `cancellation_policy` (terms, refunds, shipping; privacy/contact stored but not yet mapped to Shopify evidence) |
| Manual | `manualSource.ts` | `customer_communication` |

The `customer_account_info` section (2026-04-20) is distinct from `activity_log`: activity_log bundles customer tenure *and* timeline events for Shopify's `accessActivityLog` evidence field; customer_account_info is the account-profile signal in isolation (order count, account age, repeat-customer flag) so the "Customer account details" checklist row renders its own preview rather than duplicating the "Customer correspondence" preview. Pre-fix, migration `20260411120000` pointed both `customer_emails` and `customer_account_info` template keys at `customer_communication`, which produced two checklist rows with identical preview text. Migration `20260420120000_split_customer_account_info_collector.sql` remaps `customer_account_info` to its own collector field.

### GraphQL Queries

| Query | File | Purpose |
|-------|------|---------|
| `ORDER_DETAIL_QUERY` | `lib/shopify/queries/orders.ts` | Full order: line items, fulfillments, addresses, refunds, customer |
| `DISPUTE_LIST_QUERY` | `lib/shopify/queries/disputes.ts` | Paginated dispute list |
| `DISPUTE_DETAIL_QUERY` | `lib/shopify/queries/disputes.ts` | Single dispute with order + evidence |

### Manual Upload

- Endpoint: `POST /api/packs/:packId/upload` (multipart)
- Storage: Supabase Storage bucket **`evidence-packs`** (same bucket as rendered pack PDFs), object key **`{shopId}/{packId}/manual-{timestamp}.{ext}`** — path is relative to the bucket only (no extra bucket-name prefix in the key).
- `evidence_items.payload` includes `storagePath` and `storageBucket` (`evidence-packs`) for new rows. Older rows may omit `storageBucket` or point at legacy paths.
- **Bucket MIME / size is controlled in-repo**, not via the Supabase dashboard. Two migrations upsert each bucket as private with `allowed_mime_types = null` and `file_size_limit >= 10 MB`:
  - `20260424150000_evidence_uploads_bucket.sql` — legacy `evidence-uploads`.
  - `20260424170000_evidence_packs_bucket_mime.sql` — active `evidence-packs`.
  Both buckets had been created in the dashboard with `allowed_mime_types` restricted to `application/pdf` (chosen at creation time because the only writer then was `renderPdfJob`). That restriction made Storage return **400** when merchants later uploaded JPEGs / PNGs through `/api/packs/:packId/upload`. MIME allowlisting is now enforced in the API layer (see `lib/uploads/shopifyDisputeEvidenceFileConstraints.ts`), not at the bucket.
- **Shopify Payments alignment:** allowed types **PNG, JPEG, PDF** only; each file **≤ 4 MB**; **combined** size of all `manual_upload` evidence files on the same pack **≤ 4 MB** (mirrors [Shopify dispute file upload](https://shopify.dev/docs/api/admin-rest/latest/resources/dispute-file-upload) guidance). Rejects GIF, WebP, CSV, plain text, etc.
- Creates `evidence_items` row with `source: manual_upload`.
- **Merchant-safe errors (2026-04-24):** on Supabase Storage failures the API maps the raw error to controlled copy (`merchantUploadMessage` in `app/api/packs/[packId]/upload/route.ts`) — MIME restriction, size limit, and duplicate-name get distinct messages; everything else gets a generic "try again / contact support". The raw Supabase message (`errorMessage`, `errorName`, `bucket`, `storagePath`, `fileType`, `fileSize`) is still logged server-side under `[packs/upload] storage upload failed`. The dispute workspace hook (`useDisputeWorkspace.uploadEvidence`) reads the response `{ error }` and shows it as the inline banner instead of the previous generic "Upload failed — try again" string.
- **Checklist patch writes v2 (2026-04-24):** the upload route updates `checklist_v2` (source of truth for the dispute workspace UI) alongside the legacy mirrors (`checklist`, `blockers`, `recommended_actions`, `submission_readiness`, `completeness_score`) in a single `evidence_packs` update. The client sends the specific checklist `field` it was uploading for (e.g. `shipping_tracking`); the server loads the prior `checklist_v2`, flips that field's row plus the generic `MANUAL_UPLOAD_FIELD` (`supporting_documents`) row to `status: "available"`, and leaves every other row untouched. Score, readiness, and legacy mirrors are then derived from the patched checklist via `deriveCompletenessMetrics(checklist)` (extracted from `evaluateCompletenessV2` so both sites share the formula). Prior behaviour updated only the legacy v1 `checklist`, so the row appeared green from the client's optimistic `completedFields` overlay and then reverted to "Upload | Skip" on the next 4 s poll when `fetchAll()` cleared that overlay. An intermediate fix re-ran `evaluateCompletenessV2(...)` with `null` `orderContext` — that regressed sibling `required_if_fulfilled` rows (e.g. `delivery_proof`) back to `status: "unavailable"` because `DEFAULT_ORDER_CONTEXT.isFulfilled` is `false`, which the workspace renders without an Upload button. Patching the prior checklist avoids re-resolving order-context-sensitive statuses without the Shopify order on hand. Waived rows are preserved (never flipped by an upload). Library-pack uploads (no `dispute_id`, no `field`) still patch the generic `supporting_documents` slot.
- **Manual fallback for `conditional_auto` rows (2026-04-24):** the evidence-row action gate in `app/(embedded)/app/disputes/[id]/tabs/EvidenceTab.tsx` renders the Upload/Skip buttons for every `status === "missing"` row whose `collectionType !== "auto"`. Previously the gate was `collectionType === "manual" || !collectionType`, which hid the buttons for `conditional_auto` rows (e.g. `delivery_proof`, `shipping_policy`) even when the merchant had alternative proof — a signed delivery photo, a carrier-email screenshot, a PDF of the policy text — that auto-collection didn't pick up from the Shopify order. Pure `auto` rows (order_confirmation, activity_log, AVS/CVV, ip_location_check) still hide the buttons because those are strictly system-owned. `unavailable` statuses stay hidden naturally via `status === "missing"`. The `evidenceRowStatus` badge helper in `lib/argument/evidenceStatus.ts` still treats `conditional_auto` as system-derived for label purposes (rows read "Not included" rather than "Critical gap" / "Recommended") — that's intentional, since the row was never classified as a merchant gap by the automation template; the Upload button is an opt-in fallback, not a promoted action.

### Pack detail page: template vs dispute mode

The pack detail page (embedded `app/packs/[packId]` and portal `portal/packs/[packId]`) is used in two contexts, distinguished by `evidence_packs.dispute_id`:

- **Template (library) pack** — `dispute_id == null`. The user is defining a **reusable template** that specifies what evidence to collect. This template is applied automatically (or manually) when a dispute matches. The UI shows "Define your evidence template", a checklist of required evidence types, optional sample files, and a "When this template is used" card. **Save evidence to Shopify** and **Submit in Shopify Admin** are not shown (they apply per dispute when the template is used).
- **Dispute pack** — `dispute_id != null`. Task-based workflow for one specific dispute. Three sections: (1) **Header** — single status message + next action CTA, (2) **Evidence Builder** (left column) + **Submission Sidebar** (right column) in a 3fr/2fr CSS grid, (3) collapsed **Activity Log**. The evidence builder groups items into **Required** (red, must complete to unblock), **Recommended** (amber, optional), and **Already Included** (collapsed). Upload happens inline per evidence item via `DropZone` — no generic upload box. Completing an upload optimistically moves the item from Required/Recommended to Already Included. Header CTA scrolls to and auto-expands the first missing required item. Sidebar shows only a fraction (`Required: X/Y`) and Submit/Export buttons — no messaging. Post-submit the page becomes read-only.

Components: `PackHeader.tsx`, `EvidenceBuilderSection.tsx`, `EvidenceItemRow.tsx`, `EvidenceContentViewer.tsx`, `SubmissionSidebar.tsx` in `components/packs/detail/`. CSS module: `app/(embedded)/app/packs/[packId]/pack-detail.module.css`. i18n keys: `packs.header*`, `packs.cta*`, `packs.builder*`, `packs.upload*`, `packs.sidebar*`, `packs.confirmSubmit*`, `packs.why*`.

**Evidence tabs:** The "Already included in your submission" section uses Polaris `Tabs` to let merchants inspect each evidence item's content. `EvidenceContentViewer` renders structured payload data (order details, shipping/tracking, policies, communications, AVS/CVV results, manual uploads) based on `evidence_items.type` and `source`. Falls back to a flat list when no full evidence data is available.

Conditional copy and sections are driven by `isLibraryPack` (derived from `pack.dispute_id == null`) in both embedded and portal pack detail pages. **Localized pack names:** for template-backed packs, the API overrides `pack.name` at read time with the localized template name from `pack_template_i18n` (locale fallback: requested → en-US → any), so Portuguese merchants see Portuguese pack titles without re-installing.

### Auto-collected evidence vs manual upload

When a pack is **built** for a dispute (automation or "Generate Pack"), evidence is collected automatically from Shopify and stored policy snapshots: order data (orderSource), fulfillment/tracking (fulfillmentSource), and store policies (policySource). Manual upload is for **additional** evidence that is not in Shopify (e.g. customer emails, screenshots, custom receipts). Uploads are per-item: each missing evidence row has an inline upload button that expands a `DropZone`. On successful upload the item moves to the "Already included" section. Failed uploads show inline error with retry. Uploaded items in "Already included" offer a "Replace file" action.

### Template Customize Wizard (Portal)

The **Template Setup Wizard** is a 4-step full-page flow in the portal for configuring a new evidence template before it is used for disputes.

- **Route:** `/portal/packs/customize`. Optional query `?template=...` can identify the source template (e.g. from the template library). The same wizard is shown when opening a template (library) pack at `/portal/packs/[packId]` when `dispute_id` is null.
- **Implementation:** `components/packs/detail/TemplateSetupWizard.tsx`; entry points: `app/(portal)/portal/packs/customize/page.tsx` and pack detail page. Uses `Button`, `Badge`, `cn()` from `@/components/ui`; copy from `templateCustomize` i18n namespace in `messages/en.json` and `messages/en-US.json`.
- **Steps:**
  1. **Choose evidence to collect** — Select which evidence types (Required / Recommended / Optional) this template should gather. Each type shows how it is provided: **Auto-collected from Shopify**, **Set in Policies** (with status “Policy set” or “Not set — Add in Policies”), or **You add manually**. All required must be selected to continue.
  2. **Set evidence sources** — Full-page “Where will DisputeDesk get this evidence from?” Each selected type is shown with an icon callout (auto / reusable store document / manual) and short explanation. For **reusable** types: if the user already has that policy set, the wizard suggests “We suggest using your [Refund policy]” with **Use this policy** and **Change or upload another**; if not set, **Set in Policies** and **Upload file**. “Change or upload another” / “Upload file” open an in-wizard **modal** so the user can stay in session: they can open Policies (with a return URL) or upload a file in the modal. Links to the Policies page include `returnUrl` (current path + `step=2`) so the user is guided back to the wizard. The wizard reads `?step=` from the URL so returning lands on the correct step. A summary row shows counts: X Automated, X Reusable, X Manual.
  3. **Review how automation works** — Explains the flow: dispute appears → pack prepared → ready to review. **Submission choice:** Auto-submit to Shopify on the dispute due date, or email to review and submit manually. “Important to know” copy reflects the chosen option.
  4. **Activate template** — Summary (evidence types count, how evidence is provided, dispute type, source) and actions: Save as draft or Activate template (both navigate back to `/portal/packs`).
- **Policy link-back:** When building a pack, policy evidence stores `policySnapshotId` in the evidence item payload so the source policy can be traced. The Policies page supports `?policy=refunds|terms|shipping` to scroll to the relevant policy section. When the user is sent from the wizard with `?returnUrl=...`, the Policies page shows a “Return to template setup” link so they can get back to the wizard without losing context.
- **Sidebar:** Sticky panel with setup progress percentage, step checklist, template status badge (Ready / In progress), and links: Back to templates, Export a PDF copy.
- **Navigation:** Back link to Evidence Packs; step navigation (Back, Continue) does not yet persist to API — the wizard is UI-only until backend endpoints for creating/updating template packs from the wizard are added.

### Policy Templates & Store Policy Upload (Portal)

Store policies are included in evidence packs. Five policy types are supported: **Terms of Service**, **Refund Policy**, **Shipping Policy**, **Privacy Policy**, and **Contact Information & Customer Service Policy**.

**Policy Library:** Metadata (title, description, best-for, dispute-defence value, placeholders, merchant notes) lives in `lib/policy-templates/library.ts`. Template bodies are Markdown in `content/policy-templates/` (English) and `content/policy-templates/{lang}/` for translations (e.g. `de/` for German).

**APIs:**
- `GET /api/policy-templates` — Returns the Policy Library (all five templates in display order, with pack title/subtitle).
- `GET /api/policy-templates/[type]/content?shop_id=...` — Returns the Markdown body for the given type. If `shop_id` is present, the shop’s **policy template language** preference (`shops.policy_template_lang`) is used: `en` → root folder; `de`, `fr`, `es`, `pt`, `sv` → subfolder when present, else fallback to English.
- **Policy template language:** Each shop has `policy_template_lang` (`en` | `de` | `fr` | `es` | `pt` | `sv`). Users choose the language of the policy **text** in Settings (Portal → Settings → Policy templates). They can use English even when the UI locale is e.g. German.
- `PATCH /api/portal/shop-settings` — Body: `{ shop_id, policy_template_lang }`. Updates the shop’s policy template language (portal user must have access to the shop).
- `POST /api/policies/upload` — FormData: `file`, `shop_id`, `policy_type`. Accepted types: `refunds`, `shipping`, `terms`, `privacy`, `contact`. Allowed document formats: PDF, DOCX, DOC, TXT, Markdown (`.md`), max 10 MB. Validation accepts either allowed MIME types or allowed file extensions (browser-safe fallback for text uploads). Files go to Supabase Storage bucket `policy-uploads` at `{shop_id}/{policy_type}/{timestamp}.{ext}`. Creates signed URL (1 year) and inserts into `policy_snapshots`.
- `GET /api/policies/content?shop_id=...&policy_type=...` — Returns `{ content: string | null }` for the latest snapshot’s `extracted_text` (for editing). Requires portal user with access to the shop.
- `DELETE /api/policies` — Body: `{ shop_id }`. Removes all policy snapshots for the shop. Requires portal user with access to the shop. Used to clear policies for re-review.
- `POST /api/policies/apply` — JSON: `{ shop_id, policy_type, content }`. Saves template text as a file, stores it in `policy_snapshots.extracted_text` for the Edit flow, and creates a snapshot row (used when the merchant edits a template in the modal and clicks “Save & Apply”).

**Evidence pack mapping:** The policy source collector (`lib/packs/sources/policySource.ts`) maps `terms` → `cancellation_policy`, `refunds` → `refund_policy`, `shipping` → `shipping_policy` for Shopify evidence fields. Privacy and contact snapshots are stored and shown on the Policies page but are not yet mapped to Shopify dispute evidence fields.

## PDF Rendering & Storage

### Template (`lib/packs/pdf/`)

- `styles.ts` — `@react-pdf/renderer` stylesheet with project-branded tokens.
- `EvidencePackDocument.tsx` — Two-page React-PDF document:
  - **Cover**: Shop name, dispute ref, date, completeness score (color-coded), blockers.
  - **Content**: Checklist, blockers/recommended actions, order details, shipping/tracking, policies, manual attachments, audit trail.

### Render Pipeline

1. `POST /api/packs/:packId/render-pdf` enqueues `render_pdf` job (returns 202).
2. Job handler (`lib/jobs/handlers/renderPdfJob.ts`) loads pack + related data, calls `renderPackPdf()`.
3. `renderPackPdf()` (`lib/packs/renderPdf.tsx`) renders via dynamic imports.
4. PDF buffer uploaded to Supabase Storage bucket `evidence-packs` at `{shopId}/{packId}/{timestamp}.pdf` (merchant manual uploads use the same bucket; see **Manual Upload** above).
5. `evidence_packs.pdf_path` updated; `pdf_rendered` audit event logged.

### Download

- `GET /api/packs/:packId/download` returns 1-hour signed URL from Supabase Storage.

### Dynamic Import Pattern (aligned with Estimate Pro)

`@react-pdf/renderer` has native dependencies (`yoga-layout`) that hang webpack if statically imported. The solution (matching the proven Estimate Pro pattern) uses a dedicated runtime module:

- **`lib/packs/pdf/reactPdfRuntime.ts`** — exports `getReactPdfRenderer()` and `getEvidencePackDocumentModule()` as async dynamic imports.
- **`lib/packs/renderPdf.tsx`** — calls the runtime module, uses `React.createElement()` + `renderToBuffer()`.
- **`export const runtime = "nodejs"`** — set on render-pdf, download, and worker API routes.
- **No `serverExternalPackages`** needed — dynamic imports keep the package out of webpack's static analysis graph entirely.

## API Surface

### Public
- `GET /api/health`
- `POST /api/webhooks/app-uninstalled` (HMAC verified)
- `POST /api/webhooks/shop-update` (HMAC verified)
- `POST /api/webhooks/disputes-create` (HMAC verified) — enqueues sync_disputes for the shop
- `POST /api/webhooks/disputes-update` (HMAC verified) — enqueues sync_disputes for the shop

### Portal Auth
- `GET /api/auth/confirm?token_hash=…&type=…&redirect=/path` — **primary:** `verifyOtp` for confirmation links from our Send Email hook (works when the link is opened outside the original browser; no PKCE verifier). `type` is a Supabase email OTP type (`signup`, `magiclink`, `recovery`, etc.). On `type=signup` sends welcome email (locale-aware) + admin notification, then redirects to `redirect` (default `/portal/dashboard`). Optional `locale` for those emails.
- `GET /api/auth/confirm?code=…&type=signup|magiclink&redirect=/path` — **legacy:** PKCE `exchangeCodeForSession` when the URL still carries a `code` from Supabase-hosted verify redirects. Same welcome behavior when `type=signup`. Open redirect guard: only relative paths accepted.
- **Supabase dashboard checklist (production):** **Site URL** — `https://disputedesk.app`. **Redirect URLs** — include `https://disputedesk.app/**` and `http://localhost:3000/**` for local dev. **Authentication → Hooks → Send Email** — `https://disputedesk.app/api/auth/email-hook` (or your deployed origin). **Vercel env:** `SUPABASE_AUTH_HOOK_SECRET` (matches hook signing secret), `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL` (`https://disputedesk.app` so email links are not localhost).
- **`/auth/*` UI (sign-in, sign-up, forgot password, magic-link sent, reset password):** [`app/(auth)/layout.tsx`](app/(auth)/layout.tsx) wraps routes with `NextIntlClientProvider`. Locale is resolved from the **`dd_locale`** cookie (set when the user picks a language on the marketing site) and `Accept-Language`, same helper chain as the portal (`resolveLocale` + `getMessages`). Copy lives under `messages/*.{json}` in the **`auth`** object (e.g. `auth.signIn.title`). `next.config.js` redirects `/sign-in` → `/auth/sign-in` for stray links.
- **Troubleshooting — Supabase email rate limits:** Heavy repeated sign-up or magic-link testing can surface errors such as `email rate limit exceeded`. Wait for the window to reset, spread tests across addresses, or review **Supabase Dashboard → Authentication → Rate limits**.
- **Troubleshooting — Auth UI i18n gaps:** Password-strength hints from the shared password field may remain English on localized `/auth/*` pages. Supabase client error strings (`err.message`) are often English unless mapped to `messages` in the UI.
- `POST /api/auth/magic-link` — accepts `{ email, locale?, redirectTo? }`. Calls `admin.generateLink({ type: 'magiclink' })` server-side so the redirect URL is always built from `NEXT_PUBLIC_APP_URL` (never the client's origin), then sends a branded locale-aware magic link email via Resend. Returns `{ ok: true }` regardless of whether the account exists (prevents email enumeration). Used by the sign-in page instead of `supabase.auth.signInWithOtp`.
- `POST /api/auth/portal/sign-out` — sign out portal user
- **`GET /auth/open-in-shopify`** — requires Supabase session + active-shop cookie linked to the user; redirects to `https://{shop_domain}/admin/apps/{SHOPIFY_API_KEY}` (embedded app in Shopify Admin). Used as the post-OAuth destination for **Continue with Shopify** on sign-in/sign-up (`return_to` in `GET /api/auth/shopify`). Must be listed in Supabase Auth redirect allowlist (`{APP_URL}/auth/open-in-shopify`).
- `GET /api/portal/clear-shop` — no Shopify session required (exempt in middleware). Clears active-shop cookies and redirects to `/portal/connect-shopify` so the user can reconnect. Used by the portal sidebar link "Clear shop & reconnect".
- `GET /api/portal/switch-demo` — clears active-shop cookies and redirects to `/portal/dashboard` (demo mode). Used when the user chooses the demo store from `/portal/select-store?shop_id=demo` or the sidebar **Switch to demo store** link while a real shop is active. See `GET /api/portal/switch-shop?shop_id=…` for switching to a linked shop.

**Portal shell sidebar** (`app/(portal)/portal-shell.tsx`): Secondary links use `hasRealShopActive` (active shop id matches a linked shop). **Connect your real store** (`nav.connectStore`) is shown only when the user has linked shops but demo is active. **Switch to demo store** (`nav.switchToDemo`) is shown only when a real linked shop is active. i18n: `messages/*.json` under `nav.*`.

### API middleware — shop identity and portal fallback

Most `/api/*` routes require a shop context. Middleware (`middleware.ts`) resolves it in two ways:

1. **Embedded app:** `shopify_shop` and `shopify_shop_id` cookies (set after OAuth when the app is opened from Shopify Admin). These cookies use `sameSite: "none"` so the browser sends them in the cross-origin iframe. If missing, the request gets `401` with message "Unauthorized. Install or re-open the app from Shopify Admin." and `code: SESSION_REQUIRED`.

2. **Portal fallback:** For certain API prefixes, if Shopify cookies are absent, middleware accepts **Supabase Auth** plus the active-shop cookie (`dd_active_shop` or `active_shop_id`). It verifies the user has that shop in `portal_user_shops`, then sets `x-shop-id` / `x-shop-domain` (domain as `"portal"`) and allows the request. This allows the portal disputes page (and setup, integrations, sample files) to work without embedded-app cookies.

**Portal API prefixes** (Supabase + active_shop allowed): `/api/setup/`, `/api/integrations/`, `/api/files/samples`, `/api/disputes`, `/api/policies` (list, upload). All other shop-scoped APIs require Shopify session cookies.

**Portal client and active shop:** The active-shop cookie is httpOnly, so client components cannot read it. The server layout reads the cookie and passes `activeShopId` into `PortalShell`, which provides it via `ActiveShopProvider` / `useActiveShopId()` (`lib/portal/activeShopContext.tsx`). Portal pages such as the disputes list use `useActiveShopId()` to get the current shop and pass it as `shop_id` in API calls (e.g. `GET /api/disputes?shop_id=...`, `POST /api/disputes/sync` with body `{ shop_id }`). Sync Now shows an in-progress state (Loader icon, "Syncing...", `aria-busy`) and surfaces sync errors or a success message (e.g. "No disputes in Shopify" or "Synced N dispute(s)").

**Embedded client and shopId:** `shopify_shop` / `shopify_shop_id` are HTTP-only cookies, so client components should not read them via `document.cookie`. Middleware resolves the shop and forwards it as `x-shop-id` / `x-shop-domain` headers; embedded UI should rely on those server-derived values (e.g. packs list + template install).

**Stale cookie protection (reinstall):** When a merchant uninstalls and reinstalls, the `app/uninstalled` webhook cannot clear browser cookies (it's server-to-server). The `shopify_shop` cookie (30-day `maxAge`) may survive, tricking middleware into skipping OAuth. To prevent this, middleware calls `GET /api/auth/shopify/session-exists?shop=…` on the `/app` entry path (not sub-paths) to verify an offline session exists in the DB. If no session is found, it clears the stale cookies and redirects to OAuth. The endpoint is protected by `CRON_SECRET` via the `x-dd-internal-secret` header. On check failure, the request passes through gracefully (the readiness API will surface the issue).

**Cross-shop ownership filter:** Every per-shop route family — `/api/disputes/:id/*`, `/api/packs/:packId/*`, `/api/rules/:id`, `/api/jobs/:id` — filters its entity load by both `id` and the `x-shop-id` header set by middleware (resolved via `lib/middleware/extractShopId.ts`). Cross-shop UUIDs return `404`. Requests missing shop context (or scoped to the portal `demo` placeholder) return `401` with `code: SHOP_CONTEXT_REQUIRED`. Admin override routes under `/api/admin/disputes/:id/*` are intentionally cross-shop and gated by the admin session check below.

**`/api/admin/*` admin gate:** Middleware verifies a Supabase session whose `auth.users.id` has an active row in `internal_admin_grants` before any `/api/admin/*` handler runs. Unauthenticated callers get `401` with `code: ADMIN_SESSION_REQUIRED`; authenticated callers without a grant get `403` with `code: ADMIN_GRANT_REQUIRED`. `POST /api/admin/logout` is allow-listed (the route is idempotent and must work for an expired session). The middleware also calls `dd_admin_touch_last_login` on success. Per-handler `hasAdminSession()` checks remain in routes that already had them — defense-in-depth, and they're how the unit tests assert 401 without booting middleware.

### Portal demo mode & test stores
- **Demo mode** (`isDemo`): true when no real shop is selected (no `active_shop_id` cookie or cookie not in user's linked shops). Portal shows a demo store label and some actions are disabled.
- **Demo data** (`useDemoData`): when true, dispute list, dashboard, rules, and billing show hardcoded demo/placeholder data instead of calling the API. True when `isDemo` is true **or** the active shop's domain is in `TEST_STORE_DOMAINS` (see `lib/demo-mode.tsx`).
- **Test store domains**: Only `demo.myshopify.com` is in `TEST_STORE_DOMAINS`. All other stores (including development stores such as `dispute-ops-test.myshopify.com`) are treated as real stores: they receive live API data and "Sync Now" works.

### Embedded app (Shopify Admin iframe) troubleshooting
- **App URL:** In Partner Dashboard, App URL must be exactly `https://disputedesk.app` (no trailing slash; same protocol and domain as deployment). Mismatch can cause "postMessage target origin does not match" and broken iframe.
- **Host param:** When the app is opened from Admin, the iframe URL must include `shop` and `host` query params. Middleware redirects `/?shop=…` to `/app?shop=…&host=…` preserving params. The embedded layout forwards `host` via `x-shopify-host` and a `shopify-host` meta tag for App Bridge. If the iframe URL lacks `host`, App Bridge may use the wrong origin for `postMessage` (disputedesk.app instead of admin.shopify.com).
- **App Bridge script placement:** App Bridge CDN script (`app-bridge.js`) must be a synchronous blocking `<script>` — no `async`, `defer`, or `type=module`. React hoists `<script src>` from nested Server Components and adds `async`/`defer` automatically. The script is therefore placed in the explicit `<head>` of the root layout (`app/layout.tsx`) where React does not modify it. It must not be loaded via `next/script` or any deferred strategy. **Do not load App Bridge on marketing pages:** `middleware.ts` sets `x-dd-load-app-bridge` to `1` only for `/app/*`; the root layout renders the script only when that header is set. Loading it on public routes triggers “App Bridge Next: missing required configuration fields: shop” and can cause a client-side React error (#185).
- **OAuth in iframe:** `GET /api/auth/shopify` always returns a 302 redirect to Shopify’s OAuth URL. No HTML breakout page is used. Session cookies (`shopify_shop`, `shopify_shop_id`) are set by the callback with `sameSite: "none"` and `secure: true` so the browser sends them in the cross-origin iframe on subsequent requests; without this, the middleware would not see the session and would redirect to auth again (redirect loop).
- **Figma full-frame vs embedded canvas:** Design mocks (e.g. Figma Make [DisputeDesk Shopify App Design](https://www.figma.com/make/5o2yOdPqVmvwjaK8eTeUUx/DisputeDesk-Shopify-App-Design)) often show the **entire** Shopify Admin UI — global dark top bar, merchant nav (Home, Orders, …), Apps rail — **then** the app iframe. **Shopify owns that outer chrome**; we cannot recreate or restyle it from app code.
- **In-iframe app chrome (DisputeDesk):** Above each embedded route's content, we render **`EmbeddedAppChrome`** (`components/embedded/EmbeddedAppChrome.tsx`), wired in **`app/(embedded)/app/layout.tsx`**. It owns two visual regions: (1) a **feedback bar** (`padding: 12px 4px 0`, `bg-[#F1F2F4]`, white bordered rounded-lg card, `#5E4DB2` thumbs-up SVG, prompt text with muted subtext, 5 interactive SVG stars that fill `#FFC107` on hover/click, X dismiss button); (2) a **page content area** (`padding: 8px 4px 20px`, `bg-[#F1F2F4]`). **`embedded-app-chrome.module.css`** overrides Polaris layout tokens ~20% wider than defaults (e.g. `--pg-layout-width-primary-max` from `41.375rem` to `49.65rem`), forces Polaris `Page` to full width with no side padding or auto-centering, and sets Polaris `Layout` to `justify-content: flex-start`. This eliminates excess dead space next to the Shopify sidebar. Dismissed state persists in **`localStorage`** key `dd_embedded_feedback_banner_dismissed_v1`. Copy lives under i18n namespace **`embeddedShell`**. App branding (purple shield icon + "DisputeDesk" title) is handled by the **Shopify Admin title bar** via `<s-page heading="DisputeDesk" />` in the shared embedded layout — not by an in-iframe brand row.
- **Unified content width:** All embedded routes inherit the same widened Polaris layout from `.pageContent` in `EmbeddedAppChrome`. Every route — including the disputes list — now uses Polaris `Page` / `Layout` / `Card`, so widths are consistent automatically. The disputes list table is rendered inside a `Card padding="0"` with Figma-matched CSS for headers, cells, and badges (`disputes-list.module.css`). The packs list (`.embeddedPacksRoot` in `packs.css`) uses `width: 100%` with no max-width cap. Only `connect` (`narrowWidth`) and `setup/complete` (`maxWidth: 560`) are intentionally narrower.
- **App Bridge TitleBar / `s-page`:** The shared embedded layout (`app/(embedded)/app/layout.tsx`) renders `<s-page heading="DisputeDesk" />` so the Shopify Admin title bar always displays the app name and icon. Individual page routes use Polaris `Page` for in-content titles and actions; they do not override the Admin title bar heading.

### Shopify OAuth
- `GET /api/auth/shopify?shop=xxx.myshopify.com` — start OAuth (accepts `source=portal` + `return_to`).
  Always responds with 302 redirect to Shopify’s authorize URL. State is encoded
  as a signed token (not a cookie) via `encodeOAuthState()`. The `shop` param is
  required and must end in `.myshopify.com`. The sign-in and sign-up pages prompt
  users for their store domain before redirecting here (inline input field that
  accepts `mystore` or `mystore.myshopify.com` and normalizes to the full domain).
- `GET /api/auth/shopify/callback` — verify HMAC + signed state token, exchange
  code for access token, store session. Sets `shopify_shop` and `shopify_shop_id`
  cookies with `sameSite: "none"` so they are sent when the app is loaded in
  Shopify Admin’s iframe. For `source=portal`: links the portal user to the shop,
  sets `active_shop_id` cookie. Unauthenticated users are instantly signed in via
  `admin.generateLink` → `action_link` redirect (no email sent); authenticated
  users skip straight to the destination.

### Dashboard Stats (Embedded)
- `GET /api/dashboard/stats?shop_id=...&period=24h|7d|30d|all` — returns the full shared metrics layer: `activeDisputes`, `winRate`, `amountRecovered`, `amountLost`, `disputesWon`, `disputesLost`, `totalClosed`, `avgTimeToSubmit`, `avgTimeToClose`, `statusBreakdown` (by `normalized_status`), `outcomeBreakdown` (by `final_outcome`), `submissionBreakdown` (by `submission_state`, open disputes only), `actionNeededDisputeId` (the single open dispute ID when exactly one is in `new | action_needed | needs_review`; otherwise `null` — used by the Operational Summary CTA to deep-link to the detail page), plus period-over-period change fields (`activeDisputesChange`, `winRateChange`, `amountAtRiskChange`, `amountRecoveredChange`, `disputesWonChange` — null when period is "all"). Also returns `recentActivity` (last 10 merchant-visible `dispute_events` enriched with `orderName`), `winRateTrend` (6 buckets), `disputeCategories` (by reason), `deadlinesSoonCount` (open disputes with `due_at` within 3 days), and legacy fields (`totalDisputes`, `revenueRecovered`, `avgResponseTime`). Pack count from `evidence_packs`. Previous period is an equal-length window immediately before the current period.

**Embedded dashboard redesign (2026-04-25):** The embedded dashboard at `app/(embedded)/app/page.tsx` was rebuilt to match the Figma Make `shopify-home.tsx` reference, pulled via the Figma official MCP server (see `docs/figma-mcp.md`). The layout now follows Figma's section order: **(1) Attention banner** (`DashboardAttentionBanner`) — red banner shown when `actionNeeded > 0`, with a "Review now" CTA that deep-links to the single open dispute or the filtered list; **(2) Operational summary** (`DashboardOperationalSummary`) — 4 bordered cards in a responsive grid (Action Needed / Ready to Submit / Waiting on Issuer / Closed) with icon chips, big-number counts, and CTA arrows on the actionable cards (red border `#FCA5A5` for action-needed, amber `#FDE68A` for ready-to-submit); **(3) Performance Overview** (`DashboardKpis`) — period selector (24h/7d/30d/All) over 4 KPI tiles (Active Disputes, Win Rate, Amount Recovered, Amount at Risk; "Amount Lost" was removed from the desktop grid to match the 4-card Figma); **(4) Recent Disputes** (`DashboardRecentDisputesPreview`) — unchanged Polaris table; **(5) Two-column row**: `RecentActivityFeed` (last 10 events) + `DashboardInsights` (combined card containing the win-rate trend bar chart and Top Dispute Categories progress bars — replaces the previous standalone `DashboardCharts` two-card layout); **(6) Outcome Breakdown** (`OutcomeBreakdown`, kept) and `DashboardHelpCard` at the bottom. The "Quick actions" section (3 link cards to disputes/coverage/rules) and its `DashboardQuickActions` component + `quickAction*` i18n keys were removed 2026-05-14 — the sidebar already covers those destinations. New i18n keys (`dashboard.attentionBannerMessage`, `attentionBannerCta`, `actionNeededDesc`, `readyToSubmitDesc`, `waitingOnIssuerDesc`, `closedInPeriodDesc`, `reviewCases`, `submitNow`, `insightsTitle`, `insightsSubtitle`) are present in all 12 locale files; non-English locales were patched by `scripts/patch-dashboard-redesign-translations.mjs`. The data layer (`/api/dashboard/stats` → `DashboardStats`) was not changed.

**Summary row (embedded dashboard, legacy reference):** 4 compact Polaris tiles in an `InlineGrid`: Action Needed (`new` + `action_needed` + `needs_review`), In Progress (`in_progress` + `ready_to_submit` + `submitted` + `submitted_to_shopify` + `waiting_on_issuer` + `submitted_to_bank`), Amount at Risk, Deadlines Soon. Neutral tone when count is 0; critical badge for Action Needed > 0; warning badge for Deadlines Soon > 0. Tiles link to filtered dispute lists.

**Conditional primary section (embedded dashboard):** When `actionNeededCount > 0`, the "Needs your attention" Polaris `IndexTable` renders first (Order, Reason, Issue, Deadline, Amount, Review CTA), followed by the "In Progress" table below. When `actionNeededCount === 0`, the needs-attention table is not rendered at all — a small inline `Banner` says "Nothing needs attention right now" and "In Progress" becomes the primary section. When both counts are 0, a single compact card shows "No active disputes."

**KPI cards (embedded dashboard):** 4 metrics inside a single Polaris `Card` with `InlineGrid` — Active Disputes, Win Rate, Amount Recovered, Amount at Risk. Period selector (24h / 7d / 30d / All) sits in the card header. Period-over-period comparison where available.

**Status Distribution (embedded dashboard):** Stacked horizontal bar + legend showing all `normalized_status` values with color-coded segments.

**Outcome Breakdown (embedded dashboard):** Per-outcome progress bars with counts and percentages from `final_outcome`. Won = green, Lost = red, others = amber/gray.

**Recent Activity feed (embedded dashboard):** Last 10 `dispute_events` (merchant-visible). Each row shows event type label, order name, description, and relative time. Rows link to the dispute detail page.

**Recent Disputes table (embedded dashboard):** Fetches `/api/disputes?per_page=8` + `/api/billing/usage` in parallel. Columns: Order (links to Shopify Admin order), Amount, Reason, Normalized Status (badge — status taxonomy already conveys the submission journey: new → submitted_to_shopify → submitted_to_bank → won/lost), Date (initiated_at, long format), Deadline (short month + day), Final Outcome (badge when closed), View Details. Order URL built from `order_gid` + `shop_domain`. The earlier separate "Submission" column was removed (2026-04-19) because Status already covers submission progress and the two columns frequently drifted out of sync when `normalized_status` advanced to `submitted_to_bank` without `submission_state` being promoted to `submitted_confirmed`. Nuanced submission-state detail (saved as draft vs. submitted but unconfirmed vs. manually reported) now lives only on the dispute detail page.

**Disputes list page (embedded, Figma alignment 2026-04-28):** `app/(embedded)/app/disputes/page.tsx` matches the Figma Make `pages/shopify/shopify-cases.tsx` redesign. Top-down composition: (1) **KPI row** — 4 inline `<div>` cards with counts from `figmaKpis(disputes)` (Needs action with urgent subtitle / Amount at risk / Strong cases "Ready to submit" / Awaiting response "Submitted to bank"). (2) **Red urgency banner** (`bg #FEF2F2 border #FCA5A5`, `AlertCircleIcon`, "{N} urgent disputes require attention" + "{amount} at risk — earliest due in {N} day(s)") with two CTAs: "Resolve now" deep-links the first urgent dispute (sorted by `due_at asc`); "View all" pre-filters to action-needed + sorts by urgency. Renders only when `kpis.urgentCount > 0`. (3) Alert-email banner preserved. (4) **Filters card** — Polaris `Select` (status dropdown: All status / Action needed / Needs review / Under review / Submitted / Closed) + search + Filter popover + Export. (5) **Disputes grid** (`<DesktopDisputesTable>`) — 12-col CSS-grid card-list (NOT a `<table>`) with 6 cols: Order & Customer (stacked) / Case strength (pill + subtitle from persisted counts) / Next action (blue link) / Amount / Due date (red overdue, amber today, subdued otherwise) / Outcome + chevron. Conditional row chrome: `dueDateStatus ∈ {past, today}` → red 4-px left stripe + pink bg; `status === 'action-needed'` → amber stripe + cream bg; `status === 'closed'` → opacity 0.6. Whole row is a clickable `<Link>` to the detail page. (6) **Mobile cards** (`<MobileDisputeCard>`) — section-divided card with the same color stripes; bottom section is a full-width primary button labelled with `nextAction` (blue when actionable, subdued otherwise).

**Data layer:** `/api/disputes` does a follow-up `evidence_packs` query (filtered to `status NOT IN (failed,queued,building)`, ordered desc by `created_at`, deduped to one row per dispute) and merges the persisted `pack_json.case_strength = { overall, strongCount, moderateCount, supportingCount }` onto each dispute as `caseStrength`. Bounded by `per_page` (≤ 100). Pre-decision rows surface as `caseStrength: null`; the UI renders an em-dash. `disputeListHelpers.ts` exposes pure derivation helpers: `figmaStatus` (collapses 13 normalized-status values to 5: `new | in_progress | ready_to_submit | action_needed` → action-needed; `needs_review` → needs-review; `submitted | submitted_to_shopify | submitted_to_bank | waiting_on_issuer` → under-review; `won | lost | accepted_not_contested | closed_other` OR `closed_at != null` → closed), `figmaCaseStrength`, `figmaStrengthDetail` (composes "{N} strong signals" / "{S} strong + {M} moderate" / "Insufficient evidence" from persisted counts), `figmaOutcome`, `figmaDueDate`, `figmaNextAction` (lookup table over `(status, caseStrength)`), `figmaIsUrgent`, `figmaRowChrome`, `figmaKpis`.

**Removed in this redesign:** the legacy summary card (state sentence + Inquiries/Chargebacks/Needs review/Needs sync count badges) — KPI row replaces it. The `active / closed / all` tab buttons are gone; the status dropdown owns the closed-vs-active filter dimension. The Polaris `<Card padding="0">` wrapper around the desktop table is gone — the new table carries its own rounded chrome. CSS module trimmed to `loadingWrap` + `mobileActionsButton` only.

**Preserved verbatim:** filters / search / sort / sync / pagination / CSV export / alert-email banner / no-store / loading / empty states. All existing `disputes.*` keys retained; ~30 new sibling keys (`kpiNeedsAction`, `urgentBannerTitle`, `colCaseStrength`, `nextActionSubmitEvidence`, `statusDropdown.*`, etc.) added across all 12 locale files. No DB migration. No schema change. Detail page and its tabs untouched.

**Dispute detail page (embedded):** `app/(embedded)/app/disputes/[id]/page.tsx` is a 9-line wrapper that mounts `WorkspaceShell.tsx` (Overview / Evidence / Review & Submit tabs). The full architecture lives in the *Dispute Workspace* section above (`WorkspaceShell` → `useDisputeWorkspace` composite-data hook → tab components in `[id]/tabs/`). The shared utilities at `[id]/components/utils.ts` (Types `Dispute`, `Pack`, `MatchedRule`, `DisputeProfile` + `formatCurrency` / `formatDate` / `statusTone` / `statusLabel` / `packStatusTone` / `daysUntilInfo`) remain in use by the tab views.
- **Page chrome:** Title is phase-aware: **`Inquiry {id}`** / **`Chargeback {id}`** / **`Case {id}`** (unknown phase), with a blue **⚡ Automated** pill badge when the resolved automation mode is `auto`. Subtitle shows **`Order date: {date}`**. Page-level `primaryAction` mirrors the hero CTA for quick access when scrolled. Secondary actions: Re-sync, Open in Shopify.
- **Navigation / i18n:** `fetchData` depends on `[id, searchParams]` so changing `?locale=` refetches the profile with the correct `Accept-Language`. All links use `withShopParams` to preserve `?shop`, `?host`, and `?locale`.
- **Open dispute in Shopify:** links to `https://admin.shopify.com/store/{handle}/finances/disputes/{id}` (note: `/finances/disputes/`, not the deprecated `/payments/disputes/`).
- **Help:** Merchants can read **Dispute detail page** / **Dispute detail in this app** in embedded Help (`dispute-detail-page` article; i18n: `help.articles.disputeDetailPage` and `help.embedded.articles.disputeDetailPage`).

**Dispute detail page (portal):** `app/(portal)/portal/disputes/[id]/page.tsx`. Same data sources. Renders the same real Shopify order timeline section between the Details/Automation grid and the Evidence Packs table. Timeline is built inline from `profile?.orderEvents` (Shopify) merged with pack events (DisputeDesk), sorted newest-first. Demo mode still uses hardcoded demo timeline data.

### Shop Preferences (Embedded Settings)
- `GET /api/shop/preferences?shop_id=...` — returns notification preferences from `shop_setup.steps.team.payload.notifications` (newDispute, beforeDue, evidenceReady). Used by embedded Settings page.
- `PATCH /api/shop/preferences` — body `{ shop_id, notifications: { newDispute?, beforeDue?, evidenceReady? } }`. Merges into team step payload and upserts `shop_setup`. Used to persist notification toggles.
- `POST /api/setup/invite` — body `{ email }`. Sends a teammate invite email via Resend pointing to the portal sign-up page. Used by the "Send invite" button in the Setup Wizard Team & Notifications step.

### Due-date reminder cron
- `GET /api/cron/dispute-reminders` ([app/api/cron/dispute-reminders/route.ts](app/api/cron/dispute-reminders/route.ts)) — daily Vercel Cron (09:00 UTC). For each dispute due within 48h that hasn't been reminded yet, sends a "due in Nh" email via [lib/email/sendDueReminder.ts](lib/email/sendDueReminder.ts) when the shop has `team.payload.notifications.beforeDue !== false`. Marks `disputes.reminder_sent_at` after successful send.
- **Filter rules (must all hold for a row to be eligible):**
  - `due_at` between `now()` and `now() + 48h`
  - `reminder_sent_at IS NULL`
  - `submitted_at IS NULL` and `evidence_saved_to_shopify_at IS NULL`
  - `status IN ('needs_response', 'open')`
  - `normalized_status IS NULL` or `normalized_status IN ('new','in_progress','needs_review','ready_to_submit','action_needed')`
- **Why both `status` and `normalized_status`:** Shopify keeps the raw `status` at `needs_response` until issuer resolution, so a merchant who already saved/submitted evidence still has `status = 'needs_response'`. The merchant-facing `normalized_status` (derived in [lib/disputeEvents/normalizeStatus.ts](lib/disputeEvents/normalizeStatus.ts)) reflects merchant action — values like `submitted`, `submitted_to_shopify`, `submitted_to_bank`, `won`, `lost`, `accepted_not_contested`, `closed_other` indicate no further action is needed and the reminder must be suppressed.
- **Pack-status hint:** `packStatusHint` in `sendDueReminder.ts` recognizes all three "saved" pack states (`saved_to_shopify`, `saved_to_shopify_unverified`, `saved_to_shopify_verified`) and renders `packSaved` ("Evidence has already been saved to Shopify"); only truly missing/unknown packs render `packNotStarted`.

### Automation
- `GET /api/automation/settings?shop_id=...` — read shop automation settings (`auto_build_enabled`, `auto_save_enabled`, `auto_save_min_score`, `enforce_no_blockers`)
- `PATCH /api/automation/settings` — update any subset of the four automation fields. Called by the embedded Settings page Automation section (four controls: Auto Build toggle, Auto Save toggle, Min Score number input, Blocker Gate toggle + Save button).

**Embedded Settings page — Automation section:** `app/(embedded)/app/settings/page.tsx` now includes a full Automation card above Notifications. Fetches `/api/automation/settings` on load alongside usage and prefs. Renders four controls in bordered rows matching the Notifications style. Saving PATCHes `/api/automation/settings` and shows a 3-second success banner. The dashboard Automation Status card "Settings" link uses `withShopParams` to preserve locale when navigating here.
- `POST /api/disputes/sync` — enqueue dispute sync job
- `POST /api/packs/:packId/approve` — approve pack for save + enqueue job

### Authenticated (shop context required)

Shop context is provided by either (1) Shopify session cookies (embedded app) or (2) Supabase Auth + active_shop (portal) for the routes listed under "Portal API prefixes" above.

- `GET /api/disputes` — list disputes. Supports: `shop_id`, `status`, `phase`, `needs_review`, `due_before`, `normalized_status`, `final_outcome`, `submission_state`, `closed` (true/false), `date_field` (initiated_at|submitted_at|closed_at), `date_from`, `date_to`, `amount_min`, `amount_max`, `sort` (due_at|initiated_at|closed_at|submitted_at|amount), `sort_dir` (asc|desc), `page`, `per_page`.
- `GET /api/disputes/:id` — single dispute. Response includes `family` (from `DISPUTE_REASON_FAMILIES`) and `handling_mode` (`auto`|`review` — legacy stored values `auto_pack` / `notify` / `manual` are normalized on read via `lib/rules/normalizeMode.ts`).
- `POST /api/disputes/sync` — run sync for shop (portal: body `{ shop_id }`; runs synchronously, not job)
- `POST /api/disputes/:id/sync` — re-sync one dispute
- `POST /api/disputes/:id/packs` → 202 `{ packId, jobId }` (creates pack + enqueues build)
- `GET /api/disputes/:id/packs` → list packs for a dispute
- `GET /api/packs/:packId` → full pack: items, checklist, audit log, active jobs. If the id is not in `evidence_packs`, falls back to the library `packs` table (e.g. template-installed packs) and returns a compatible shape with empty evidence/jobs.
- `GET /api/packs?status=&q=` — list packs for the current shop (shopId resolved via middleware `x-shop-id`)
- `POST /api/packs` — create a manual pack for the current shop (client no longer needs to send `shopId`; server resolves from `x-shop-id`)
- `POST /api/packs/:packId/upload` → multipart file upload (PNG/JPEG/PDF, **≤ 4 MB** per file and **≤ 4 MB combined** per pack for manual uploads; creates `evidence_item`)
- `POST /api/packs/:packId/render-pdf` → 202 + jobId
- `POST /api/packs/:packId/save-to-shopify` (online session required)
- `GET /api/packs/:packId/download`
- `GET /api/jobs/:id`

### Pack Templates (Shopify session required)
- `GET /api/pack-templates?shopId=&status=&q=` — list templates with filters
- `POST /api/pack-templates` — create template
- `GET /api/pack-templates/:id` — template detail with documents
- `PATCH /api/pack-templates/:id` — update template
- `DELETE /api/pack-templates/:id` — delete template
- `POST /api/pack-templates/:id/duplicate` — deep-copy template + documents
- `GET /api/pack-templates/:id/documents` — list documents
- `POST /api/pack-templates/:id/documents` — add document
- `DELETE /api/pack-templates/:id/documents/:docId` — remove document

### Portal Template Library (Packs) & Policy APIs
- `GET /api/templates?locale=&category=&phase=inquiry|chargeback` — list pack templates (portal Packs page; filter `is_recommended` for suggested). Optional `phase` filter for phase-aware template recommendation via `reason_template_mappings`.
- `GET /api/templates/:id/preview?locale=` — template preview
- `POST /api/templates/:id/install` — install template for shop (creates pack from template). Body: `{ shopId, overrides?: { name? }, activate?: boolean }`. When `activate: true` (e.g. after the embedded Template Setup Wizard “Activate” step), the new library pack is created as **ACTIVE** and `evidence_packs` is **ready**; otherwise defaults to **DRAFT** / **draft**.
- `GET /api/policy-templates` — list policy template types (refund, shipping, terms-of-service)
- `GET /api/policy-templates/[type]/content` — Markdown body for a policy template
- `GET /api/policies?shop_id=` — list policy snapshots for shop
- `POST /api/policies/upload` — upload policy file (FormData: file, shop_id, policy_type); stores in `policy-uploads` bucket, inserts `policy_snapshots`

### Setup Wizard (Shopify session required)
- `GET /api/setup/state` — current wizard state for the shop
- `POST /api/setup/step` — mark a step done with payload
- `POST /api/setup/skip` — skip a step with reason
- `POST /api/setup/undo-skip` — undo a skip (reset to todo)
- `GET /api/setup/readiness?shop_id=...` — live connection/permission readiness checks for Step 1
- `progress.total` / `doneCount` count all 6 onboarding steps; `nextStepId` is the next actionable `todo` step based on prerequisites.

#### Rules vs library packs (mental model)

- **Pack templates** (`POST /api/templates/:id/install`): Creates shop **library** rows in `packs`, `pack_sections`, narratives, etc. (`installTemplate` in `lib/db/packs.ts`). **Silent inquiry pairing:** when a chargeback template is installed, the endpoint also installs the matching inquiry-phase sibling from `CHARGEBACK_TO_INQUIRY_TEMPLATE` (in `lib/setup/recommendTemplates.ts`) so pre-chargeback inquiries are automatically covered. The pairing is idempotent — if the inquiry pack already exists for the shop, it is skipped. `digital_goods` has no inquiry pair by design (falls back to `general_inquiry` via `reason_template_mappings`). **Localization:** `installTemplate` resolves the shop's `locale` from the `shops` table and names the pack using the matching `pack_template_i18n` row (falls back to `en-US`). When the Packs wizard step completes, installed template IDs are stored in `shop_setup.steps.packs.payload.installedTemplates`.
- **Automation setup — library pack list:** `listLibraryPacksForAutomationRules` (`lib/db/packs.ts`) returns template-backed library packs for the shop: `status` is **not** `ARCHIVED`, `template_id` is set, ordered by `created_at` ascending. That includes **DRAFT** and **ACTIVE** rows so every installed template (even before activation) appears on the **Automation & review** step. The Packs step may still emphasize **ACTIVE** rows in its own UI; do not assume the two lists use the same filter.
- **Setup automation** (`GET` / `POST /api/setup/automation`): `GET` returns `activePacks` (the library list above), `pack_modes` (per-pack handling keyed by `packs.id`: `auto` | `review`), `installedTemplateIds`, and merged `reason_rows` / safeguards derived from pack modes plus existing setup rules (`buildAutomationPayloadFromPackModes` in `lib/rules/packHandlingAutomation.ts`). `POST` with `{ shop_id, pack_modes }` validates modes against that pack list and installed templates, then persists via `replacePackBasedAutomationRules`. The legacy body with `reason_rows` / `safeguards` still goes through `replaceSetupAutomationRules` when `pack_modes` is omitted (see `lib/rules/setupAutomation.ts`). Setup-managed rows use the `__dd_setup__:` prefix; saving replaces setup-managed rules and removes legacy `install-preset` rows with the old fixed names.
- **Automation mode model (2026-04 simplification):** Merchant-facing modes are narrowed to **two** values: `auto` (build pack and submit) and `review` (build pack, park for merchant approval, set `needs_review`). The single source-of-truth type `AutomationMode` and compatibility helper `normalizeMode` live in `lib/rules/normalizeMode.ts`. Legacy stored values are normalized on read: `auto_pack` → `auto`; `notify`, `manual`, old `review`, and anything unrecognized → `review`. Write paths (`/api/rules`, `ruleCreateSchema` / `ruleUpdateSchema` in `lib/middleware/validate.ts`, `replacePackAutomationRules`, `/api/setup/coverage-rules`) accept **only** `auto` | `review`; legacy values are rejected by zod before persistence. A cleanup migration that rewrites existing `rules.action->>mode` rows in place is the recommended follow-up; until then `normalizeMode` keeps behavior deterministic.
- **Evaluation** (`pickAutomationAction` in `lib/rules/pickAutomationAction.ts`, used by `evaluateRules`): Tier order is **amount safeguards → per-reason rules → catch-all** `match: {}`. **Default when nothing matches: `review`** — DisputeDesk never silently drops a new dispute, so a pack is always prepared when automation can run. The **“response ready for review”** new-dispute email is sent **after** automated evidence collection when a `build_pack` job was enqueued (`claimAndSendDeferredNewDisputeReviewAlert`); if the pipeline does not enqueue a build (e.g. auto-build off, quota), the email may still be sent from first sync with the same review copy (see `syncDisputes`). Within the same tier and priority, **review** sorts before **auto** (merchant-safe tiebreaker). Both modes drive the same pipeline in `syncDisputes.ts` → `runAutomationPipeline`: a pack is built and `pack_template_id` is stored on the new `evidence_packs` row (`029_evidence_packs_pack_template.sql`). The difference is at save time: `auto` auto-submits when quality gates pass, `review` parks the pack and sets `needs_review = true`.
- **Important:** `lib/packs/buildPack.ts` still assembles evidence via **collectors** only; `evidence_packs.pack_template_id` records which catalog template the merchant chose for that automation path. Teaching `buildPack` to merge library checklist/sections from that template is a follow-up.

### Integrations (Shopify session required)
- `GET /api/integrations/status` — list integration statuses for a shop
- `POST /api/integrations/gorgias/connect` — connect Gorgias (subdomain, email, API key → encrypted)
- `POST /api/integrations/gorgias/test` — re-test Gorgias connection
- `POST /api/integrations/gorgias/disconnect` — disconnect Gorgias

### Evidence Sample Files (Shopify session required)
- `GET /api/files/samples` — list uploaded sample files
- `POST /api/files/samples` — upload a sample file to Supabase Storage
- `POST /api/files/samples/delete` — delete a sample file (storage + DB)

### Internal (CRON_SECRET required)
- `POST /api/jobs/worker`

### Internal Admin API (admin session required)

**Auth:** Enforced at the middleware level for every `/api/admin/*` path (see *API middleware* above). Unauthenticated → `401 ADMIN_SESSION_REQUIRED`. Authenticated but no `internal_admin_grants` row → `403 ADMIN_GRANT_REQUIRED`. `POST /api/admin/logout` is allow-listed. Routes that also call `hasAdminSession()` in-handler retain that check as defense-in-depth.

- `GET /api/admin/metrics` — ops triage dashboard stats: `disputeMetrics` (cross-shop via `computeDisputeMetrics` — includes `statusBreakdown`, `outcomeBreakdown`, `overriddenCount`, `syncIssueCount`, `disputesWithNotesCount`), `submissionUncertainCount`, `staleCount` (open disputes with no event in 7+ days), `shopLeaderboard` (top 10 shops by problem dispute count — attention/syncFail/overridden/stale/uncertain), `recentOpsActivity` (last 15 internal ops events: failures, overrides, resyncs, notes, outcomes — enriched with shop domain and order name), plus platform counters (shops, disputes, packs, jobs, plans, templates, reason mappings)
- `GET /api/admin/shops` — list shops with search/plan/status filters
- `GET /api/admin/shops/[id]` — shop detail + dispute/pack counts
- `PATCH /api/admin/shops/[id]` — update plan, pack_limit_override, admin_notes
- `GET /api/admin/jobs` — list jobs with status filter
- `PATCH /api/admin/jobs/[id]` — retry or cancel a job
- `GET /api/admin/audit` — audit events with shop_id/event_type/date filters, CSV export
- `GET /api/admin/billing` — MRR, plan distribution, per-shop usage
- `GET /api/admin/team` — list internal admins
- `POST /api/admin/team` — grant admin access by email
- `PATCH /api/admin/team/[id]` — toggle active/inactive
- `DELETE /api/admin/team/[id]` — revoke admin access
- `GET /api/admin/team/me` — current admin user info (for layout shell)
- `GET /api/admin/templates` — list templates with status/search filters (admin metadata: usage, locales, mappings)
- `GET /api/admin/templates/[id]` — template detail with sections, items, and mapping impact
- `PATCH /api/admin/templates/[id]` — update template status (active/draft/archived). Audited.
- `GET /api/admin/reason-mapping` — list phase-aware reason-to-template mappings, filterable by phase
- `PATCH /api/admin/reason-mapping/[id]` — update mapping (template_id, is_active, notes). Validates active-only templates. Audited.
- `GET /api/admin/template-health` — template governance issues by severity
- `GET /api/admin/resources/*` — resource management endpoints

#### Reason Template Mapping Data Model
The `reason_template_mappings` table stores phase-aware default template assignments:
- `reason_code` + `dispute_phase` is unique (one default per reason per phase)
- `dispute_phase`: `inquiry` (review-first triage) or `chargeback` (evidence-defense)
- Mapping changes are non-retroactive: they affect future default selection only
- "Deprecated" is a computed UI warning (archived template still mapped), not a DB status
- Template status uses canonical values: `active | draft | archived`
- All mutations produce audit log entries via `audit_events`

## Design System

The portal and marketing surfaces use a custom design system built on
Tailwind CSS with shared components in `components/ui/`.

### Design Tokens (CSS custom properties in `app/globals.css`)

| Token | Value | Usage |
|-------|-------|-------|
| `--dd-bg` | `#F6F8FB` | App background |
| `--dd-surface` | `#FFFFFF` | Card / panel background |
| `--dd-text` | `#0B1220` | Primary text |
| `--dd-text-muted` | `#64748B` | Secondary text |
| `--dd-border` | `#E5E7EB` | Borders and dividers |
| `--dd-primary` | `#1D4ED8` | Primary actions |
| `--dd-primary-deep` | `#4F46E5` | Focus rings, accents |
| `--dd-success` | `#22C55E` | Success indicators |
| `--dd-warning` | `#F59E0B` | Warning indicators |
| `--dd-danger` | `#EF4444` | Error / destructive |

### Shared Components (`components/ui/`)

| Component | File | Description |
|-----------|------|-------------|
| Button | `button.tsx` | CVA variants: primary, secondary, ghost, danger × sm/md/lg |
| Badge | `badge.tsx` | CVA variants: default, success, warning, danger, info, primary |
| AuthCard | `auth-card.tsx` | Centered card with title, subtitle, children, footer |
| TextField | `text-field.tsx` | Input with label, error, and helper text |
| PasswordField | `password-field.tsx` | Password input with toggle visibility + strength meter |
| OAuthButton | `oauth-button.tsx` | Shopify-branded OAuth button (green) |
| Divider | `divider.tsx` | Horizontal rule with optional label ("or") |
| InlineError | `inline-error.tsx` | Red alert banner with icon |
| InfoBanner | `info-banner.tsx` | Contextual banner: info, warning, success, danger |
| KPICard | `kpi-card.tsx` | Metric card with label, value, change indicator |
| FilterBar | `filter-bar.tsx` | Search input + pill-style status filters (reusable) |
| Modal | `modal.tsx` | Backdrop, header with title/description/close, scrollable body, footer |
| cn() | `utils.ts` | `clsx` + `tailwind-merge` utility |

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `tailwindcss` | Utility-first CSS framework |
| `class-variance-authority` | Type-safe component variants |
| `lucide-react` | Icon library (consistent with design) |
| `clsx` + `tailwind-merge` | Conditional + deduplicated class names |

### Embedded app mobile mode (triage-first)

The embedded surface (`app/(embedded)/app/**`) is Polaris-only and must be usable inside the Shopify mobile Admin app. Pages with list/table layouts branch between a desktop and a mobile render using Polaris's `useBreakpoints()` hook — never `matchMedia` or `window.innerWidth`.

```tsx
import { useBreakpoints } from "@shopify/polaris";
const { smDown } = useBreakpoints();
return smDown ? <MobileXList … /> : <DesktopXTable … />;
```

**Design stance:** mobile is not a compressed desktop. The Shopify mobile app is used for triage — a merchant opens it to see what needs action *now*. Mobile variants therefore lead with **urgency/action** and **amount**, with customer, phase, and status demoted to secondary badges. Reason family and other audit-grade columns are omitted on mobile; they live on the detail page.

Reference implementation — disputes list (`app/(embedded)/app/disputes/`):
- `DesktopDisputesTable.tsx` — unchanged 9-column Figma-matched HTML table
- `MobileDisputeCard.tsx` — full-width tappable card; row 1 is urgency badge ↔ amount; row 2 is emphasised due timing; row 3 is the identity block (dispute ID · order, then customer); row 4 is small muted phase/status/outcome badges
- `MobileDisputesList.tsx` — stack of cards inside `<Card padding="0">`, cards self-separate via `border-bottom`
- `disputeListHelpers.ts` — shared helpers + `formatDueTiming(d, tab, t, locale)` and `resolveSort(sortMode, tab)`

Dashboard (`app/(embedded)/app/`):
- `DashboardOperationalSummary.tsx` — single Polaris `Card` with headline ("Operational Summary" + optional critical `Badge` with attention count) and a contextual primary CTA (Review {n} action needed / Submit {n} ready / View all). Below, 4 coloured counter tiles (Action Needed critical, Ready to Submit warning, Waiting on Issuer subdued, Closed in period subdued). Mobile uses `dashboard.module.css` (`mobileGrid2`, `summaryCounterMobile`) for a 2-column tile grid and a full-width CTA. Each tile deep-links to the matching `normalized_status` filter on the disputes list. **Single-case shortcut:** when exactly one open dispute is in `new | action_needed | needs_review`, the primary CTA routes straight to that dispute's detail page (`/app/disputes/{id}`) instead of the filtered list — the counter tile still links to the filtered list for consistency. The single dispute ID is delivered as `actionNeededDisputeId` on `/api/dashboard/stats` (null when count ≠ 1).
- `DashboardKpis.tsx` — single Polaris `Card` with `InlineGrid`: Active Disputes, Win Rate, Amount Recovered, Amount at Risk. Period selector (`24h | 7d | 30d | All time`) in the card header drives `/api/dashboard/stats?period=…`.
- `DashboardRecentDisputesPreview.tsx` — compact preview of the most recent active disputes, fetched via `/api/disputes` (read-only, links to the detail page).
- `DashboardHelpCard.tsx` — "How to read your dashboard" CTA card; mobile stacks icon + text + link vertically with a full-width link button.
- `dashboardHelpers.ts` — lifted types (`DashboardStats`, `PeriodKey`, `ActivityItem`), `DEFAULT_STATS`, `useDateLocale`, `useFormatCurrency`, `safeStatusLabel`, `safeOutcomeLabel`.
- Inline in `page.tsx`: `OutcomeBreakdown` (outcome distribution with coloured dots + `ProgressBar`), `RecentActivityFeed` (last 10 events with per-event `STATUS_COLORS` dots, localised event labels/descriptions, tappable to the dispute), and `DashboardCharts` (two `Layout.Section variant="oneHalf"` cards: Win Rate Trend 6-bucket `ProgressBar` series + Dispute Categories `ProgressBar` per reason).

**Section order (identical on desktop and mobile):** Operational Summary → KPIs → Outcome Breakdown → Recent Disputes Preview → Recent Activity Feed → Charts (Win Rate Trend + Dispute Categories, side-by-side on desktop) → Help.

**Mobile actions bar** stacks search full-width, then pairs Filter + Sort 50/50 — Export is desktop-only. Sort (`sortMode` state in the page) maps to the existing `/api/disputes?sort=…&sort_dir=…` query params; desktop keeps the default tab-derived ordering so fetch behavior is byte-identical.

**Hard constraints** enforced at 320 / 375 / 393 px: no tables on mobile, no `overflow-x` anywhere, `document.scrollingElement.scrollWidth === clientWidth`, `:active` press state on every tappable card (not just `:hover`).

This pattern is the template for the remaining embedded pages (packs, rules, policies, coverage, settings, analytics, detail workspace tabs); each is its own small PR.

## Governance Controls & Review Queue

### Rule Engine

`lib/rules/evaluateRules.ts` — deterministic, first-match-wins evaluator:

1. Fetches enabled rules for shop, ordered by `priority ASC`.
2. Each rule has `match` (JSONB: reason[], status[], amount_range, phase[]) + `action` (JSONB: mode, require_fields).
3. All match conditions are AND-joined; empty match = match all.
4. First matching rule wins. At the same priority, **phase-specific rules beat phase-blind rules** so a `match.phase = ["inquiry"]` rule will win over a phase-blind rule for the same reason. Phase-blind rules still match both phases (back-compat).
5. No match defaults to `{ mode: "review" }`.
6. Every evaluation logged as `rule_applied` audit event.

**Phase-aware automation (`lib/automation/pipeline.ts` → `resolveAutomationTemplate`):** When the matched rule supplies `pack_template_id`, the pipeline uses it as-is. When the rule omits it (catch-all / safeguard rules), the pipeline falls back to `reason_template_mappings` keyed by `(reason_code, dispute_phase)` so inquiry-phase disputes get the lighter inquiry template (`fraud_inquiry`, `pnr_inquiry`, …) instead of falling through to the chargeback `REASON_TEMPLATES` hardcoded list.

**Embedded Automation page (`/app/rules`):** Inquiry sibling rules (`__dd_setup__:pack:{packId}:inquiry`) are filtered out before render — they're an implementation detail of the runtime, not something merchants configure. The state-sentence card uses `rules.phaseBlindNote` to explain that inquiry-phase disputes route to the lighter inquiry templates automatically and that each rule applies to both phases unless restricted.

**Coverage page (`/app/coverage`):** `lib/coverage/deriveLifecycleCoverage.ts` picks a separate matching rule per `(family, phase)` via `pickRuleForFamilyAndPhase`. Phase-specific rules win over phase-blind rules at the same priority so the inquiry and chargeback rows of a family can show different automation modes when the merchant has configured them that way. Per-family "Install playbook" buttons open `TemplateLibraryModal` in-place (pre-filtered by the row's dispute type via `FAMILY_TO_DISPUTE_TYPE` map) instead of navigating away. On successful install, coverage data reloads so the card updates immediately.

**Template catalog API (`GET /api/templates`):** Inquiry-phase templates are filtered out of merchant-facing results using `INQUIRY_TEMPLATE_ID_SET` so merchants never see or pick inquiry packs directly. The admin route (`/api/admin/templates`) is unaffected.

### Sync Integration

When `syncDisputes()` detects a new dispute:
- Calls `evaluateRules()` with dispute context. Result mode is normalized via `normalizeMode` so legacy stored values (`auto_pack` / `notify` / `manual` / old `review`) collapse to `auto` | `review` before anything downstream runs.
- `auto` → triggers `runAutomationPipeline()` which builds the pack; the actual auto-submit decision happens later in `evaluateAndMaybeAutoSave` after the build job runs (auto-submit only when **all** of: rule mode auto, case strength `strong`, no fatal-loss, not Shopify-covered, and the existing completeness/blockers gate passes).
- `review` → triggers the same `runAutomationPipeline()` so a pack is still built; the dispute row is flagged `needs_review = true`, the pack is parked awaiting merchant approval.
- `sendNewDisputeAlert(ctx)` receives `resolvedMode: "auto" | "review"` and picks the matching subject/heading/body/CTA. Callers must pass a normalized mode — legacy values must never reach this function.
- Fallback: if rule evaluation throws, `resolvedMode` defaults to `review`, so the merchant still receives a notification and the pipeline still builds a pack.

**New-dispute email send timing (deferred to pipeline outcome):** the auto variant copy ("DisputeDesk prepared and submitted the response automatically") is only truthful when the pipeline actually decided to auto-save. To prevent the merchant from receiving a false confirmation when the auto-mode pipeline ends up parking or blocking the pack (e.g. Moderate strength → PRD §9 park, Weak/Insufficient strength → block, low completeness → autoSaveGate block, fatal-loss → block, Shopify-covered → skip, build job catastrophic failure), the sync-time send is deferred for **every** `pack_enqueued` outcome — both `auto` and `review` rule modes. Each terminal pipeline branch then claims `disputes.new_dispute_alert_sent_at` via `claimAndSendDeferredNewDisputeAlert(disputeId, mode)` and emits the matching variant:
  - `evaluateAndMaybeAutoSave` → `auto_save` branch claims with `mode: "auto"` (the only path that will submit). The pack-saved confirmation from `saveToShopifyJob` (`sendPackSavedAlert`) is a separate notification and continues to fire after the actual Shopify mutation succeeds.
  - All other terminal branches (`park_for_review`, `block`, `skip_covered`, `pack.status === "failed"` short-circuit, fatal-loss block, autoSaveGate block) claim with `mode: "review"`.
  - `buildPackJob` catch block also claims `mode: "review"` — guarantees the merchant is notified even if the build job throws before `evaluateAndMaybeAutoSave` runs.
  - Sync-time send still runs for non-pipeline outcomes (auto-build disabled, quota exceeded, feature gated, existing pack, rules eval threw), but the variant is **forced to `review`** in those cases since no submission can happen.
  - The `new_dispute_alert_sent_at` claim is atomic and idempotent, so any race or double-call is safe — the merchant gets exactly one new-dispute email per dispute.

**New-dispute alert dedupe (`disputes.new_dispute_alert_sent_at`, migration `20260420100000`):** the existence-check SELECT in `syncDisputes` previously fired `sendNewDisputeAlert` whenever `existing` came back null — including the transient PostgREST case `{ data: null, error: <msg> }`, where the row exists but the SELECT silently failed. This re-fired the "New dispute" email and `rule_applied` audit event hours to days after the real dispute arrived. The fix: (1) bail with `result.errors.push(...)` when `existingErr !== null`, and (2) atomically claim the alert via `UPDATE disputes SET new_dispute_alert_sent_at = now() WHERE id = $1 AND new_dispute_alert_sent_at IS NULL RETURNING id` — the email only sends when the UPDATE returns a row, so a second pass on the same dispute is a no-op even if the existence check misses again. Regression test: `tests/unit/syncDisputesNewAlertDedupe.test.ts`.

**Shopify Admin dispute URL (`lib/shopify/shopifyAdminUrl.ts`):** the "Submit in Shopify Admin" CTA (email + embedded UI) uses the canonical `https://admin.shopify.com/store/{handle}/payments/dispute_evidences/{evidence_numeric_id}` form. Two prior bugs: (1) the helper defaulted to `https://{shop_domain}/admin/payments/…`, which Shopify 303s to the canonical URL — but only when the ID matches an evidence record; (2) `sendPackSavedAlert` called the helper with `dispute_gid` instead of `dispute_evidence_gid`, producing a dead page. Fixed helper: required `disputeEvidenceGid`, returns `string | null` (callers hide CTA when absent). All four callers updated: `sendPackSavedAlert`, `OverviewTab`, `ReviewSubmitTab`, `packs/[packId]/page`. API `/api/packs/[packId]` now includes `dispute_evidence_gid` in the response. Test: `tests/unit/shopifyAdminUrl.test.ts`.

**Email deep-links via `?ddredirect=`:** `getEmbeddedAppUrl` in `lib/email/publicSiteUrl.ts` links to the Admin app root (`https://admin.shopify.com/store/{handle}/apps/disputedesk-1?ddredirect=<encoded-path>`), not the deep sub-path. Rationale: Shopify Admin only reliably attaches `host` + `shop` on the top-level app entry — cold loads to `/apps/disputedesk-1/disputes/{id}` from an email rendered "refused to connect" because middleware redirected to `/app/session-required` before the layout's host-recovery script (`app/(embedded)/layout.tsx`) could run. The embedded root page (`app/(embedded)/app/page.tsx`) reads `ddredirect` in an effect, validates it starts with `/` (and not `//`) to prevent open-redirect abuse, preserves inherited `host`/`shop`/`embedded`/`locale`/`id_token` query params, and `router.replace`s to the target once App Bridge has host context. Spinner shown during the redirect; the dashboard does not render. Test: `tests/unit/publicSiteUrl.test.ts`.

### Review Queue

Both embedded and portal dispute pages have an "All Disputes" / "Review Queue" tab.
Review queue filters `needs_review=true`, sorted by due date (most urgent first).
Each row has an "Approve" button that clears `needs_review`, logs `rule_overridden`, and triggers automation.

**Embedded disputes list page (`app/(embedded)/app/disputes/page.tsx`):** Polaris `Page` / `Layout` / `Card`. Top of page answers three merchant questions: purpose (subtitle `disputes.purposeLine`), current state (plain-language sentence selected by priority — `stateNeedsSync` → `stateSomeUrgent` → `stateNeedsReview` → `stateAllClear` → `stateZero`, with secondary badges for inquiries/chargebacks/review/sync counts), and next action (Page-level `primaryAction` = Sync Now with a `loading` state while syncing). Urgent count includes overdue disputes and anything due within 48 hours. Toolbar card contains `TextField` search, Filter popover, and Export (Sync moved to Page primary; the prior More-actions menu has been removed). Table styling in `disputes-list.module.css` inside `Card padding="0"`. Columns: Phase, Order, Customer, Reason/Family, Amount, Status, Urgency, Actions ("View Details" `Link`). Search matches dispute GID, UUID, short ID, legacy `DP-` display form, order fields, reason, and customer. CSV: `Order,ID,Customer,Amount,Reason,Family,Phase,Status,Due date`.

### Completeness Gate

Pack preview pages show a yellow warning banner when `completeness_score < 60%`:
- Lists missing required checklist items.
- Guidance only — merchant can still proceed.

### Generate Pack — Template Check

When a merchant clicks "Generate Pack" on the dispute detail page, the UI first checks for a matching template before running the generate call:

1. `GET /api/templates?reason=<dispute.reason>&locale=<locale>` — finds templates for the dispute's reason via `REASON_TO_CATEGORY` mapping (e.g. `FRAUDULENT` → `fraud`, `PRODUCT_NOT_RECEIVED` → `not_received`).
2. A Polaris `Modal` is always shown:
   - **Template found**: primary "Use template" → POSTs to `POST /api/disputes/:id/packs` with `{ template_id }`, creates the pack tied to the dispute, then navigates directly to the new pack page. Secondary "Generate basic pack" → same API without template_id.
   - **No template**: primary "Go to template library" → navigates to `/app/packs`. Secondary "Generate basic pack" → creates a basic pack and navigates to it.
3. `POST /api/disputes/:id/packs` accepts an optional `template_id` body param and stores it as `pack_template_id` on the `evidence_packs` row.
4. `GET /api/templates` accepts `?reason=` (Shopify reason code) in addition to `?category=` (explicit short code). Explicit `category` takes precedence.

### Pack Page Locale Preservation

All embedded navigation that leads to/from pack pages now uses `withShopParams` to preserve `?shop`, `?host`, `?locale`, and `?dd_debug`:
- Pack detail page (`app/(embedded)/app/packs/[packId]/page.tsx`) — back URL
- Pack list page (`app/(embedded)/app/packs/page.tsx`) — all row click / button navigations
- Dispute detail Evidence Packs table — pack links (both ID and "View details")
- Dashboard — "Go to disputes" and "View all" links

### Packs Library — Figma-aligned UI (2026-04-08)

The embedded Evidence Packs Library (`app/(embedded)/app/packs/page.tsx`) was restyled to match Figma:
- **Pill-style filter tabs** — CSS overrides on Polaris `Tabs` render active tab as blue (`#1D4ED8`) pill, inactive as gray text with hover highlight.
- **Custom info banner** — Replaced Polaris `Banner` with a custom `#EFF6FF` blue div using lucide `Info` and `X` icons.
- **Header button icons** — "Start from template" uses `MagicIcon`, "Create Pack" uses `PlusIcon` (both `@shopify/polaris-icons`).
- **Simplified status column** — DRAFT packs show an "Activate" text link instead of a Draft badge + button.
- **Table row hover** — Rows highlight `#F9FAFB` on hover.
- **Description field** — Create Pack modal now includes a multiline Description textarea. The `packs` table has a `description text` column (migration `20260408120000`). API `POST /api/packs` accepts optional `description` in the body.

### Shopify Admin Dispute URL

`lib/shopify/shopifyAdminUrl.ts` builds the direct link to a specific dispute in Shopify Admin:

```
https://{shop}.myshopify.com/admin/settings/payments/shopify-payments/chargebacks/{disputeId}
```

Note: this page is only accessible when Shopify Payments test mode is **off** and a real bank account is connected. Development stores in test mode will see a 404.

### Rules API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rules?shop_id=` | GET | List rules (priority order) |
| `/api/rules` | POST | Create rule |
| `/api/rules/:id` | PATCH | Update rule |
| `/api/rules/:id` | DELETE | Delete rule |
| `/api/rules/reorder` | POST | Reorder by priority |
| `/api/disputes/:id/approve` | POST | Approve from review queue |

The **embedded** Rules page (`app/(embedded)/app/rules/page.tsx`) is a per-family view of the canonical pack-based automation system. It shows one row per dispute family (from `DISPUTE_FAMILIES`, currently 7), grouped by the pack(s) matching each family. Each row has a routing Select (Automated / Review first). Changes save via `POST /api/setup/automation { pack_modes }`, the same pipeline the setup wizard uses. A **Safeguards** section offers a high-value review threshold (`__dd_safeguard__:high_value` rule, persisted independently of pack-based saves). Quick-action buttons ("Auto-pack all" / "Review all") bulk-set pack modes. Custom rules from the portal appear in a read-only **Advanced custom rules** section.

## Save Evidence to Shopify

### Field Mapping Engine

`lib/shopify/fieldMapping.ts` maps internal pack sections to `DisputeEvidenceUpdateInput` fields:

- `buildEvidenceInput(sections, disabledFields?)` — builds the Shopify input. Only non-empty fields are included.
- `previewEvidenceMapping(sections)` — returns per-field preview for the UI.
- Mapping: `shippingDocumentation` ← fulfillment/tracking/shipping, `refundPolicyDisclosure` ← refund_policy_snapshot, etc.

### Save Pipeline

1. `POST /api/packs/:packId/save-to-shopify` — enqueues `save_to_shopify` job, sets status to `saving`.
2. Job handler loads pack sections + decrypted offline session token (`getShopBackgroundSession`).
3. Calls `disputeEvidenceUpdate` mutation with the dispute's `dispute_evidence_gid`.
4. On success → `saved_to_shopify` status + timestamp. On error → `save_failed` + audit log. Auth-class failures throw `ShopifyAuthInvalidError` so they are distinguishable from other errors in `jobs.last_error`.

### File evidence path

`ShopifyPaymentsDisputeEvidenceUpdateInput` has six file fields:

```ts
type NamedFileField =
  | "cancellationPolicyFile"
  | "customerCommunicationFile"
  | "refundPolicyFile"
  | "shippingDocumentationFile"
  | "uncategorizedFile"
  | "serviceDocumentationFile";
```

Phase 0 of the conditional file evidence layer (`docs/plans/conditional_file_evidence_layer.plan.md`, probed 2026-05-03 against `surasvenne.myshopify.com`, results in `docs/.shopify-evidence/phase-0-results/`) confirmed the **REST → GID → mutation** path is fully reachable on the new `read/write_shopify_payments_dispute_file_uploads` scopes (added in commit `f61176c`). The earlier "no public upload path" claim was a scope/casing artefact, not a structural block.

**Upload path:**
1. `POST /admin/api/{ver}/shopify_payments/disputes/{numericId}/dispute_file_uploads.json` with JSON body `{ dispute_file_upload: { document_type, filename, mimetype, data: base64 } }` returns HTTP 200 + `{ dispute_file_upload: { id, dispute_evidence_id } }`.
2. Wrap as `gid://shopify/ShopifyPaymentsDisputeFileUpload/{id}` and pass to `disputeEvidenceUpdate(id, { [matchingFileField]: { id: <gid> } })`.

**Constraints (empirical, Phase 0e):**
- `document_type` is **lowercase snake_case** and one of: `customer_communication_file`, `refund_policy_file`, `cancellation_policy_file`, `uncategorized_file`, `shipping_documentation_file`, `service_documentation_file`. Uppercase variants return HTTP 422.
- The mapping `document_type` ↔ named `*File` field is **1:1 and canonical** (e.g. `shipping_documentation_file` → `shippingDocumentationFile`).
- **Reason-aware UI rendering (Phase 0c, 2026-05-03):** Shopify's *Additional evidence* card on the chargeback response screen only renders the `*File` rows that are relevant to the dispute reason. For `FRAUDULENT`, only `customerCommunicationFile`, `shippingDocumentationFile`, `serviceDocumentationFile`, and `uncategorizedFile` appear; `refundPolicyFile` and `cancellationPolicyFile` are hidden even when the API accepts them. Phase 2 (`decideFileAttachments`) must therefore filter `targetField` candidates by dispute-reason family — sending a `refundPolicyFile` GID on a fraud dispute would succeed via `disputeEvidenceUpdate` but never display to the merchant or issuer.
- Accepted MIME: `image/jpg`, `image/jpeg`, `image/png`, `application/pdf` (Shopify also content-sniffs — corrupt PDFs are rejected with HTTP 422 even when `application/pdf` is declared).
- Hard size cap: **2,097,152 bytes (2 MiB)** — Shopify Admin's chargeback-response upload modal states *"smaller than 2 MB"* (Phase 0c, 2026-05-03). The REST API accepts up to 3,997,806 bytes (≈3.81 MiB) before returning HTTP 422, but anything between 2 MiB and that ceiling renders inconsistently in the merchant UI; we pin the lower number so files are guaranteed to display.
- REST list endpoint `GET /shopify_payments/disputes/:id/dispute_file_uploads.json` returns 404; read-back uses GraphQL `dispute → disputeEvidence → *File { id }`, which **does** return the GIDs we set (file fields are fully verifiable, not write-only).

**Helper:** `lib/shopify/disputeFileUpload.ts` exports `uploadDisputeFile(...)` with input validation (size, MIME, document_type, numeric dispute id), error discriminator (`validation_input` / `validation_size` / `validation_mime` / `shopify_rejection` / `missing_id_in_response`), and `x-request-id` propagation for support diagnostics. Unit tests in `lib/shopify/__tests__/disputeFileUpload.test.ts`.

**Production pipeline (gated by `FILE_EVIDENCE_ATTACHMENTS_ENABLED`).** `saveToShopifyJob` runs this sequence when the flag is on:

1. **Build candidates** — read `manualItems` (source = `manual_upload`), filter by `isFileEligible(checklistField)`. The `fileEligible` flag is a static boolean on `CanonicalSpec` (`lib/argument/canonicalEvidence.ts`); only delivery / shipping / customer communication / activity log / supporting documents / refund / shipping / cancellation policy fields opt in. Text-derived signals (AVS/CVV codes, IP location, billing match) stay false.
2. **Plan via `decideFileAttachments`** (`lib/shopify/decideFileAttachments.ts`) — pure function over `{ caseStrength, disputeReason, coverageActive, fatalLossActive, candidates }`. Returns ordered `FileAttachmentPlanEntry[]` per the rules in the conditional file evidence plan: gates short-circuit to empty plan; strong cases need no amplification; weak cases require ≥1 strong-priority candidate; max 2 native attachments; same-`targetField` conflicts resolve to overflow into `uncategorizedFile` (or fall to link). **Manual-upload heuristic**: when a candidate's payload looks like a manual upload (has `fileName`, no categorization discriminator like `proofType` / `customerConfirmsOrder` / `acceptedAtCheckout`), the planner treats it as `moderate` priority — a merchant assigning a file to a checklist row is itself a moderate claim. Discriminator-bearing payloads still defer to `categorizeEvidenceField` (e.g. `proofType: "label_created"` → `invalid` → dropped).
3. **Reason-aware visible-slot filtering** — `VISIBLE_SLOTS_BY_FAMILY` currently uses the fraud-verified shape (`customerCommunicationFile`, `shippingDocumentationFile`, `serviceDocumentationFile`, `uncategorizedFile`) for **every** dispute family. Until non-fraud disputes are observed in Shopify Admin, policy slots (`refundPolicyFile`, `cancellationPolicyFile`) are treated as hidden and policy-bearing candidates fall to `kind: "link"` with `fallbackReason: "reason_hidden_for_dispute"`. Widening any family requires a captured Admin screenshot — never speculative widening.
4. **Generate per-entry PDF** via `generateEvidenceAttachmentPdf` (`lib/packs/generateEvidenceAttachmentPdf.ts`). Layout branches on `attachmentType` (delivery / communication / service / policy / other); content selection branches on `evidenceFieldKey` and the pack's sections. Each PDF carries: title, dispute id, evidence field key, merchant label, generated timestamp, **reason for inclusion** (the `decideFileAttachments` rationale), per-type extracted facts, optional body block (policy text excerpts).
5. **REST upload** via `uploadDisputeFile`. Returns the `gid://shopify/ShopifyPaymentsDisputeFileUpload/{id}` we attach to the matching `*File` field on `disputeEvidenceUpdate`.
6. **Idempotency** — successful uploads are persisted on `pack_json.attachmentUploads` (an array of `{ evidenceItemId, evidenceFieldKey, targetField, fileGid, uploadedAt }`). On retry, entries are reused when the pack is in a lifecycle-fresh state (`status` ∈ {`ready`, `saving`, `saved_to_shopify_unverified`}) AND the `targetField` still matches the planner's choice. Otherwise the upload re-runs. Merchant-side file swaps create a new `evidence_items` row (the upload route is insert-only) — old GIDs naturally orphan and re-upload happens automatically.
7. **Compose payload** via `composeShopifyMutationPayload` with the resolved plan. The function sets the matching `*File` fields on the input. **Link suppression is OFF** for synthesised PDFs: the synthesised file in the native row and the merchant's original upload are different artefacts (not duplicates), so both reach the issuer — synthesised PDF in the named `*File` row; merchant's original as a labelled link inside `uncategorizedText`. (The earlier Q2=A "native-only when attached" rule applied to a passthrough mode that hasn't shipped; under synthesis, suppressing would hide the merchant's actual evidence.)
8. **Native-evidence pointer block** — when any plan entry has a confirmed GID, `composeShopifyMutationPayload` prepends a `Native evidence (attached directly to the chargeback response):` block to `uncategorizedText` listing each populated row (e.g. *"Tracking screenshot → Shipping documentation file"*). Orients an issuer who reads the prose first toward the native rows.
9. **Verification** — `verifyEvidenceReadback` re-fetches `disputeEvidence` after the mutation. The query now selects all six `*File { id }` slots in addition to the seven readable text fields. Diff classifies file fields by **GID equality**: `evidence[field].id === input[field].id` → confirmed; mismatch or null → missing. Backwards compat: callers that don't pass `inputValues` still classify file fields as `fields_write_only` (preserves snapshot tests).
10. **Audit + dispute history** — `emitSaveToShopifyEvents` surfaces `nativeAttachmentCount` + `nativeAttachmentFields[]` on both `audit_events.evidence_saved_to_shopify` and the merchant-facing dispute history line description ("… · 2 files attached natively"). Per-entry failures emit `file_evidence_planned` events with the Shopify `x-request-id`; pipeline-level failures emit `file_evidence_pipeline_failed` and degrade to text-only.

**Submission-preview parity (`/api/packs/:id/submission-preview`)**: when the flag is on, the preview route runs the same `decideFileAttachments` + composes the same payload (with placeholder GIDs in the `*File` slots so compose's pointer block + `*File` field assignments fire identically). The merchant's "raw view" matches what saveToShopifyJob will actually send.

**UI transparency (Phase 6, refactored 2026-05-09)**: the workspace API (`/api/disputes/:id/workspace`) exposes `pack.attachmentUploads`. `EvidenceRow` renders a green **📎 Attached to <slot>** badge on rows whose latest upload landed natively. On `ReviewSubmitTab`, native uploads now render **inline** within the relevant `ExactDataSentCard` group (Shipping documentation → "Customer activity", policy files → "Policies", etc.) with an *"Attached to <slot>"* badge — replacing the standalone `FileEvidenceRoutingCard` so merchants see the file alongside the structured fields it complements rather than in a separate card above.

**Reinstall consent (Phase 7b)**: when the flag is on but the merchant's offline session was issued before commit `f61176c` (added the new `read/write_shopify_payments_dispute_file_uploads` scopes), the workspace API reports `fileEvidence.scopesGranted = false`. `ReviewSubmitTab` shows a "Reinstall DisputeDesk to enable native file evidence" banner with the missing scopes named explicitly. Until reinstall, evidence continues to flow as labelled links only.

**Flag default = off**: when `FILE_EVIDENCE_ATTACHMENTS_ENABLED !== "true"`, every code path above reduces to byte-identical pre-flag behaviour. Snapshot tests pin this. Production submissions remain text + DisputeDesk-hosted links inside `uncategorizedText`.

**Shopify Payments chargeback UI misread (flag-off only):** while the flag is off, Shopify Admin renders **Shipping documentation · Upload file** (and similar native file wells) empty after a DisputeDesk save — `*File` fields are not set; manual uploads arrive as labelled secure links inside `uncategorizedText`. The separate **Shipping details** block (address, **Add tracking**) is driven by Shopify order/fulfillment data; a shipping doc PDF in DisputeDesk does not create a fulfillment tracking line there even after the flag flips on — that data lives on the order, not on the dispute.

### Manual attachments via DisputeDesk-hosted links

Because Shopify cannot accept files from third-party apps (see section above), manual uploads and the rendered pack PDF are reachable by the issuing bank through **DisputeDesk-hosted** URLs rather than raw Supabase storage links. The bank-facing origin is always our canonical domain; the Supabase storage host never appears in any response, redirect, or header.

**URL shape:** `https://disputedesk.app/e/<code>` where `<code>` is a 10-character Crockford Base32 string (alphabet `0-9 A-H J K M N P-T V-Z`, no I/L/O/U). 50 bits of entropy, ~36 chars total URL — small enough to render cleanly inside the bank-facing `Supporting documents` block. The code is generated by `generateShortCode` in `lib/links/shortLinks.ts` and persisted to **`evidence_short_links`** (`supabase/migrations/20260425130000_evidence_short_links.sql`) with `(kind, entity_id, pack_id, shop_id, dispute_id, expires_at, revoked_at, last_accessed_at)`. `ATTACHMENT_LINK_TTL_DAYS = 180`. Resolution at request time is a single indexed lookup on `short_code`; `last_accessed_at` is updated fire-and-forget for audit. Per-link revocation is supported by the schema (`revoked_at`) but no UI currently surfaces it.

**Legacy HMAC tokens:** before 2026-04-25 the route minted stateless tokens of shape `<base64url(payload)>.<base64url(hmac-sha256)>` (~220 chars). The route handler still verifies those via `verifyAttachmentToken` (`lib/links/attachmentLinks.ts`) as a fallback so live disputes already submitted to Shopify with long URLs continue to work through their 180-day TTL. After that window the legacy verifier and the `EVIDENCE_LINK_SECRET` env var become dead code and can be deleted.

**Route (`app/e/[token]/route.ts`):** dispatches on URL shape — codes that match `SHORT_CODE_RE` (10-char Crockford Base32) are resolved via `resolveShortLink` against `evidence_short_links` (rejecting expired or revoked rows); anything else falls through to the legacy HMAC verifier. Both paths converge on `loadAndStream`, which resolves the target row in Postgres, calls `sb.storage.from(bucket).download(path)` to read the bytes via the service role, and returns them with `Content-Type`, `Content-Disposition: inline; filename="<sanitized>"`, `Content-Length`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. **No `createSignedUrl` call anywhere** — we never mint a Supabase URL, so it can't leak via redirects, proxy logs, or compliance tooling. Any failure returns `404 Not Found` to avoid disclosing why.

**Submission format:** the job handler (`lib/jobs/handlers/saveToShopifyJob.ts`) queries `evidence_items` with `source = "manual_upload"` for the pack (NOT `pack_json.sections`, because that is a build-time snapshot and misses post-build uploads), mints one short-link row per upload plus one for the pack PDF (via `createShortLink`), and appends a text block built by `formatManualAttachmentsBlock` (`lib/shopify/manualAttachments.ts`) to **`input.uncategorizedText` only**. Header is pinned at `Supporting documents (secure access links):`. When every upload falls into the catch-all `Supporting documents` group (no merchant labels, or labels that don't map to one of the seven canonical category headings), the inner group heading is suppressed so the bank-facing block does not stack two near-identical "Supporting documents" lines back-to-back; categorised submissions (Order Facts, Delivery proof, Customer Communication, etc.) keep their per-group headings. **`POST /api/packs/:packId/upload`** stores `payload.checklistField` (the Evidence-tab checklist row the merchant uploaded from, defaulting to `supporting_documents` when omitted) and logs **`item_added`** with `evidenceItemId` + `checklistField` for the same row. **`loadChecklistFieldByEvidenceItemIdFromAudit`** (`lib/shopify/manualUploadChecklistFromAudit.ts`) lets the save job and submission preview recover `checklistField` when an older `evidence_items` row predates `payload.checklistField` but a matching audit row exists; the save job then **updates** `evidence_items.payload.checklistField` so later reads are self-contained. Uploads from before both payload and audit carried that metadata cannot be assigned to the correct Evidence row retroactively (no source of truth). The formatter prints a **section title** per group from `checklistField` — typically the same row label as in the workspace (e.g. `Delivery proof`, `Supporting Documents`, `Product Description`), falling back to one of the seven category headings when no row title is mapped, then to label-heuristics + dispute-reason priority, then to a generic `Supporting documents` group. Each file line is `- <evidence-type prefix> - <filename>` followed by the DisputeDesk URL on the next line; the prefix is suppressed when it would be redundant (label missing, label equals filename, or label equals the section heading). File sizes and upload dates are intentionally omitted from the submitted text. The pack PDF is rendered last under `Full evidence pack (PDF):`. No other Shopify field is modified. The `evidence_saved_to_shopify` audit event records `manual_attachment_count` and `pdf_attached` for traceability.

**Multi-purpose evidence (reason-aware primary category):** a single upload often supports more than one category — e.g. a `Delivery confirmation email` is both Fulfillment and Customer Communication. The formatter resolves this by collecting every category the merchant's label could plausibly belong to, then breaking the tie using a per-reason-family priority table (`CATEGORY_PRIORITY_BY_FAMILY` in `manualAttachments.ts`, keyed by `DISPUTE_REASON_FAMILIES`). Examples: for `FRAUDULENT` / `PRODUCT_NOT_RECEIVED` the family-Fraud / family-Fulfillment priorities both put `Fulfillment & Delivery` first, so the email is filed there; for `SUBSCRIPTION_CANCELED` (family `Subscription`), `PRODUCT_UNACCEPTABLE` (family `Quality`), or `CREDIT_NOT_PROCESSED` (family `Refund`), `Customer Communication` outranks Fulfillment so the same email is filed under Communication. The dual nature is preserved by the inline evidence-type prefix on the file line — the bank still reads "Delivery confirmation email" even when the heading above is `Customer Communication`. Uploads are listed once, never duplicated. When the dispute reason is null or unrecognised the formatter falls back to a default priority order matching the historical first-match behaviour. The save job (`saveToShopifyJob.ts`) and the preview route (`app/api/packs/[packId]/submission-preview/route.ts`) both pass `dispute.reason` to the formatter so the rendered preview matches the submitted bytes.

**Preview parity:** `GET /api/packs/:packId/submission-preview` (`app/api/packs/[packId]/submission-preview/route.ts`) runs the same serialization as the save job — `buildEvidenceForShopify` (pack sections + `rebuttal_drafts` text) → `formatManualAttachmentsBlock` → `FIELD_MAPPINGS` projection. The only deliberate divergence is the attachment URL: the preview substitutes the literal string `https://disputedesk.app/e/<secure-link>` for the real HMAC token, so an authenticated read of this endpoint cannot leak 180-day credentials. The Review & Submit tab's two rendered surfaces — Section 2 ("What was sent" receipt, shown after submit) and Section 3 ("What will be submitted" collapsible preview, shown before submit) — both consume the API's `fields[]` response directly. Neither hand-rolls a renderer, so they cannot drift from the bytes the save job emits. `ReviewSubmitTab.tsx` keeps a single shared `submissionBlockStyle` constant used by both surfaces to guarantee visual identity.

**Bank-facing labels and IP intelligence:** the preview UI intentionally displays merchant-facing headings, not raw Shopify API field names. For example, `uncategorizedText` is shown as `Additional evidence and supporting documents`, while the payload still uses Shopify's required field name internally. `buildEvidenceInputFromRaw` also special-cases IP & Location Check sections before the generic `other` serializer: raw `ipinfo` JSON, raw IP addresses, and coordinates must never be emitted. Clean IP intelligence is rendered as a short prose block (`Device / IP evidence`) with location/network context and a "no VPN/proxy/hosting" reliability sentence; non-positive IP signals fall back to the neutral reviewed sentence so negative details do not leak through the generic serializer.

**Bank-grade rebuttal template (FRAUDULENT, UNRECOGNIZED, PRODUCT_NOT_RECEIVED, DUPLICATE, GENERAL):** `lib/argument/responseEngine.ts` assembles issuer-facing copy via `buildBankGradeRebuttal(EvidenceData)` (single plain-text string, paragraphs separated by blank lines). `generateDisputeResponse` maps that structure into `RebuttalSection[]` (`summary` = opening, `claim` rows = `bank-grade-payment` / `bank-grade-transaction` / `bank-grade-device` / `bank-grade-supporting` as emitted, `conclusion` = closing). Fixed production copy blocks: opening reversal request; conditional payment authentication (authorization, capture, AVS **Y**, CVV **M**, then the possession line when any payment line ran); transaction behavior when `hasOrderConfirmation`; **device/location only when `isEvidenceDataDeviceLocationBankEligible(data)` returns true** — pack-side `bankEligible === true` AND `ipCountryMatchesShipping === true` AND `ipNoVpnProxyHosting === true`. Anything else (false, null, or missing) means the entire device paragraph is omitted from bank-facing output; the IP / city / region / country / ISP / ASN never reach the bank, and mismatches are never reframed as positive (the previous "cross-border purchasing behavior" neutralizer was deleted in 2026-05). Supporting documentation when `hasSupportingDocs`; closing reversal demand. Refund, subscription, product, and digital families keep their existing strategies. Shopify field routing (`formatEvidenceForShopify`, `FIELD_MAPPINGS`) is unchanged — and shares the same eligibility helper, so `accessActivityLog` and `uncategorizedText` agree on the gate by construction.

**Single-source bank-eligibility gate (`lib/argument/deviceLocationEligibility.ts`):** `isDeviceLocationBankEligible(section)` (raw pack section) and `isEvidenceDataDeviceLocationBankEligible(data)` (projected `EvidenceData`) export the canonical decision used by every bank-facing surface. The rule: emit IP/device detail only when the source section explicitly sets `bankEligible: true`; defense-in-depth checks then verify country match and clean privacy. Internal/merchant-facing UI continues to read the source section directly and still surfaces the mismatch with merchant guidance — the gate only governs *bank-facing* text. Regression coverage: `lib/argument/tests/bankFacingIpLeak.regression.test.ts` pins the AEE832AD scenario (BR IP + US shipping + `bankEligible: false`) and asserts that none of city / region / country / ISP / ASN / "cross-border" / "differs from the shipping destination" reaches the rebuttal.

**Pack-to-EvidenceData plumbing:** `app/api/disputes/[id]/argument/route.ts` reads `pack_json.sections[]` and calls `extractEvidenceDataFromPack(sections, dispute)` (`lib/argument/evidenceDataFromPack.ts`, pure, no I/O) before `generateRebuttalDraft`. Extraction is section-driven plus **`disputes.customer_email`** for `hasCustomerEmail` when the order snapshot omits email. That column is defined in `20260425120000_disputes_customer_email.sql` and filled by **`syncDisputes`** from GraphQL `disputeEvidence.customerEmailAddress` (`DISPUTE_LIST_QUERY` in `lib/shopify/queries/disputes.ts`). If the column is missing in a database, PostgREST returns **400** on the dispute `select` and the route must not misreport that as **404** (handled via explicit `error` checks on `.single()`). The extractor pulls AVS/CVV codes from the `Payment Verification (AVS/CVV)` section, derives `authorizationSucceeded` from `avsCvvStatus ∈ {available, unavailable_from_gateway}`, derives `captureSucceeded` from the order's `financialStatus` / `displayFinancialStatus ∈ {PAID, PARTIALLY_PAID, PARTIALLY_REFUNDED}`, sets `hasOrderConfirmation` from the primary order section, `hasSupportingDocs` from `source === manual_upload` sections, and converts `IP & Location Check` `ipinfo` into city/region/country/org + privacy booleans (no raw JSON in the rebuttal). Raw IP addresses, coordinates, and the full privacy object are not copied into issuer-facing rebuttal text.

**Merchant help and i18n:** The Help Center article **`defense-letter-rebuttal`** is registered in `lib/help/articles.ts` with i18n keys `help.articles.defenseLetterRebuttal.title` / `.body` in all locale files. It is included in the Shopify embedded app help (`EMBEDDED_ARTICLE_SLUGS` in `lib/help/embedded.ts`) so merchants can read the same explanation in-app as on the portal. Related articles: `evidence-checklist`, `how-evidence-saved`, `field-mapping`.

**Security model:**

| Property | Guarantee |
|---|---|
| Integrity | Codes are 50-bit cryptographic random values stored server-side. They cannot be forged or extended without authoring a row in `evidence_short_links` (service-role only). Legacy HMAC tokens additionally have HMAC-SHA256 integrity over `(k, id, p, exp)`. |
| Expiry | `expires_at` on the row is checked server-side; expired codes 404. Legacy tokens carry their own `exp` and are checked the same way. |
| Confidentiality | Same class as a signed URL: possession grants access. No per-reviewer auth (issuing banks don't have accounts with us). |
| Host hygiene | Supabase is never contacted by the bank's client. Bytes are served from `disputedesk.app`. |
| Revocation | Per-link via `evidence_short_links.revoked_at` (no UI yet). Global revocation of legacy tokens still requires rotating `EVIDENCE_LINK_SECRET`. |

**Known pre-existing gap (tracked, not fixed here):** `GET /api/packs/:packId/download` is unauthenticated today. Anyone who can guess a pack id can fetch a short-lived signed URL for the pack PDF. This predates the `/e/<token>` work and is a separate follow-up; it does not compromise the `/e/<token>` model.

### Save Safeguards

The API and the client enforce three gates before a save is allowed:

| Condition | Server response | Client behaviour |
|---|---|---|
| `submission_readiness === "blocked"` | 422 `PACK_BLOCKED` | Critical banner shown; no API call made |
| `submission_readiness === "ready_with_warnings"` or `completeness_score < 80` without `confirmWarnings: true` | 422 `PACK_HAS_WARNINGS` (includes `score`, `readiness`) | Polaris `Modal` ("Submit with current evidence?") shown for merchant confirmation; on confirm, resends with `{ confirmWarnings: true }`. Modal banner names the specific reason: warnings path lists `submitOverrideGaps` (critical-but-not-blocking missing checklist items); weak-strength path states the case rating, the `improvementHint`, and `whyWins.weaknesses` so merchants see *why* the override is needed before acknowledging it. |
| `completeness_score === 0` | 422 `PACK_INCOMPLETE` | No evidence collected at all |
| `status === "queued"` or `"building"` | — (client gate only) | Save button replaced by spinner + "Generating evidence…" label |
| `completeness_score >= 80` | Proceeds normally | Button enabled, no modal |

Server-side check is authoritative — the client guard is UX only. Both are required to prevent a merchant from bypassing the UI (e.g. direct API call) and saving an empty pack.

### UX Compliance

All UI labels say "Save evidence." Never "Submit response" or "Submit to card network."

## Billing & Plan Limits

### Plans

| Plan | Price | Packs/Month | Auto-Pack | Rules |
|------|-------|-------------|-----------|-------|
| Free (Sandbox) | $0 | 3 (lifetime) | No | No |
| Starter | $29/mo | 15 | Yes | Up to 5 |
| Growth | $79/mo | 75 | Yes | Yes (advanced) |
| Scale | $149/mo | 300 | Yes | Yes (advanced) |

Paid plans include a 14-day trial with 25 playbooks.

### Embedded Billing UI

The embedded billing page (`app/(embedded)/app/billing/page.tsx`) uses custom Tailwind styling (not Polaris layout) to match the Figma design:

- **Single card container** with header ("Plan management" + "Apply discount" button), current plan section (icon, name, price, usage), and a "Next plan" recommendation banner with inline upgrade CTA.
- **Collapsible 4-column plan grid** toggled by "Show/Hide all plans". The Growth card is fully inverted (solid blue `#1D4ED8` background, white text) with a floating "Popular" pill badge.
- **Discount modal** triggered from header for discount code entry.
- **Top-ups section** as a separate card below the main container.
- **Downgrade modal** uses Polaris `<Modal>` for Shopify consistency.

### Enforcement

Server-side only. `checkPackQuota()` (`lib/billing/checkQuota.ts`) gates pack creation against the
remaining balance in `pack_balance` (a view derived from `pack_credits_ledger − pack_usage_events`).
`checkFeatureAccess()` gates auto-pack and rules by plan tier.

**Gate at enqueue:** `POST /api/disputes/:id/packs` calls `checkPackQuota()` and returns 403
`upgrade_required: true` when the balance is zero. This is the merchant-visible block.

**Ledger update on success:** When `lib/jobs/handlers/buildPackJob.ts` completes a build with
`status: "ready"`, it calls `consumePack({ shopId, disputeId, packId, eventType: "finalize" })`.
The unique index on `pack_usage_events (shop_id, dispute_id, event_type)` makes consumption
idempotent — handler retries and pack rebuilds for the same dispute never double-charge.
**Failed builds never consume credit** (the call lives inside `if (buildSucceeded)`).

**Rare race — quota drained between enqueue and finalize:** `consumePack` throws
`PackLimitReachedError`. The handler flips the pack to `status: "failed"`, writes audit
`pack_limit_reached_at_consume`, emits a `PACK_BUILD_FAILED` event with
`failure_code: "pack_limit_reached"`, and skips auto-save. Other errors from `consumePack`
log + continue (a billing-side fluke should not break a successful build).

Guards at: `POST /api/disputes/:id/packs` (quota), `POST /api/rules` (feature),
`runAutomationPipeline()` (both).

### Shopify Billing Flow

1. `POST /api/billing/subscribe` → `appSubscriptionCreate` → merchant redirected to Shopify approval
2. `GET /api/billing/callback` → **verifies the charge with Shopify**, then upgrades `shops.plan` + grants credits
3. `GET /api/billing/topup-callback` → **verifies the one-time charge with Shopify**, then grants top-up credits
4. `GET /api/billing/usage?shop_id=...` → returns plan, monthly usage, and `shop_domain`

If the store session is invalid (e.g. missing shop domain) or the shop is not connected, subscribe returns 400 or 404 with an error message. The billing UI (portal and embedded) shows this message and an **Open in Shopify Admin** link so the merchant can open the app from Shopify Admin to restore a valid session (after using **Clear shop & reconnect** in the sidebar if needed).

### Server-to-server charge verification

Both billing callbacks query Shopify GraphQL `node($id)` for the charge GID **before** granting credits or
upgrading a plan. Without this gate, the query-string `charge_id` is forgeable — anyone could craft
`/api/billing/topup-callback?shop_id=…&sku=topup_25&charge_id=anything` and walk away with free credits.

Helper: `lib/shopify/queries/appChargeStatus.ts` exports `verifyAppCharge({ shopId, chargeId, chargeType, expectedAmountUsd })`.
It returns `{ verified: false, reason }` instead of throwing, so callers branch on `verified`.

Acceptance criteria:

| Check | Failure reason |
|---|---|
| `getShopBackgroundSession` succeeds | `no_session` |
| `node($id)` resolves to a non-null node | `node_not_found` |
| `__typename` matches `chargeType` (`AppSubscription` / `AppPurchaseOneTime`) | `wrong_type` |
| `status === "ACTIVE"` | `not_active` (the only acceptable status — `PENDING`, `DECLINED`, `EXPIRED`, `CANCELLED`, `FROZEN` all reject) |
| `currencyCode === "USD"` | `currency_mismatch` |
| `Math.abs(reportedAmount − expectedAmountUsd) < 0.01` | `price_mismatch` (defends against pairing a real Starter charge with `plan_id=scale`) |
| GraphQL `errors[]` empty | `shopify_error` (never silently grant on Shopify error) |

GID construction: Shopify's billing redirect sends the numeric charge id (`?charge_id=12345678`).
`verifyAppCharge` builds the GID locally — `gid://shopify/AppSubscription/${id}` or
`gid://shopify/AppPurchaseOneTime/${id}` — unless the caller already provided a full `gid://`.

Failed verification writes audit `billing_verification_failed` (subscription) or
`topup_verification_failed` (one-time) with `{ reason, status, shopify_gid }`, then redirects to
`/app/billing?verify_failed=<reason>`. Approved verifications write `billing_activated` /
`topup_purchased` with `charge_verified: true` and `test_charge` flag for ops telemetry.

**Known follow-up:** `grantCredits` uses an INSERT keyed by `reference` (which embeds `charge_id`), but
`pack_credits_ledger` has no unique index on `reference`. A duplicate callback hit (e.g. merchant
double-clicking the approval URL) could grant twice. Out of scope for the App Store readiness sprint;
a future migration adding `unique(reference)` is the durable fix.

### Billing deep link (`/app/billing?plan=…`)

The embedded Billing page (`app/(embedded)/app/billing/page.tsx`) accepts an optional query parameter **`plan`**: `free` \| `starter` \| `growth` \| `scale` (aligned with `lib/billing/plans.ts`).

| Value | Behavior |
|-------|----------|
| `free` | Expands the plan comparison, scrolls to the Free tier (`#billing-plan-free`). |
| `starter`, `growth`, `scale` | If the shop’s current plan tier is **below** the target tier, triggers the same upgrade path as **Upgrade** on the page (`POST /api/billing/subscribe`). If already on that tier or higher, the query is stripped only. |

Implementation uses `sessionStorage` keys `dd_billing_plan_query_{plan}` so React Strict Mode does not double-invoke subscription; the URL is cleaned with `router.replace` after handling.

**Marketing site:** The homepage pricing grid (`components/marketing/MarketingLandingPageClient.tsx`) links each CTA to `/app/billing?plan=…` for the matching tier. Merchants need a **Shopify embedded session** (app opened from Admin) for billing to apply; without it, middleware may redirect to `/app/session-required` with a return URL—same as any other `/app/*` request without session cookies.

## Hardening

### Rate Limiting

In-memory sliding-window counter in `lib/middleware/rateLimit.ts`.
Per-shop: 100 req/min. Webhook global: 1000 req/min. Returns 429 with Retry-After.

### Input Validation

Zod schemas in `lib/middleware/validate.ts`. Applied to rules CRUD and billing subscribe.
`validateBody(body, schema)` returns parsed data or 400 with field-level errors.

### Data Retention

Weekly cron archives packs older than `shops.retention_days` (default 365).
PDFs deleted from storage. Audit events never deleted.

### Backups & Disaster Recovery

**Scope.** All stateful data lives in Supabase (Postgres + Storage). Vercel is stateless — recovery is `vercel rollback <deployment-url>` or a redeploy from git. This section covers the Supabase side.

**Authoritative copy.** The production Supabase project `sddzuglxdnkhcnjmcpbj` is the single source of truth for shops, disputes, evidence_packs, audit_events, jobs, and the pack PDFs in the `evidence-packs` storage bucket. DisputeDesk does **not** maintain an off-platform mirror — recovery depends on Supabase's managed backups.

**Backup mechanism.** Provider-managed automated backups (frequency and retention window depend on the project's current Supabase tier — confirm in **Dashboard → Project Settings → Database → Backups**). Pro and above include point-in-time recovery; Free is daily-snapshot only. Backups are encrypted at rest by the provider.

**RPO / RTO targets.**

| Metric | Target | Rationale |
|---|---|---|
| **RPO** (recovery point objective — max acceptable data loss) | **≤ 24 h** on Free, **≤ 5 min** on Pro PITR | Disputes accrue continuously; a day of lost evidence collection is the ceiling before merchants notice missing packs. Pro PITR makes 5 min the realistic floor. |
| **RTO** (recovery time objective — max time to restore service) | **≤ 4 h** from incident declaration to live traffic on restored DB | Bounded by Supabase restore-into-new-project workflow (typically 30–90 min for our row volume) + connection string swap in Vercel env + redeploy. |

These are targets, not SLAs. The actual restore drill has not been measured against production volume since project inception.

**The "verified restorable backup" rule.** [docs/runbooks/prod-current-state-snapshot.md](docs/runbooks/prod-current-state-snapshot.md) § 1 requires the operator to produce a backup, restore it into a scratch destination, and confirm row counts on three sentinel tables (`shops`, `disputes`, `evidence_packs`) match the source — *before* any infrastructure change that could touch the data layer. A backup that hasn't been restore-tested doesn't count as a backup. This drill should be re-run at least quarterly.

**Recovery runbook (Supabase).**

1. **Detect.** Production incident — DB corruption, accidental destructive DDL, region outage. Page on-call; declare a recovery operation in the audit channel.
2. **Freeze writes.** Today this means pausing the cron schedule in `vercel.json` (re-deploy with the `crons` array commented out) and rotating the offline-session access tokens in `shop_sessions` so the next webhook from Shopify lands with `Auth invalid` instead of writing. There is no in-app read-only flag yet — a `DD_READ_ONLY` env switch is on the post-launch follow-up list and would make this step a one-line redeploy. Stopping writes during restore is essential so the recovered DB has a clean cutover point.
3. **Pick a recovery point.** Free tier → either Supabase's most recent nightly snapshot, OR the most recent R2 dump from `.github/workflows/db-backup.yml` (30-day retention, daily at 04:00 UTC). The R2 dump is the right choice when the corruption window is older than Supabase's single nightly retention. Pro tier → choose PITR timestamp from the dashboard. Document the chosen timestamp + source in the incident channel.
4. **Restore into a new Supabase project.** Restoring on top of a corrupted prod project is rarely safe; restoring into a fresh project + cutting traffic over is. Region must match prod. From an R2 dump: `aws s3 cp s3://$R2_BUCKET/<dump> ./ --endpoint-url=https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com` then `pg_restore -d "$TARGET_DB_URL" --clean --if-exists --no-owner <dump>`.
5. **Spot-check row counts** on `shops`, `disputes`, `evidence_packs`, `audit_events`. Compare against the last known-good monitoring snapshot.
6. **Cut over.** Update `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_URL_POSTGRES` in Vercel prod env to point at the restored project. Redeploy. Clear `DD_READ_ONLY`.
7. **Post-restore audit.** Write an `audit_events` row (`actor_type: 'system'`, `event_type: 'data_retained'`, payload describing the recovery timestamp + chosen recovery point) on every shop touched, so the restoration itself is in the audit trail. Notify affected merchants if any data is unrecoverable.

**Storage backups.** Pack PDFs and manual uploads in `evidence-packs` are covered by Supabase Storage's standard backup policy on the same Pro/Free tier. PDFs are deterministically regenerable from `evidence_packs.pack_json` via the `render_pdf` job — so even if a storage backup gap eats a PDF, the underlying evidence survives and the PDF can be rebuilt.

**Known gaps (out of scope for App Store submission, tracked for post-launch).**

- **Off-platform mirror — partial.** A daily `pg_dump --format=custom` is taken by `.github/workflows/db-backup.yml` (04:00 UTC) and uploaded to a Cloudflare R2 bucket with 30-day retention. This survives a Supabase org-level compromise (admin credential theft bypasses provider backups, but not a separate Cloudflare account). Limitations: (a) RPO is still ≤ 24 h on Free since dumps are daily, not continuous; (b) Storage bucket objects (PDFs, manual uploads) are NOT in the dump — they live in Supabase Storage and follow the standard storage backup policy. Required GitHub secrets: `SUPABASE_DB_URL` (direct connection, not pooler), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Also: rotate the Supabase admin password to a 1Password-only value and enable 2FA on the org owner account.
- **No automated restore drills.** The "verified restorable backup" check in `prod-current-state-snapshot.md` § 1 is currently a one-time gate, not a recurring test. Quarterly cadence is the right floor.
- **No documented row count baselines.** Recovery step 5 ("spot-check") has no reference table. After the next quarterly drill, capture the row counts and pin them in `prod-current-state-snapshot.md` § 2 as the "expected at restore" baseline.
- **No in-app read-only flag.** Step 2 of the runbook ("freeze writes") relies on disabling crons + invalidating offline sessions; a `DD_READ_ONLY=1` env flag checked in middleware would collapse this to a one-line redeploy.
- **HaveIBeenPwned password toggle not enabled (Supabase Auth → Sign In / Providers → Email → "Prevent use of leaked passwords").** The toggle is **Pro-plan only** on Supabase; project `sddzuglxdnkhcnjmcpbj` is on Free. Compensating control: keep **Minimum password length ≥ 8** and a non-empty **Password requirements** option on the same screen. Re-enable the HIBP toggle when the project is upgraded to Pro (same upgrade that unlocks PITR backups — see disaster-recovery section above).

**Public-facing copy.** Merchants see one line on [data-retention](app/(marketing)/data-retention/page.tsx#L99-L108): *"Our managed database provider takes encrypted backups for disaster recovery. Backups are retained for a rolling window consistent with the provider's standard policy."* That is intentionally vague — sharing exact RPO/RTO targets externally is a commitment, not a description.

### CI Pipeline

`.github/workflows/ci.yml`: typecheck → lint → tests → npm audit → forbidden copy check.

### Structured Logging

`lib/logging/logger.ts`: JSON format with `timestamp`, `level`, `message`, context fields.
`logger.timed()` wraps operations with duration measurement.

## Testing

### Unit Tests (Vitest)

| Suite | File | Assertions |
|-------|------|------------|
| Completeness Engine | `lib/automation/__tests__/completeness.test.ts` | 7 tests: per-reason scoring, blocker detection, recommended actions, GENERAL fallback, edge cases |
| Auto-Save Gate | `lib/automation/__tests__/autoSaveGate.test.ts` | 9 tests: gate pass/block/park logic, threshold boundaries, priority ordering, approval overrides |
| withShopParams | `tests/unit/withShopParams.test.ts` | URL param preservation, missing params, edge cases |
| Setup Constants | `tests/unit/setupConstants.test.ts` | Step definitions, prerequisite logic, next-actionable-step |
| Setup Types | `tests/unit/setupTypes.test.ts` | Type structure and enum validation |
| Setup Events | `tests/unit/setupEvents.test.ts` | logSetupEvent Supabase insertion |
| Setup Migration | `tests/unit/setupMigration.test.ts` | SQL migration structure validation |
| Setup State API | `tests/api/setup/state.test.ts` | GET /api/setup/state route handler |
| Setup Step API | `tests/api/setup/step.test.ts` | POST /api/setup/step route handler |
| Setup Skip API | `tests/api/setup/skip.test.ts` | POST /api/setup/skip route handler |
| Setup Undo-Skip API | `tests/api/setup/undoSkip.test.ts` | POST /api/setup/undo-skip route handler |
| Setup Readiness API | `tests/api/setup/readiness.test.ts` | GET /api/setup/readiness route handler |
| Setup Welcome | `tests/unit/setupWelcome.test.ts` | Wizard structure: 5 steps, 0-based indexes, no prereqs |
| Setup Welcome i18n | `tests/unit/setupWelcomeI18n.test.ts` | setup.welcome.* i18n key completeness |
| Setup Readiness | `tests/unit/setupReadiness.test.ts` | evaluateReadiness() session/scope/webhook checks |
| Recommend Templates | `tests/unit/recommendTemplates.test.ts` | Template recommendation algorithm + evidence confidence derivation |
| Coverage/Activate i18n | `tests/unit/setupCoverageI18n.test.ts` | coverage, activate, and evidence i18n key completeness |
| Integrations Status API | `tests/api/integrations/status.test.ts` | GET /api/integrations/status route handler |
| Gorgias Connect API | `tests/api/integrations/gorgiasConnect.test.ts` | POST /api/integrations/gorgias/connect |
| Gorgias Disconnect API | `tests/api/integrations/gorgiasDisconnect.test.ts` | POST /api/integrations/gorgias/disconnect |
| Sample Files API | `tests/api/files/samples.test.ts` | GET + POST /api/files/samples |
| Sample Files Delete API | `tests/api/files/samplesDelete.test.ts` | POST /api/files/samples/delete |
| Policy Templates API | `tests/api/policy-templates/route.test.ts` | GET /api/policy-templates |
| Policy Template Content API | `tests/api/policy-templates/content.test.ts` | GET /api/policy-templates/[type]/content |
| Pack Handling Automation | `lib/rules/__tests__/packHandlingAutomation.test.ts` | Pack-based mode parsing + validation |
| Pack Detail API | `tests/api/packs/packDetailRoute.test.ts` | GET /api/packs/[packId] (evidence_packs + library packs fallback) |
| Templates API | `tests/api/templates/route.test.ts` | GET /api/templates (list pack templates) |

### Test Helpers

| Helper | Path | Purpose |
|--------|------|---------|
| Supabase Mock | `tests/helpers/supabaseMock.ts` | Chainable query builder mock for Supabase client |
| Next.js Mock | `tests/helpers/nextMock.ts` | MockNextRequest + MockNextResponse for route handler tests |

Run with:
```bash
npx vitest run
```

### E2E Smoke Test (live DB)

`scripts/smoke-test.mjs` runs against the real Supabase database and validates:

1. Shop creation + `shop_settings` upsert with correct defaults
2. Dispute seeding + DB round-trip (reason, amount, currency)
3. Evidence pack creation + job enqueue
4. Completeness scoring: low score + blockers → `blocked` status
5. Auto-save gate: score below threshold → block decision
6. High-score pack simulation → `ready` status, gate passes
7. Save-to-Shopify simulation: `saved_to_shopify` status + timestamp
8. Audit log recording + immutability trigger enforcement
9. Extended status enum validation (`draft`, `blocked`, `saved_to_shopify`)
10. Full cleanup (no leftover test data)

Run with:
```bash
node scripts/smoke-test.mjs
```

Requires `.env.local` with `SUPABASE_URL_POSTGRES` configured.

## Next.js middleware & local dev

- **`middleware.ts`** handles marketing i18n, portal auth, embedded Shopify sessions, rate limits, and admin redirects. Requests under **`/_next/`** return **`NextResponse.next()` immediately** so webpack chunks, HMR, and other build assets are never rewritten by auth or `next-intl`. If those paths were processed like normal pages, the browser can fail to load JS with **ChunkLoadError** or see **400** responses for `/_next/static/chunks/...`.
- **Stale chunks after pulls or crashes:** The HTML may reference chunk filenames that no longer exist in `.next`. **Fix:** stop `next dev`, remove the cache (`npm run dev:clean` deletes `.next` and starts the server, or delete `.next` manually and run `npm run dev`), then **hard refresh** the tab (or close and reopen the route) so the document loads the current script tags.

## CI Pipeline

1. Typecheck (`tsc --noEmit`)
2. Lint (ESLint)
3. Build
4. Tests (Vitest: contract + unit)
5. Forbidden copy grep (reject "submit response" etc. in UI code)
6. `npm audit --audit-level=critical`

### Release verification

Before any "big update" (changes to auth, Shopify API, evidence
generation/scoring, submission, billing, DB schema, dashboard metrics, or
core UI flows) is promoted to production, run the full release verification
plan: see `docs/RELEASE_TESTING_PLAN.md`. The aggregate command
`npm run release:verify` chains lint + typecheck + vitest + build. Per-release
manual checks live as dated files under `docs/release-checklists/`
(template: `docs/release-checklists/TEMPLATE.md`).

## Internal Admin Panel

A standalone operator dashboard at `/admin/*`, separate from the merchant-facing app.

### Auth
Internal admins use the **same Supabase Auth session** as the marketing/portal sign-in (`/auth/sign-in`). Authorization is a row in `internal_admin_grants` (`user_id` → `auth.users`, optional denormalized `email`, `is_active`, `last_login_at`, `created_at`, `created_by`).

- **Login:** Visiting `/admin` or `/admin/login` requires a portal session. Unauthenticated users are redirected to `/auth/sign-in?continue=/admin`. After sign-in, middleware checks `internal_admin_grants` for the current `auth.uid()`. Users without a grant see `/admin/login?reason=no_access`.
- **Middleware:** Validates the Supabase session cookie (with refresh via `@supabase/ssr`) and loads the grant with the service-role client. `dd_admin_touch_last_login` throttles `last_login_at` updates (about every 30 minutes).
- **Helpers** in `lib/admin/auth.ts`: `hasAdminSession`, `getAdminSessionUser`.
- **First admin:** Grant access with `npm run add:admin-user -- <email>` (requires an existing `auth.users` row) or insert into `internal_admin_grants` via SQL.

### Pages
| Route | Purpose |
|-------|---------|
| `/admin` | Dashboard — active shops, disputes, packs, job queue, plan distribution |
| `/admin/team` | Admin user management — add, deactivate, delete operator accounts |
| `/admin/shops` | Searchable shop list with plan/status filters |
| `/admin/shops/[id]` | Shop detail + admin overrides (plan, pack limit, notes) |
| `/admin/jobs` | Job monitor with status filters, stale detection, retry/cancel actions |
| `/admin/audit` | Audit log viewer with shop/type filters, expandable payloads, CSV export |
| `/admin/billing` | MRR, plan distribution, per-shop monthly usage |

### API Routes
- `GET /api/admin/logout` — signs out the Supabase session (same as portal)
- `GET /api/admin/metrics` — aggregated dashboard data
- `GET /api/admin/team` — list admin users (no password_hash)
- `POST /api/admin/team` — grant admin by email (must match an existing portal `auth.users` row; `created_by` tracked)
- `PATCH /api/admin/team/[id]` — toggle is_active; rejects self-deactivation
- `DELETE /api/admin/team/[id]` — delete user; rejects self-deletion
- `GET /api/admin/shops` — list shops (search, plan, status filters)
- `GET/PATCH /api/admin/shops/[id]` — shop detail + admin overrides
- `GET /api/admin/jobs` — list jobs with stale enrichment
- `PATCH /api/admin/jobs/[id]` — retry or cancel jobs
- `GET /api/admin/audit` — audit events (JSON or CSV format)
- `GET /api/admin/billing` — MRR + plan distribution + per-shop usage

## Multi-Language (i18n)

### Stack
- `next-intl` for translation management and `useTranslations()` / `useFormatter()` hooks.
- BCP-47 locale tags: `en-US`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, `sv-SE`.
- Message files at `messages/{locale}.json` (e.g. `en-US.json`, `sv-SE.json`).

### Marketing URLs and SEO (public landing)
The public marketing site uses **short path segments** via `next-intl` (`i18n/routing.ts`, `localePrefix: 'as-needed'`). Message files stay **BCP-47**; URL segments map through `lib/i18n/pathLocales.ts`.

| URL path | Messages loaded | Notes |
|----------|-----------------|--------|
| `/` | `en-US` | Default English; **no** `/en` prefix. |
| `/de`, `/es`, `/fr`, `/pt`, `/sv` | `de-DE`, `es-ES`, … | Two-letter language codes. |

- **Legacy URLs** (`/en-US`, `/de-DE`, …) are **redirected** in `middleware.ts` to the paths above.
- **Homepage metadata:** `lib/marketing/homeMetadata.ts` exports `buildMarketingHomeMetadata(pathLocale)`. **`app/[locale]/page.tsx` only** calls it from `generateMetadata` (the `[locale]` layout sets **only** `metadataBase` when origin is known, so homepage title/description are not shallow-merged onto `/resources` or other hub routes). Strings come from `messages/*.{locale}.json` → **`marketing.seo`** (`title`, `description`, `keywords`). When `getPublicBaseUrl()` resolves, **canonical** path via `marketingHomePath()`, **Open Graph** (`type: website`, `siteName`, `locale`, `alternateLocale`, `url`), and **Twitter** (`summary_large_image`) apply; absolute URLs use layout `metadataBase`.
- **Homepage structured data:** `app/[locale]/page.tsx` is a Server Component that wraps `components/marketing/MarketingLandingPageClient.tsx` and, when origin is known, injects a second JSON-LD script: **`marketingHomeWebPageJsonLd()`** in `lib/marketing/jsonLd.ts` — a `WebPage` node with `@id` `{pageUrl}#webpage`, `isPartOf` → `{pageUrl}#website`, `publisher` → `{origin}/#organization`. The layout’s `MarketingJsonLd` component (same file) already emits **`Organization`** + **`WebSite`** in one graph; the homepage adds an explicit **WebPage** for the landing URL.
- **Hreflang / alternates (homepage):** `buildMarketingHomeMetadata` sets `metadata.alternates.languages` with BCP-47 keys (`en-US`, `de-DE`, …) pointing to each locale’s home path, plus `x-default` → `/`. Hub routes (e.g. `/resources`) set their own `alternates` in their `generateMetadata` (see Resources Hub §).
- **Crawlers (e.g. Googlebot):** Each language is a **distinct, indexable URL** with reciprocal `hreflang`-style annotations in the document head (Next.js `metadata.alternates`). Ensure pages are not blocked by `robots.txt` and return `200` for each locale URL. **Sitemap:** `app/sitemap.ts` lists localized marketing URLs and published content (see § SEO & Search Engine Indexing below).

### Locale Registry (`lib/i18n/locales.ts`)
Single source of truth for all locale data. Exports:
- `Locale` type — union of supported BCP-47 tags.
- `LOCALES` — array with `locale`, `language`, `region`, `label`, `nativeName`, `short`.
- `isLocale()` — type guard.
- `normalizeLocale()` — maps freeform input (`'en'`, `'pt_BR'`, `'sv'`) to best match.
- `resolveLocale({ userLocale, shopLocale, shopifyLocale })` — cascading fallback.
- `getLocaleDisplay()` — UI display metadata.

### Locale Resolution (cascading fallback)
1. User locale (`dd_locale` cookie or `portal_user_profiles.user_locale`).
2. Shopify locale param: `?locale=` query param from Shopify on embed load, forwarded by middleware as `x-shopify-locale` request header so it is available on the **first** request (the `dd_locale` cookie is set in the response and is only readable from the second request onward).
3. Shop locale (`shops.locale` column, BCP-47).
4. Accept-Language header.
5. Default: `en-US`.
6. Partial locale fallback: `fr-CA` → base `fr` → `fr-FR`.

### DB Storage
- `shops.locale` — BCP-47 tag, default `'en-US'`.
- `portal_user_profiles.user_locale` — nullable BCP-47 tag (null = inherit from shop).
- `pack_template_i18n` — per-template locale translations (`template_id`, `locale` unique).

### Template I18n (`lib/db/templates.ts`)
- `getTemplateI18n(templateId, locale)` — exact match → base language → `en-US`.
- `getTemplateI18nAll(templateId)` — all translations for admin editing.
- `upsertTemplateI18n(templateId, locale, fields)` — upsert with conflict handling.

### Polaris Integration
- `lib/i18n/polarisLocales.ts` dynamically loads the correct Polaris locale bundle.
- Embedded providers accept `polarisTranslations` prop.

### Adding a Language
1. Create `messages/{locale}.json` (BCP-47 filename, e.g. `ja-JP.json`).
2. Add entry to `LOCALES` array in `lib/i18n/locales.ts`.
3. For **marketing**, add the URL segment and `pathLocaleToMessages` mapping in `lib/i18n/pathLocales.ts`, extend `i18n/routing.ts` `locales`, update middleware locale regex / legacy redirect list, and `next.config.js` CSP locale `source` if needed.
4. Add dynamic import in `lib/i18n/polarisLocales.ts`.

### CI
- Forbidden-copy check scans both `.ts/.tsx` source files and `messages/*.json` translation files.

## Setup Wizard & Onboarding

### Overview

A 6-step guided setup wizard helps merchants configure DisputeDesk after
installation. Progress is tracked per-shop in the `shop_setup` table and surfaced on the
dashboard via a Setup Checklist card with a ring progress indicator.

**Billing, Settings, and Help** are app sections (reachable from nav) but are **not** part of the onboarding checklist.

### Welcome Page (Step 0)

Route: `/app/setup` (`app/(embedded)/app/setup/page.tsx`). Shown to new installs before entering the wizard steps. Displays:
- Hero with shield icon and "Welcome to DisputeDesk" heading
- Three benefit cards (Automated Response, Higher Win Rates, Save Time)
- "What to expect in setup" checklist (6 numbered items)
- "Get Started" CTA → navigates to `/app/setup/connection`
- "Skip setup" link → returns to dashboard

The dashboard redirects here when `connection` step is `todo` (fresh install). i18n keys: `setup.welcome.*` in `messages/en.json`.

### Wizard Steps (onboarding only)

| # | ID | Title | Prerequisites |
|---|-----|-------|---------------|
| 1 | `connection` | Connection | — |
| 2 | `store_profile` | Store Profile | — |
| 3 | `coverage` | Coverage | — |
| 4 | `automation` | Automation | — |
| 5 | `policies` | Policies | — |
| 6 | `activate` | Activate | — |

All 6 steps are shown in both `WIZARD_STEP_IDS` and `WIZARD_STEPPER_IDS` (no separate welcome/pre-steps).

Legacy step ids (`permissions`, `open_in_admin`, `overview`, `welcome_goals`, `disputes`, `sync_disputes`, `packs`, `evidence_sources`, `business_policies`, `rules`, `automation_rules`, `team`, `team_notifications`) are migrated to the new 6-step ids when reading `shop_setup.steps` (see `LEGACY_STEP_ID_MAP` in `lib/setup/constants.ts`).

### Step 1: Connection (`ConnectionStep`)

**Purpose:** Verify Shopify connection health and required permissions before proceeding.

**Implementation:** `components/setup/steps/ConnectionStep.tsx`. Fetches live readiness data from `GET /api/setup/readiness?shop_id=...` and displays 5 status rows:

| Row ID | Label | Blocking | Check |
|--------|-------|----------|-------|
| `shopify_connected` | Shopify connection | Yes | Valid offline session with access token |
| `dispute_access` | Dispute read access | Yes | `read_shopify_payments_disputes` scope |
| `evidence_access` | Evidence write access | Yes | `write_shopify_payments_dispute_evidences` scope |
| `webhooks_active` | Webhook registration | No | Dispute webhooks registered |
| `store_data` | Store data sync | No | Shop details fetchable |

Each row shows a status badge (ready / needs_action / syncing). Continue is disabled while blocking rows have `needs_action` status. Readiness logic lives in `lib/setup/readiness.ts` (`evaluateReadiness()`).

**API:** `GET /api/setup/readiness` (`app/api/setup/readiness/route.ts`) — returns `ReadinessResult` with rows, `hasBlockers`, `hasPending`, `allReady`. No DB writes — purely derived from session and live API checks.

### Step 2: Store Profile (`StoreProfileStep`)

**Purpose:** Collect only the signals that personalize downstream recommendations — store type and proof capability. Everything else (review threshold, automation mode per family, evidence-source overrides) lives on the steps where it's actually configured, to avoid duplication and double-asking the merchant.

**Implementation:** `components/setup/steps/StoreProfileStep.tsx`. Collects:
- Store type (physical / digital / services / subscriptions, multi-select)
- Digital proof capabilities (only shown when digital or services selected)

On Continue the step also derives a default `shopifyEvidenceConfig` via `getDefaultEvidenceConfig(storeTypes)` and persists it alongside the answers in `shop_setup.steps.store_profile.payload`. This default feeds the recommendation algorithm in Step 3 and is overridable in post-onboarding settings — it is intentionally not exposed as 7 dropdowns during onboarding.

**Removed: "Do your Shopify fulfillments include tracking numbers?"** — Shopify's `OrderFulfillment.trackingInfo` already exposes tracking numbers, carrier, URL, and `deliveredAt` when present, and the pack collector (`lib/packs/sources/fulfillmentSource.ts`) reads them directly. The merchant's self-report was redundant for physical stores and a wasted question for digital-only stores. Three knock-on effects were addressed at the same time: (1) `getDefaultEvidenceConfig` now gates `trackingDetails` on `storeTypes.includes("physical")` rather than a proof level; (2) `recommendTemplates` always recommends `pnr_with_tracking` for physical (the `pnr_weak_proof` variant remains available as an "Add more playbooks" opt-in for merchants whose fulfillments lack tracking); (3) `sendEvidenceNeededAlert` gates the carrier-proof ask on `storeTypes.includes("physical")` so digital-only stores never get a shipping-evidence email even if an issuer miscodes a dispute as `PRODUCT_NOT_RECEIVED`.

**Removed during the onboarding slim-down** (still respected for already-onboarded stores via legacy fallbacks):
- `handlingStyle` — third-option "Conservative: notify me first" violated the two-mode rule (`auto` | `review`), and the choice is made per-family on the Coverage and Automation steps anyway.
- `reviewThreshold` — moved to the Automation step, inline on the "Review high-value disputes" safeguard card it actually controls.
- Per-source Shopify evidence dropdowns + "Other evidence (manual upload)" informational rows — not actionable knowledge at first-run; defer to settings.

### Step 3: Coverage (`CoverageStep`)

**Purpose:** Based on store profile and Shopify evidence config from Step 2, recommend dispute templates for the merchant to install.

**Implementation:** `components/setup/steps/CoverageStep.tsx`. On mount:
1. Reads `steps.store_profile.payload` from `GET /api/setup/state`
2. Fetches template catalog from `GET /api/templates`
3. Checks already-installed templates from `GET /api/setup/automation`
4. Runs `recommendTemplates(profile)` (pure function in `lib/setup/recommendTemplates.ts`) to derive recommended templates

**Recommendation algorithm** maps store types to templates:
- Physical → `pnr_with_tracking` + `not_as_described_quality` (the runtime collector adapts the rebuttal to whatever tracking data Shopify actually exposes; `pnr_weak_proof` is opt-in only)
- Digital/services → `digital_goods`, `credit_not_processed`
- Subscriptions → `subscription_canceled`
- Always: `fraud_standard` (universal) + `general_catchall` (fallback)
- Evidence confidence (`high` / `medium` / `low`) derived from evidence config, passed to Step 4

**UI:** Evidence summary (read-only, from Step 2) + dispute family cards with template toggles (on/off) + an **"Add more playbooks"** disclosure that lists every non-recommended chargeback template (e.g. `pnr_weak_proof`, `digital_goods`, `credit_not_processed`, `duplicate_incorrect`, `policy_forward`) so merchants whose store doesn't match a single profile can opt in to extras.

**Silent inquiry pairing:** Inquiry-phase template variants from migration `20260411150000` (`fraud_inquiry`, `pnr_inquiry`, …) are installed alongside their chargeback siblings using `inquiryPairsFor()` from `lib/setup/recommendTemplates.ts`. Merchants never see them in the wizard or the Automation Rules page (`listLibraryPacksForAutomationRules` filters them out via `INQUIRY_TEMPLATE_ID_SET`). Routing happens in `replacePackBasedAutomationRules`, which writes a phase-paired rule per chargeback pack: one rule with `match.phase = ["chargeback"]` pointing at the chargeback template, plus a sibling rule named `__dd_setup__:pack:{packId}:inquiry` with `match.phase = ["inquiry"]` pointing at the inquiry template. `digital_goods` deliberately has no inquiry sibling — inquiries on digital products fall back to `general_inquiry` via the `reason_template_mappings` defaults consulted in `lib/automation/pipeline.ts → resolveAutomationTemplate`.

On save: installs the recommended chargeback templates plus any extras the merchant ticked, plus their inquiry pairs, all via `POST /api/templates/:id/install`. Saves step payload with `installedTemplateIds` (chargeback ids only), `selectedFamilies`, `evidenceConfidence`.

### Step 4: Automation (`AutomationStep`)

**Purpose:** Confirm the one amount-based safety net (review high-value disputes) and show the workflow recap derived from the Coverage step. Implemented in `components/setup/steps/AutomationStep.tsx`. Copy lives under `setup.automation` in locale files.

**UX structure (post-2026-05 honesty pass):**

1. **Header** — title + subtitle.
2. **High-value review card** — one toggle + threshold input (`$` numeric). When enabled, disputes whose amount exceeds the threshold are routed to review before submission. This is the only merchant-tunable safeguard on this step.
3. **Family-routing hint** — a small reminder line below the card that per-dispute-type handling (auto vs. review) was already decided on the previous Coverage step. No duplicated controls.
4. **Workflow recap sidebar** — read-only counts of automated vs. review families, derived from `steps.coverage.payload.coverageSettings` (with a derive-from-store-profile fallback if coverage hasn't been completed yet).

**Removed in 2026-05:** Five additional safeguard toggles (`review_missing_proof`, `review_incomplete`, `review_no_order`, `review_edge_cases`, `notify_ambiguous`) were removed because their toggle state was stored in `automation.payload.safeguards` but **never read by `pickAutomationAction`, `replacePackBasedAutomationRules`, the auto-save gate, or the completeness engine**. The behaviors they claimed to gate either don't exist (`notify_ambiguous`, `review_edge_cases`) or run unconditionally (`review_incomplete`, `review_missing_proof` are always-on via `lib/automation/completeness.ts`; `review_no_order` is structurally enforced because a missing order can't auto-save anyway). Surfacing them as user-controllable toggles was UI theater.

**Data & API:**
1. `POST /api/setup/step` writes the wizard payload `{ highValueReviewEnabled, reviewThreshold }` to `shop_setup.steps.automation.payload` so re-entry shows the merchant's last choice.
2. `POST /api/setup/coverage-rules` with body `{ highValueReview: { enabled, threshold } }` writes the actual tier-0 amount rule into the `rules` table. The route is keyed by `name` so it independently manages safeguard rows (named `__dd_setup__:safeguard:high_value`, priority 5) and coverage rows (named `__dd_setup__:coverage:<family>`, priority 10) — sending only the `highValueReview` field doesn't clobber coverage rules and vice versa.

The shape of the safeguard rule is `match.amount_range.min = threshold`, `action.mode = "review"`, no `pack_template_id` (so the lower-priority per-reason rule's template still wins for the actual pack build). Toggling the safeguard off deletes the row idempotently.

**Email alert on trigger:** When `evaluateAndMaybeAutoSave` resolves to `review` because the matched rule's name is `__dd_setup__:safeguard:high_value`, the pipeline sends `sendHighValueReviewAlert` to the merchant team email. Idempotent per-dispute via `disputes.high_value_alert_sent_at` (migration `20260513120000_disputes_high_value_alert_sent_at`), so pack rebuilds on the same dispute don't re-notify. Respects the team payload's `notifications.evidenceReady` opt-out. Email template lives at `lib/email/sendHighValueReviewAlert.ts`.

**Evaluation order** (unchanged; see `lib/rules/pickAutomationAction.ts`): amount safeguards → per-reason rule → catch-all → default (`review`). Merchant-facing help article: `help.articles.configuringAutomation`.

### Step 5: Policies (`BusinessPoliciesStep`)

**Purpose:** Let merchants set up their shipping, refund, terms, and privacy policies so they get included in every evidence pack.

**Implementation:** `components/setup/steps/BusinessPoliciesStep.tsx`. Three flows — use your own policies (URL or upload), use suggested templates, or mix and match. Selections persist via `POST /api/policies/apply` + `POST /api/setup/step`. Same component also powers the standalone `/app/policies` page so there is one source of truth for policy management.

### Step 6: Activate (`ActivateStep`)

**Purpose:** Review configuration summary and activate protection.

**Implementation:** `components/setup/steps/ActivateStep.tsx`. On mount fetches setup state and automation data.

**UI:** Three summary cards:
1. **Evidence sources** — X of 7 Shopify evidence groups enabled, plus "Other: manual upload"
2. **Coverage** — X templates installed covering Y dispute families, with template names
3. **Automation** — X packs on automatic, Y on review before submit

Info banner explaining what activation does. On save: patches all DRAFT packs to ACTIVE via `PATCH /api/packs/:packId`, saves step payload with `activatedAt`. Shell navigates to `/app/setup/complete`.

### State Machine

Per-shop state persisted in `shop_setup` table:
- Step statuses: `todo | in_progress | done | skipped`.
- Each step has an optional `payload` (JSON) and `skipped_reason`.
- "Save & Continue" marks done. "Skip for now" marks skipped with reason. "Undo skip" resets to todo.
- No hard prerequisite gating between the 6 steps — all steps have empty `prerequisites` arrays.

### Embedded Navigation

All wizard links preserve `shop` and `host` query parameters via
`lib/withShopParams.ts` for Shopify App Bridge compatibility.

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| ProgressRing | `components/setup/ProgressRing.tsx` | SVG ring progress indicator |
| SetupChecklistCard | `components/setup/SetupChecklistCard.tsx` | Dashboard checklist card |
| SetupWizardShell | `components/setup/SetupWizardShell.tsx` | Wizard layout (progress bar, step tiles, nav) |
| StepCardsRow | `components/setup/StepCardsRow.tsx` | Horizontal step tile row |
| WhatThisUnlocksCard | `components/setup/WhatThisUnlocksCard.tsx` | Right sidebar benefit card |
| BottomNav | `components/setup/BottomNav.tsx` | Back / Save / Skip buttons |
| SkipReasonModal | `components/setup/modals/SkipReasonModal.tsx` | Skip confirmation with reason |
| ConnectGorgiasModal | `components/setup/modals/ConnectGorgiasModal.tsx` | Gorgias credential entry |
| UploadSampleFilesModal | `components/setup/modals/UploadSampleFilesModal.tsx` | Sample file upload |
| ComingSoonModal | `components/setup/modals/ComingSoonModal.tsx` | Info modal for upcoming integrations |
| TemplateSetupWizardModal | `components/setup/modals/TemplateSetupWizardModal.tsx` | 4-step template configuration wizard (evidence, sources, review, activate) |
| ConnectionStep | `components/setup/steps/ConnectionStep.tsx` | Step 1: live readiness checks (connection, scopes, webhooks, store data) |
| StoreProfileStep | `components/setup/steps/StoreProfileStep.tsx` | Step 2: store type + proof levels only; derives default `shopifyEvidenceConfig` silently |
| CoverageStep | `components/setup/steps/CoverageStep.tsx` | Step 3: evidence summary + template recommendations + install |
| AutomationRulesStep | `components/setup/steps/AutomationRulesStep.tsx` | Step 4: per-pack auto / review toggle with evidence-aware defaults |
| BusinessPoliciesStep | `components/setup/steps/BusinessPoliciesStep.tsx` | Step 5: shipping/refund/terms/privacy policy setup (own / template / mixed flows) |
| ActivateStep | `components/setup/steps/ActivateStep.tsx` | Step 6: config summary + bulk pack activation |

### Shared Utilities

| Module | Path | Purpose |
|--------|------|---------|
| Types | `lib/setup/types.ts` | StepStatus, StepState, ShopSetupRow, etc. |
| Constants | `lib/setup/constants.ts` | SETUP_STEPS, prerequisite logic, helpers |
| Readiness | `lib/setup/readiness.ts` | `evaluateReadiness()` — live connection/scope/webhook checks |
| Recommend Templates | `lib/setup/recommendTemplates.ts` | `recommendTemplates()` + `deriveEvidenceConfidence()` + `getDefaultEvidenceConfig()` + `CHARGEBACK_TO_INQUIRY_TEMPLATE` + `inquiryPairsFor()` — store profile → template recs + evidence confidence + inquiry pairing |
| Evidence Types | `lib/setup/evidenceTypes.ts` | 8 evidence type definitions + source mappings |
| Events | `lib/setup/events.ts` | `logSetupEvent()` → app_events table |
| withShopParams | `lib/withShopParams.ts` | Preserve shop/host/locale params in URLs. Merges query params when the pathname already contains `?key=value` (e.g. `/app/rules?family=fraud`). |

### Business Policies (`BusinessPoliciesStep`) — implementation notes

**Current state (as of 2026-03-18):** The step implements a 3-flow selection UX
(own policies / use templates / mix & match). It is functional, i18n-complete
across all 6 locales, and the flow-selection screen is visually aligned to the
Figma Make design (3-card horizontal grid, centered header, info banner).

**Polaris / Tailwind v4 CSS cascade conflict (resolved 2026-03-18):**
Shopify Polaris `styles.css` applies un-layered element resets on `h1`–`h6` and
`p` (`font-weight: var(--p-font-weight-regular)` = 450, `font-size: 1em`).
Tailwind v4 emits all utilities inside `@layer utilities`. Per the CSS cascade
spec, un-layered styles always beat layered styles — so Tailwind classes like
`font-bold` and `text-[26px]` on semantic elements were silently ignored.

Two `@layer`-based fixes were attempted and reverted:
- Wrapping Polaris in `@layer polaris` via `@import ... layer(polaris)` —
  this broke all Polaris component styling because Tailwind's `@layer base`
  resets (`border: 0 solid`, `background: transparent` on buttons) gained
  higher priority than Polaris class selectors.
- Declaring `@layer polaris;` before `@import "tailwindcss"` in `globals.css`
  — same problem; the entire Polaris stylesheet was demoted below Tailwind
  base resets.

**Working fix:** Inline `style={{ fontWeight, fontSize }}` on every `h2`, `h3`,
and `p` element in `BusinessPoliciesStep`. Inline styles have highest CSS
specificity, beating both Polaris un-layered resets and Tailwind layered
utilities. This is surgical — only affects this component, zero risk to Polaris
components or other pages. Any future embedded component using Tailwind
`font-bold` / `font-semibold` / `text-*` on `h1`–`h6` or `p` will need the
same treatment (or switch to `<div>`/`<span>` which Polaris does not reset).

**Alignment status (2026-03-18):**
Policy setup UI is aligned to the onboarding-wizard variants:
- Flow-selection screen (3-card grid, centered header, info banner)
- Own flow (per-policy cards with Link URL / Upload file toggle, required/optional badges,
  helper copy, and info banner)
- Template flow (Back to options, blue template banner, Required/Optional badges,
  and single full-width "Preview Template" button per policy row)
- Mixed flow (per-policy cards with Link URL / Upload file / Template toggle,
  required/optional badges, helper copy, and "Best of both worlds" info panel)
- Preview modal (dark overlay, prose body, footer with Select button)

**Important behavior note:** Template bodies are fetched only when opening
Preview (or when saving step selections). They are not pre-fetched on initial
render of the template list.

**Runtime hardening (2026-03-18):**
- `GET /api/policy-templates/[type]/content` now treats Shopify placeholder
  substitution as best-effort only. If shop/session/network lookup fails, the
  endpoint still returns the base Markdown template content.
- `GET /api/shop/details` now validates/guards Shopify session domain usage and
  returns controlled non-500 responses when upstream lookup fails.
- Session loading now falls back to `shops.shop_domain` when legacy or malformed
  `shop_sessions.shop_domain` values are encountered (e.g. invalid host values).

**Schema drift fix (2026-05-14):** `Shop.phone` and `Shop.billingAddress` were
removed in Admin API 2026-01. Selecting either fails the entire query with
`undefinedField`, which silently broke `/api/shop/details` (returned 404 with
no GraphQL error log) and surfaced as the Activate step's empty
team-email field. `lib/shopify/shopDetails.ts` now reads from `Shop.shopAddress`
(new home of `phone` + address) and logs upstream GraphQL `errors` when
`data.shop` comes back empty. `lib/disputes/backfillOrders.ts` still queries
`shop.billingAddress.countryCodeV2` for cross-border enrichment — that call is
wrapped in try/catch so the failure silently fills `is_cross_border=null`; a
follow-up should migrate it to `shopAddress`.

**Schema drift fix (2026-05-15):** `Order.cartToken` and `Fulfillment.metafields`
were both removed in Admin API 2026-01. The drift surfaced as
`pack_build_failed` on dispute `bd425f70` — the auto-build pipeline finally
ran (after the billing-quota fix that day) and immediately collapsed because
`ORDER_DETAIL_QUERY` referenced both removed fields. `lib/shopify/queries/orders.ts`
dropped the field selections (`cartToken` line 22, the per-fulfillment
`metafields` block lines 83–100 in the pre-fix file) and kept the TS interface
fields as optional so downstream consumers in
`lib/packs/sources/fulfillmentSource.ts` and `lib/liabilityShift/*` continue
to null-tolerate. `lib/shopify/queries/customerOrdersForCE30.ts` also lost
its `cartToken` selection. The same `Fulfillment.metafields` error was caught
earlier in `ordersForBackfill.ts` (see comment block in that file) but the fix
never propagated to `orders.ts` — exactly the regression mode the new
**schema-drift guard** in `lib/shopify/queries/__tests__/schemaDriftGuard.test.ts`
now prevents.

**Schema-drift regression guard:** the test file above imports every
production GraphQL string from `lib/shopify/queries/` and
`lib/shopify/mutations/` and runs two layers of assertions: a flat
deny-list for fields removed globally (`cartToken`, `riskAssessments`) and
a parent-aware ban for fields removed only at a specific type
(`Fulfillment.metafields`). The parent check uses a brace-depth scan
to identify the immediate enclosing block name, which is enough for
how Shopify deprecations land in practice. Add a row to the deny-list
the moment any new schema drift is discovered — the regression is
locked in by the next CI run.

This guard is a deny-list, not an allow-list — it cannot catch renames
or brand-new removals until the old name is added to the deny list. To
close that hole, the daily `check-shopify-reasons` cron now also runs
`checkShopifyQueryFieldDrift` (`lib/shopify/checkQueryFieldDrift.ts`).

**Runtime query-field drift checker (2026-05-15):** for every entry in
`lib/shopify/queries/registry.ts` flagged `dryRun: true`, the cron
sends the production query string to Shopify with stub variables —
fake `gid://shopify/<Type>/0` IDs that pass schema validation but
resolve to nothing, so no data is read and no resolver runs. The
checker inspects `errors[]` for entries matching either
`extensions.code = "undefinedField"` or the message regex
`/Field '(.+)' doesn't exist on type '(.+)'/`, aggregates a
`{query, type, field, message}` row per failing selection, and writes
one of two new audit-event types:
- `shopify_query_field_drift` when at least one row was detected.
- `shopify_query_field_drift_resolved` when the previous run had drift
  and the current run is clean.

Email dedup is identical to the enum-drift checker: a new alert
fires only on state change (new drift, changed drift set, or
resolution). Same diff as the last audit = silent.

Mutations are explicitly **excluded** from the dry-run path
(`dryRun: false` in the registry) to eliminate any possibility of a
state-changing resolver firing during the daily check. Mutations are
covered only by the static deny-list guard. Introspection queries are
also excluded — they cannot drift the same way and have a dedicated
checker.

The two checkers run independently from a single cron route
(`app/api/cron/check-shopify-reasons`) and report combined results as
`{enum, queryField}`. A failure in one does not mask the other.

**Key files:**
- `components/setup/steps/BusinessPoliciesStep.tsx` — step component
- `content/policy-templates/` — Markdown template bodies
- `app/api/policy-templates/[type]/content/route.ts` — template content API
- `app/api/policies/apply/route.ts` — apply template API
- `next.config.js` → `outputFileTracingIncludes` — bundles `.md` files with Vercel

**Vercel bundling fix (2026-03-13):** Policy template Markdown files are not
automatically traced by Vercel's bundler when loaded via `fs.readFile` with a
dynamic path. `outputFileTracingIncludes` in `next.config.js` explicitly
includes `./content/policy-templates/**/*.md` for the
`/api/policy-templates/[type]/content` route.

## Help System (EPIC 10)

### Architecture
- Articles are defined in `lib/help/articles.ts` (slug, category, title/body keys, tags); categories in `lib/help/categories.ts`. The array length is the source of truth for the current catalog size.
- Content is rendered via `next-intl` i18n keys — article titles and bodies live in `messages/{locale}.json` (BCP-47) under the `help.articles.{slug}.title` and `help.articles.{slug}.body` namespace.
- All 12 locales must include translations for every article to support the Help Center in all languages.

### Embedded app help (separate and adapted)
- The **Shopify embedded app** (`/app/help`) uses a **separate** help surface so the in-app experience can be adapted for the Shopify Admin context.
- **Data:** `lib/help/embedded.ts` defines which article slugs are available in the app (`EMBEDDED_ARTICLE_SLUGS`), ordered categories, and optional copy overrides. Portal-only articles (e.g. `template-setup-wizard`) are excluded from the embedded list. The slug `shopify-app-store-install` explains installing from the Shopify App Store vs website flows (merchant help for distribution).
- **Copy:** Embedded UI strings (title, search, backToHelp, etc.) and selected article bodies use the `help.embedded` i18n namespace in `messages/{locale}.json`. Where `EMBEDDED_ARTICLE_COPY_OVERRIDES` is set, titles and bodies are taken from `help.embedded.articles.{slug}.title` / `.body`; otherwise the shared `help.articles.*` keys are used. All six regional locales (`en-US`, `de-DE`, `es-ES`, `fr-FR`, `pt-BR`, `sv-SE`) have fully translated UI strings and article overrides for `connectShopifyStore`, `shopifyAppStoreInstall`, `understandingDashboard`, and `afterSaving`.
- **Dashboard help card:** The embedded dashboard page (`/app/page.tsx`) renders a `DashboardHelpCard` at the bottom of the layout. It links directly to the `understanding-dashboard` help article. Strings live under `dashboard.helpCardTitle`, `dashboard.helpCardDesc`, `dashboard.helpCardLink` in all locale files.
- **Portal** (`/portal/help`) continues to use the full `HELP_ARTICLES` and `HELP_CATEGORIES` with the shared `help.*` namespace (Tailwind UI).

### Search
- Client-side filtering by article title and tags. No backend API required.

### Adding an Article
1. Add the article object to `HELP_ARTICLES` in `lib/help/articles.ts` (slug, category, title/body keys, tags).
2. Add the corresponding `help.articles.{slug}.title` and `help.articles.{slug}.body` keys to all `messages/{locale}.json` files (BCP-47 filenames).
3. **Portal** will show it automatically. For **embedded app**: add the slug to `EMBEDDED_ARTICLE_SLUGS` in `lib/help/embedded.ts`; optionally add `help.embedded.articles.{slug}.title` and `.body` in messages for in-app–specific copy.

### Interactive Help Guides

In addition to static articles, DisputeDesk offers interactive guided tours
that walk merchants through key features with step-by-step overlays.

| Module | Path | Purpose |
|--------|------|---------|
| Guide Config | `lib/help-guides-config.ts` | 6 guided tours with step definitions |
| Guide Analytics | `lib/help-guide-analytics.ts` | Tour event tracking |
| Guide Provider | `components/help-guide-provider.tsx` | React context for tour state |
| Tour Overlay | `components/embedded-help-guide-tour.tsx` | Step-by-step overlay UI |
| Floating Button | `components/floating-help-button.tsx` | Quick-access help button |

Guides are launchable from both the embedded and portal help pages via
search-param-driven navigation (`?guide=<guideId>`).

## Autopilot Content Generation (CH-8)

### Architecture

The autopilot system extends the existing AI generation pipeline (CH-7) with automated scheduling, publishing, and notification.

| Component | Path | Purpose |
|-----------|------|---------|
| Settings UI | `app/admin/resources/settings/settings-client.tsx` | Autopilot toggle, articles/day, email config; **Run scheduled tasks now** → manual autopilot with **Articles this run** (`limit` query) |
| Pipeline | `lib/resources/generation/pipeline.ts` | `PipelineOptions.autopilot` — enqueue + in-process publish; `autopilotDrainBacklog` (default **true**) controls whether **`drainPublishQueueAfterAutopilotEnqueue`** runs after the new article. **Cron** keeps default (**true**). **Manual admin** (`bypassRateLimit`) passes **false** so only that run’s article locales publish in-request; backlog waits for `/api/cron/publish-content`. |
| Publish prerequisites | `lib/resources/generation/publishPrerequisites.ts` | Ensures author, primary CTA, ≥3 tags so `publishLocalization` succeeds |
| Manual admin POST | `app/api/admin/resources/cron/autopilot/route.ts` | `executeAutopilotTick({ bypassRateLimit: true, overrideCount })`; query **`limit`** (1–50, default **1**). `maxDuration` **300s**. |
| Backlog targeted autopilot | `app/api/admin/resources/generate-autopilot/route.ts` | `runGenerationPipeline(archiveItemId, { autopilot: true, autopilotDrainBacklog: false })` for one chosen row; requires **`autopilotEnabled`** in CMS settings. `maxDuration` **300s**. |
| Publish queue tick | `lib/resources/cron/publishQueueTick.ts` | After autopilot enqueue, **`publishQueuedRowsForLocalizationIds`** always claims the new article’s rows first. **`drainPublishQueueAfterAutopilotEnqueue`** (bounded FIFO: `claimLimit` 80 × 10) runs **only when** `PipelineOptions.autopilotDrainBacklog !== false` (scheduled cron). Manual admin autopilot skips that drain. Cron/manual “publish queue” route still uses default claim **20**. FIFO claim uses select-then-update (see publish-queue bullet above). |
| Daily Cron | `app/api/cron/autopilot-generate/route.ts` | Same tick **without** bypass; respects `autopilotArticlesPerDay` / burst. `maxDuration` **300s**. Picks eligible archive rows by **`backlog_rank` ASC**, then **`priority_score` DESC** (`backlog` / `brief_ready`, not linked). If a run fails, the tick continues to the **next** row (capped) so one broken or stuck top item does not block the rest of the queue forever. |
| Publish Cron | `app/api/cron/publish-content/route.ts` | Drains `content_publish_queue`, sends autopilot email after successful publish |
| Publish Email | `lib/email/sendPublishNotification.ts` | Resend-based email with article link |

**Settings** are stored in `cms_settings.settings_json` (existing pattern). New fields: `autopilotEnabled`, `autopilotArticlesPerDay`, `autopilotNotifyEmail`, `autopilotStartedAt`, and `defaultCta` (e.g. `free_trial` — matches `content_ctas.event_name`).

**Publish prerequisites (generation):** Before inserting `content_items`, `ensurePublishPrerequisites()` loads or creates default `authors`, `content_tags` (three stable keys: `chargebacks`, `shopify`, `merchant-resources`), and resolves **primary CTA**: prefers `content_ctas` where `event_name` equals **Settings → Default CTA** (`defaultCta`), otherwise first CTA row, otherwise a generic external CTA. Migration `20260328123100_seed_hub_content_ctas_presets.sql` seeds preset CTAs (`free_trial`, `demo_request`, `newsletter`, `download`) so the admin dropdown resolves to real rows.

**5-day burst:** When autopilot is first enabled, `autopilotStartedAt` is recorded. The cron checks how many articles have been auto-published since that timestamp. If fewer than 5, it generates 1/day until the burst is complete.

**Pipeline autopilot flag:** When `options.autopilot = true`, the pipeline creates new `content_items` with `workflow_status = "scheduled"` (not `published`), enqueues each localization on `content_publish_queue` with `scheduled_for = now()`, then **`publishQueuedRowsForLocalizationIds`** in-process for those locales. When `autopilotDrainBacklog` is true (default; scheduled autopilot cron), it also runs **`drainPublishQueueAfterAutopilotEnqueue`** to clear other due backlog rows. When **false** (manual admin “Run autopilot now”), only the generated article’s queue rows are processed in that request. A row becomes truly published only when `publishLocalization` succeeds and sets `content_localizations.is_published` and `content_items.published_at`. For historical rows already stuck in a false-published state, use `POST /api/admin/resources/publish-repair` from Settings and retry failed queue rows from Queue.

**Publish notification email:** After each successful queue row, `executePublishQueueTick` calls `sendPublishNotification` **only for `locale === "en-US"`** when `cms_settings.settings_json.autopilotNotifyEmail` is non-empty (trimmed) and the localization has `title` and `slug`. One email per article — non-English locale rows are intentionally skipped so the recipient receives a single notification with the canonical English URL. The same `locale === "en-US"` guard applies in `repairStuckPublishedWorkflow` (`lib/resources/publish.ts`). **Live-state re-verification:** before sending, both callsites re-select the localization with `is_published` plus the parent `content_items.workflow_status` and bail out unless both confirm `published`. `publishLocalization` returning `ok` proves the row was published *at that moment*, but a concurrent delete or un-publish between then and the email send would leave the recipient with a 404 link; the post-hoc check makes that impossible. There is **no default recipient in application code** — operators must enter an address under **Admin → Resources → Settings → AI Autopilot → Notification email** and let settings auto-save. Production needs `RESEND_API_KEY` (and optional `EMAIL_FROM`); without Resend, the helper returns failure and the tick logs it. If publish never ran (queue stuck or failed), no email is sent. HTML body escapes the article title for safe interpolation.

### Cron Schedule

In `vercel.json`:
```json
{ "path": "/api/cron/autopilot-generate", "schedule": "0 8 * * *" },
{ "path": "/api/cron/publish-content", "schedule": "0 9 * * *" }
```
- **08:00 UTC** — autopilot generation (`/api/cron/autopilot-generate`). Requires `CRON_SECRET` (Vercel injects `Authorization: Bearer` when the env var is set).
- **09:00 UTC** — publish queue + email (`/api/cron/publish-content`). Same secret.

**Manual test (cron):** `GET` or `POST` the route with header `Authorization: Bearer <CRON_SECRET>` (or `x-cron-secret: <CRON_SECRET>`). Example: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<deployment>/api/cron/autopilot-generate"`.

**Manual test (admin UI / session):** `POST /api/admin/resources/cron/autopilot?limit=1` while signed into admin (same tick as cron but **bypasses daily cap**; `limit` optional, default **1**).

**Manual test (single backlog row):** With admin session cookie, `POST /api/admin/resources/generate-autopilot` with JSON `{ "archiveItemId": "<uuid>" }` — or use **Auto Pilot** on `/admin/resources/backlog`.

## SEO & Search Engine Indexing (CH-8)

**On-page metadata & JSON-LD (marketing):** In addition to sitemap and IndexNow, the **homepage** uses `marketing.seo` strings + WebPage JSON-LD (see § *Marketing URLs and SEO*). The **resources hub index** uses `resources.hubTitle` / `heroSubtitle` / `hubKeywords` + CollectionPage JSON-LD (see § *Resources Hub* → public URLs). Per-article meta comes from the editor (`meta_title`, `meta_description`, …) via `app/[locale]/resources/[pillar]/[slug]/page.tsx` and existing `articleJsonLd` / breadcrumb helpers in `lib/resources/schema/jsonLd.ts`.

### Sitemap

`app/sitemap.ts` (Next.js metadata API) generates a dynamic XML sitemap:
- All published `content_localizations` with `hreflang` alternates per locale.
- Static pages: root, resources, glossary, templates, case studies.
- Locale URL prefixes: en-US = root, de-DE = `/de`, fr-FR = `/fr`, es-ES = `/es`, pt-BR = `/pt`, sv-SE = `/sv`.
- Prefixed locale home uses the bare prefix (e.g. `/sv`, not `/sv/`) — trailing slash 308-redirects would make Google flag sitemap entries as "Page with redirect" in GSC.

**hreflang is sitemap-only:** `i18n/routing.ts` sets `alternateLinks: false` so next-intl does NOT emit a `Link: rel=alternate; hreflang=…` response header. The middleware-generated alternates assume path-identical slugs across locales, but Resources Hub articles use per-locale slugs (DE slug differs from ES slug). Emitting path-identical alternates would advertise URLs that 308-redirect. The sitemap's per-article `alternates.languages` map — built from each locale's own `content_localizations.slug` — is the single source of truth for hreflang.

### Robots.txt

`app/robots.ts` serves a robots.txt that allows all crawlers on public routes and disallows `/admin/`, `/api/`, `/app/`, `/portal/`, `/auth/`.

### IndexNow

`lib/seo/indexnow.ts` implements:
- **IndexNow API call** (`POST https://api.indexnow.org/indexnow`) — instant indexing on Bing, Yandex, Seznam, Naver. Non-OK HTTP responses are logged; network errors are logged in `catch`.
- **Key verification:** `keyLocation` points to `https://{host}/{INDEXNOW_KEY}.txt`; the key file is served from `public/{INDEXNOW_KEY}.txt` at the site root.
- **Canonical site origin:** article URLs and IndexNow `host` use `getPublicSiteBaseUrl()` from `lib/email/publicSiteUrl.ts` (same resolution as `app/robots.ts` and `app/sitemap.ts`: `NEXT_PUBLIC_APP_URL`, then `PUBLIC_CANONICAL_URL`, else `https://disputedesk.app`).

Called from the publish cron (`app/api/cron/publish-content/route.ts`) via `notifySearchEngines(slug, locale, routeKind, pillar)` after each successful publish. Article URLs include the resources pillar segment when applicable. Non-blocking — failures are logged but don't affect publish status.

**Required env:** `INDEXNOW_KEY` (random 8-128 char string).

## In-Admin Help Section (CH-8)

### Architecture

| Component | Path | Purpose |
|-----------|------|---------|
| Server Page | `app/admin/help/page.tsx` | Auth check, renders `HelpClient` |
| Client Component | `app/admin/help/help-client.tsx` | Full help content with sticky header (filter + horizontal section pills) |

The help page renders the same content as `docs/admin-guide.md` as React components with:
- Sticky doc header: title, section filter input, horizontal scrollable pills (13 sections with icons).
- `IntersectionObserver`-based scroll-spy to highlight the active section; section anchors use `scroll-mt-*` so headings clear the sticky bar.
- Sections: Login, Dashboard, Shops, Jobs, Billing, Audit, Resources Hub, Editor, AI Generator, Autopilot, SEO, Settings, Workflow Reference.

**Navigation:** "Help" is in both `ADMIN_NAV` and `RESOURCES_NAV` in `app/admin/layout.tsx` so the guide stays reachable from the main admin shell and while editing in the Resources Hub; `/admin/help` itself uses the top-level Admin nav. Contextual links: Backlog → AI Generator section, Settings (Autopilot) → Autopilot section, `AIAssistantPanel` → Editor section (`#help-editor`).

### Embedded App UX Rewrite — Coverage/Automation/Playbooks Model (2026-04-08)

The embedded app was rewritten to shift the merchant-facing model from packs/rules/manual configuration to coverage/automation/playbooks/activation. Backend remains unchanged — this is a UX-only rewrite.

**New Navigation** (`AppNavSidebar.tsx`):
Dashboard → Disputes → Coverage → Automation → Playbooks → Billing → Settings → Help

- `/app/coverage` — **NEW** page showing dispute family coverage (8 families), automation mode per family, and recommended actions. Uses `lib/coverage/deriveCoverage.ts` to project existing rules + active packs into a coverage view.
- `/app/rules` — route preserved, nav label and page title now say "Automation"
- `/app/packs` — route preserved, nav label and page title now say "Playbooks"
- `/app/analytics` — removed from nav (page still accessible via direct URL)

**Dashboard** (`app/(embedded)/app/page.tsx`):
- `AutomationStatusCard` replaced with `ProtectionStatusCard` — shows coverage summary, families covered/automated, links to `/app/coverage`
- KPI card "Evidence Packs" relabeled to "Active Playbooks"
- Primary action changed from "Automation Settings" to "View Coverage"

**Pack Detail** (`app/(embedded)/app/packs/[packId]/page.tsx`):
- Dual-mode display based on `dispute_id`: library packs show as read-only template previews, dispute-linked packs show as editable evidence packs
- Back link: Playbooks → `/app/packs`, Evidence → `/app/disputes/{id}`
- **Template localization for library pack previews (2026-04-11):** Migration `20260411130000_pack_template_localization.sql` adds two per-locale override tables — `pack_template_section_i18n (template_section_id, locale, title)` and `pack_template_item_i18n (template_item_id, locale, label, guidance)` — and seeds Portuguese (`pt-BR`) translations for all 10 global templates' names, section titles, item labels, and guidance text. Other locales (`de-DE`, `es-ES`, `fr-FR`, `sv-SE`) fall back to `title_default` / `label_default` / `guidance_default` until translated in a follow-up. `app/api/packs/[packId]/route.ts` now accepts a `?locale=xx` query param and uses it two ways: (1) `fetchTemplateItems` reads directly from `pack_template_sections` + `pack_template_items` (joining the new i18n tables) when the library pack has a `template_id` — the previous path that read from the merchant's copied `pack_sections` / `pack_section_items` had English strings baked in at install time. (2) A new `resolveTemplateName(db, templateId, locale)` helper replaces the hardcoded `locale === 'en-US'` lookup in `pack_template_i18n` with a locale → en-US → first-row fallback chain. The embedded pack detail page (`app/(embedded)/app/packs/[packId]/page.tsx`) imports `useLocale` from next-intl and passes the merchant's active locale as `?locale=${locale}` on every `/api/packs/:id` fetch. For library packs without a `template_id` (legacy hand-rolled packs), `fetchTemplateItems` still falls back to the merchant's copied `pack_sections` rows — those stay in whatever language was copied at install time. Locale parameter extraction uses optional chaining (`req?.nextUrl?.searchParams?.get(...)`) so the existing `tests/api/packs/packDetailRoute.test.ts` mock (which passes `{}` as the request) keeps working. One known gap: the status badge in the metadata grid still renders raw DB values (`ready`, `saved_to_shopify`, etc.) via `pack.status.replace(/_/g, " ")` — tracked as a follow-up.
- **Customer-communication auto-collection (2026-04-11 commit 3 of Option C):** `lib/packs/sources/customerCommSource.ts` is a new collector that pulls customer-communication evidence from the order and customer records instead of requiring the merchant to upload it. It extracts `Order.note` (merchant staff notes), `Order.customAttributes` (buyer-provided attributes at checkout such as "please leave at door"), `Order.events(first: 30)` (the order timeline including system-sent confirmation emails and merchant timeline comments), and `Customer.note` (staff notes on the customer record). Events are classified into `customer_confirmation_email` / `merchant_comment` / `system` based on keyword matching and the `attributeToUser` flag so the payload carries a summary like "3 confirmation emails sent, 2 merchant comments, 1 buyer attribute". When at least one signal has content the collector emits a single `EvidenceSection { type: "comms", source: "shopify_timeline", fieldsProvided: ["customer_communication"] }`; otherwise it returns `[]` so a manual upload can still satisfy the field. `ORDER_DETAIL_QUERY` in `lib/shopify/queries/orders.ts` was extended with `note`, `customAttributes { key value }`, `events(first: 30) { edges { node { id message createdAt attributeToUser attributeToApp criticalAlert } } }`, and `customer { note }`, with corresponding TypeScript types (`OrderCustomAttribute`, `OrderEventNode`). `collectCustomerCommEvidence` is added to the concurrent collector list in `lib/packs/buildPack.ts`. Runtime scopes are unchanged — `read_orders` already covered all four signals. Shopify Inbox message history is intentionally **not** integrated: the Inbox product runs on a separate API surface that standard Admin OAuth scopes can't reach, and any future integration would need a per-shop helpdesk connection (Front / Zendesk / Gorgias) rather than a Shopify-side API.
- **Completeness engine wired to admin template items (2026-04-11 commit 2 of Option C):** `pack_template_items` gains a nullable `collector_key` column (migration `20260411120000_pack_template_items_collector_key.sql`) that points each admin-defined item at a collector field emitted by `lib/packs/sources/*` — or `NULL` for merchant-supplied items that only a manual upload can satisfy. The migration backfills all existing seed rows by keyword (e.g. `tracking_proof` / `tracking_number` / `carrier_confirmation` / `partial_tracking` / `shipping_receipt` → `shipping_tracking`; `delivery_signature` / `delivery_photo` / `delivery_address_match` / `delivery_confirmation` → `delivery_proof`; `billing_shipping_match` / `billing_history` → `billing_address_match`; `customer_emails` / `customer_account_info` → `customer_communication`; `payment_receipt` / `invoice_receipts` / `order_itemization` / etc. → `order_confirmation`). `evaluateCompleteness(reason, presentFields, templateItems?)` in `lib/automation/completeness.ts` now takes an optional `TemplateChecklistItem[]` array; when present, it takes precedence over the hardcoded `REASON_TEMPLATES` fallback — items whose `collector_key` is set are matched against `presentFields` directly, items with `collector_key === null` are treated as satisfied by any manual upload (`MANUAL_UPLOAD_FIELD` = `supporting_documents`). `lib/packs/buildPack.ts` now reads `evidence_packs.pack_template_id` and, when set, loads `pack_template_sections` + nested `pack_template_items` for that template and passes them to `evaluateCompleteness`. Packs without a matching template continue to fall back to `REASON_TEMPLATES` so the runtime remains compatible with the existing automation rules. Net effect: admin edits to `pack_template_items` via `app/admin/templates/[id]/page.tsx` now have real runtime impact — adding a required item with a known `collector_key` increases the bar for completeness, flipping it to `null` lets any manual upload satisfy it, and renaming / reordering items updates what the merchant sees on dispute-linked packs.
- **Library pack read-only preview (2026-04-11 commit 1 of Option C):** when `dispute_id == null`, the work card renders a template preview built from real `pack_sections` + `pack_section_items` rows instead of the prior hardcoded `SUGGESTED_EVIDENCE_KEYS` fallback. The API route (`app/api/packs/[packId]/route.ts`) now returns a `template_items` array (shape: `{ section_title, key, label, required, guidance, item_type }`) for library packs — both the `evidence_packs` branch and the legacy `packs`-fallback branch call a new shared `fetchTemplateItems(db, packId)` helper. The embedded page groups these by `section_title`, shows each item with a required/optional badge and a collector-source hint (`getFieldSource(key)` → `shopify_order` / `shopify_shipping` / `store_policy` / `merchant_upload`, labelled via new `packs.sourceShopifyOrder` / `sourceShopifyShipping` / `sourceStorePolicy` / `sourceMerchantUpload` keys), and renders each item's `guidance` as subdued helper text. The DropZone, ProgressBar, save-to-Shopify primary action, save-blocked / save-failed / building banners, blockers list, and collected-evidence list are all hidden on library packs — they were dead-end UI (library packs have no dispute, no completeness engine run, no save target). New `packs.templatePreviewTitle` / `templatePreviewBody` / `templatePreviewFooter` / `templateItemsEmpty` / `requiredBadge` / `optionalBadge` keys added to all 12 locale files. The `SUGGESTED_EVIDENCE_KEYS` constant was deleted from the embedded page; the underlying `packs.suggested*` i18n keys are preserved because the portal pack detail page still uses them.
- **Four-section layout (2026-04-11 overhaul):** the prior 15-section stack (narrative hero + phase-context banner + template-continuity card + recommended-evidence + readiness + five numbered Step cards + evidence list + "when template used" card + status banner + audit log + compliance banner) was collapsed into (1) a **status hero** Card — readiness %, state sentence via `getPackStateKey` → one of `stateReadyHint` / `stateBlockedHint` / `stateSavedHint` / `stateInProgressHint` / `stateLibraryHint`, inline blockers list, save-blocked / save-failed / building banners, and a two-column metadata grid (Type, Phase with inline phase hint, Status, Created, Saved-to-Shopify with Open-in-Shopify link, Template); (2) a **work Card** with stacked Evidence needed / Upload / Collected evidence subsections; (3) a default-collapsed **activity log** Card that maps `audit_events[].event_type` through `EVENT_TYPE_KEYS` to merchant-readable labels (`packs.eventPackCreated` etc.) and holds the compliance disclaimer; (4) a **dynamic Page `primaryAction`** that flips between `primaryBrowseTemplates` (library), `openInShopifyAdmin` (saved), `primaryResolveBlockers` (blocked — scrolls to work card via `workCardRef`), and `saveToShopify` (ready / in-progress) — the last still routes through the existing low-completeness warning Modal. Secondary action surfaces PDF export/download/generating state. No API, polling, upload, save-to-Shopify, render-pdf, or download handlers changed. The prior `packs.detailHero*`, `packs.detailWorkflow*`, `packs.step1*` / `step2*` / `step3*` / `stepOptionalPdf*`, `packs.whenTemplateUsed*`, `packs.inquiryContext` / `chargebackContext`, and related narrative keys were removed from all 12 locale files.

**Coverage Derivation** (`lib/coverage/deriveCoverage.ts`):
Pure utility that maps existing rules + active packs to 8 dispute families. Each family gets: `hasCoverage`, `automationMode` (automated/review_first/manual/none), `activePackCount`, `matchingRuleId`.

**i18n**: All 12 locale files updated with `nav.coverage`, `nav.automation`, `nav.playbooks` keys and full `coverage.*` namespace. Merchant-facing text updated across `dashboard`, `packTemplates`, `packs`, `rules`, `settings`, `help`, `billing` namespaces to use "playbook" and "automation" instead of "pack" and "rule" where appropriate.

### Dispute Lifecycle Phases (2026-04-09)

The `disputes` table has a `phase` column (text, nullable) with values `"inquiry"`, `"chargeback"`, or `NULL` (unknown/legacy rows). Phase is synced from Shopify's `ShopifyPaymentsDispute.type` field during dispute sync.

**API changes:**
- `GET /api/disputes` — accepts optional `?phase=inquiry|chargeback` query filter.
- `GET /api/disputes/:id` — response now includes `family` (from `DISPUTE_REASON_FAMILIES`) and `handling_mode` (`automated` | `review` | `manual`).
- `GET /api/dashboard/stats` — response now includes `inquiryCount`, `chargebackCount`, `unknownPhaseCount`, and `needsAttentionCount`.
- `GET /api/templates` — accepts optional `?phase=inquiry|chargeback` for phase-aware template recommendation via `reason_template_mappings`.

**Embedded app UI:**
- **Dashboard:** Lifecycle queue summary showing inquiry / chargeback / needs-attention counts.
- **Disputes list:** New Phase column and phase filter dropdown.
- **Dispute detail:** Phase-aware title (`"Inquiry {id}"` / `"Chargeback {id}"` / `"Case {id}"` for unknown), phase-aware CTA (`"Respond to Inquiry"` / `"Build Evidence"`), and a case metadata bar displaying phase, family, and handling mode.

**Scope note:** Phase A+B delivers lifecycle visibility and sensible defaults. Rules and automation remain phase-blind. Full inquiry workflow parity (distinct inquiry response forms, inquiry-specific auto-build) is planned for a later phase.

### Lifecycle-Aware Control Surfaces — Phase C (2026-04-09)

Phase C extends lifecycle awareness to the control surfaces: Coverage, Automation, and Playbooks.

**New API:**
- `GET /api/reason-mappings?phase=inquiry|chargeback` — returns `reason_template_mappings` data for the embedded app (wraps `listReasonMappings()`).

**New utility:**
- `lib/coverage/deriveLifecycleCoverage.ts` — extends flat family coverage to per-phase handling. For each family, shows inquiry + chargeback handling separately: automation mode, mapped template, active playbooks, gaps/warnings.

**Coverage page** (`app/(embedded)/app/coverage/page.tsx`): Rewritten to show per-family, per-phase handling. Each family card has Inquiry and Chargeback rows showing automation mode, default template, and gap warnings. Top of page answers three questions in merchant language: purpose (page subtitle `coverage.coveragePurpose`), current state (plain-language sentence — `coverage.stateAllSetup` / `coverage.stateWithGaps` / `coverage.stateNoSetup` — plus fully-configured and gap badges), and next action (page `primaryAction` dynamically labelled `coverage.primaryFixGap` targeting the first unconfigured family in `DISPUTE_FAMILIES` order; routes to `/app/packs` if that family has no playbooks installed, otherwise `/app/rules`; falls back to `coverage.primaryReviewRules` when fully covered). Secondary action is "Browse playbooks".

**Interactive tour rebuild (2026-04-30):** the embedded interactive-tour system is rebuilt from a centered Polaris `Modal` stub into a full-fidelity overlay. New file [components/help/EmbeddedTourOverlay.tsx](components/help/EmbeddedTourOverlay.tsx) renders a fixed full-viewport overlay (sibling of `children` in [app/(embedded)/providers.tsx](app/(embedded)/providers.tsx) so it survives client-side navigations between steps): an SVG-mask spotlight with rounded-rect cutout in a 55% black backdrop, a pulsing blue ring around the target (3px solid `#1D4ED8` + double-layer box-shadow), and a position-aware tooltip card that auto-flips between `top/bottom/left/right` based on viewport room, with viewport clamping at 16px margins. Targets are resolved via `document.querySelector` wrapped in a `MutationObserver` that polls until the selector appears (max 2.5s) so route transitions don't race spotlight rendering — fixes the timing bug that broke the previous portal tour at hop boundaries. Resize and scroll listeners recompute the rect. Esc and clicking the dim layer both close the tour. Step progress dots render in three states: current = blue 22-px wide bar, completed = green 6-px dot, future = grey 6-px dot.

**Tour chaining (2026-04-30):** [components/help/help-guide-provider.tsx](components/help/help-guide-provider.tsx) extends from a single `activeGuideId` to a queue model. New API: `startGuide(id, { withChain: true })` queues the remaining tours after `id` from the canonical chain `review-dispute → build-pack → automation-rules → install-template → configure-policies`. New `startTourChain(firstId?)` queues all five from the start. New `finishActiveGuide()` (called by the overlay on the last step) surfaces a "completion prompt" state — the overlay swaps to a centered card showing "Finished: {title}" plus a "Continue with {next}?" suggestion with `Yes, continue` / `Done for now` buttons. `acceptNextInChain()` pops the queue and starts the next tour; `declineNextInChain()` clears the queue and closes. When the queue is empty (last in chain), the prompt becomes "🎉 You completed every tour" with a single Done button. Quick Action cards on `/app/help` use `withChain: true` so a merchant who clicks one card can ride the chain forward; a new "Take the full product tour" gradient banner above the Quick Actions calls `startTourChain()` to play all five back-to-back from the canonical start.

**Tour step targeting (2026-04-30):** [lib/help-guides-config.ts](lib/help-guides-config.ts) `EMBEDDED_GUIDE_STEPS` now uses real selectors with `spotlight: true`. Step IDs reuse the portal naming (`intro`, `disputesTable`, `disputeRow`, `packsGrid`, `createPackBtn`, `templateBtn`, `rulesHeader`, `rulesList`, `createRuleBtn`, `addPolicyBtn`, `policyDocuments`, `packRow`) so existing `help.guides.{guideId}.{stepId}Title/Desc` i18n resolves with no new translation work. Targets are a mix of new `data-help-guide="…"` attributes on embedded pages (`disputes-table`, `dispute-row` on first row, `packs-grid`, `rules-list`, `policy-documents`) and Polaris-class anchors (`.Polaris-Page-Header`) for actions that live in the page header chrome (Polaris doesn't expose `data-*` attributes on `Page.primaryAction` / `secondaryActions`). Intro steps remain centered with no spotlight.

**Handle a Dispute deep-rewrite (2026-04-30 follow-up):** the `review-dispute` guide goes from a 3-step list-only spotlight to a 12-step end-to-end walkthrough across three pages (dashboard → list → detail). [lib/onboarding-config.ts](lib/onboarding-config.ts) extends the `OnboardingStep` shape with an optional `onNext: { type: "click", selector } | { type: "navigateToFirstDispute" }` action that fires when the merchant clicks Next, before `stepIdx` advances. The overlay's `handleNext` runs the action then waits 200–300ms (next animation frame + buffer) so the just-clicked tab content renders before the new spotlight target is queried. `navigateToFirstDispute` reads `window.__ddFirstDisputeId`, a tiny client-side global published by [app/(embedded)/app/disputes/page.tsx](app/(embedded)/app/disputes/page.tsx) every time `disputes` state changes — when the global is missing (no disputes synced) the overlay surfaces a centered "No disputes yet" empty-state card with `Continue` (skip to chain prompt) and `Done for now` (close) buttons. Steps 7-12 use `route: ""` so the route effect skips navigation and the overlay stays on the dynamic `/app/disputes/{id}` route opened by step 6's onNext action. New `data-help-guide` selectors added: `dashboard-attention-banner`, `disputes-kpi-row`, `disputes-urgent-banner`, `detail-header`, `detail-tab-overview`, `detail-tab-evidence`, `detail-tab-submit`, `detail-overview-hero`, `detail-overview-evidence`, `detail-submit-button`. New i18n keys: 11 `help.guides.reviewDispute.{stepId}Title/Desc` pairs (welcome / dashboardAttention / disputesKpis / disputesUrgentBanner / disputeRow / detailHeader / detailOverviewHero / detailOverviewEvidence / detailEvidenceTab / detailReviewTab / detailSubmitButton) plus `help.embedded.noDisputesYetTitle/Desc`. English fallback in all 12 locale files.

**Help page Figma redesign + content audit (2026-04-30):** the embedded `/app/help` page is rewritten to match the Figma `pages/help-center.tsx` layout while keeping the existing data wiring (`getEmbeddedArticles()` / `getEmbeddedCategories()` / `getArticlesByCategoryForEmbedded()` from [lib/help/embedded.ts](lib/help/embedded.ts) and the search filter over title + tags). The new page sits inside the same Polaris `<Page>` chrome as the rest of the embedded redesign and assembles eight inline-styled sections: (1) blue gradient hero (`linear-gradient(135deg,#3B82F6→#60A5FA→#93C5FD)`) with title, tagline, and a translucent search input; (2) Quick Tasks 4-card grid that wraps `helpGuide.startGuide()` from `useHelpGuideSafe()` — only renders when the `HelpGuideProvider` is mounted; (3) Interactive Tours grid driven by the existing `HELP_GUIDE_IDS` (recommended badge for the top 4 — `build-pack`, `install-template`, `review-dispute`, `automation-rules`); (4) Browse by Topic colored category grid (8 categories, each with a hex tint from `CATEGORY_COLORS` matching the family-icon colors used elsewhere) — anchor links scroll to the matching `id={cat.slug}` block in the Documentation section; (5) Documentation accordion: per-category Card with collapsible per-article rows, body rendered inline via `t(getEmbeddedArticleBodyKey(article))`, a "Was this helpful?" 👍/👎 row that fires a Polaris `Toast` (no analytics backend yet); (6) Popular Articles list backed by a hand-curated [lib/help/popular.ts](lib/help/popular.ts) with 5 entries (`how-packs-built`, `evidence-strength-rubric`, `evidence-pack-templates`, `rule-priority`, `completeness-score`); (7) three Resource cards (Contact Support `mailto:`, Best Practices → `/app/help/pack-best-practices`, API Documentation → portal in a new tab via `external: true`); (8) green status pill `{ statusOperational, statusLastChecked }`. Search results override sections (2)-(8) and render a flat list, same as before.

**Help content additions (2026-04-30):** promoted **Policies** to its own embedded help category (between `automation-rules` and `billing` in [lib/help/categories.ts](lib/help/categories.ts)) and added 5 new articles to [lib/help/articles.ts](lib/help/articles.ts): `pack-variables`, `pack-best-practices` under `evidence-packs`; `defining-store-policies` (moved from `evidence-packs`), `policy-types-explained`, `policy-variables`, `policy-best-practices` under the new `policies` category. [lib/help/embedded.ts](lib/help/embedded.ts) `EMBEDDED_ARTICLE_SLUGS` reorders the policies block between automation and billing. All 12 locale files (`en`/`en-US`, `de`/`de-DE`, `es`/`es-ES`, `fr`/`fr-FR`, `pt`/`pt-BR`, `sv`/`sv-SE`) now report parity at 43 articles each — 38 existing + 5 new, with previously-lagged keys (`evidenceStrengthRubric`, `templateSetupWizard`, `storeSessionUpgrade`, `understandingInquiries`, `understandingChargebacks`, `lifecycleOverview`) backfilled from the `en.json` master where translations were missing. Locale variants now report identical key trees. Chrome keys added under `help.embedded.*`: `heroSearchPlaceholder`, `heroTagline`, `quickTasksTitle`, `interactiveToursTitle`, `interactiveToursDesc`, `browseByTopicTitle`, `documentationTitle`, `popularArticlesTitle`, `recommendedBadge`, `wasHelpful`, `feedbackYes/No/Thanks`, `viewsCount`, `helpfulCount`, `resourceContactSupport/Desc/Cta`, `resourceBestPractices/Desc/Cta`, `resourceApiDocs/Desc/Cta`, `statusOperational`, `statusLastChecked`, `quickTaskCreatePack/InstallTemplate/HandleDispute/CreateRule/InteractiveGuide`. Each existing guide ID also gets a `help.guides.{guideId}.duration` ("3 min", "5 min", etc.) used in the tour cards. The `help.categories.policies` + `policiesDesc` keys are added in all 6 languages. The `/app/help/[slug]` detail route is unchanged and serves the new slugs without any code change. Stub features (popular counts, status pill, feedback buttons) all use hardcoded data — no new API routes.

**Playbooks page Figma chrome alignment (2026-04-30):** the embedded `/app/packs` page kept its existing CRUD surface (search + status tabs + IndexTable + row actions + create modal + template install modal) but gained the same dismissable "What you're looking at" explainer banner (`#EBF5FA` bg, `#B4E1FA` border, plain `InfoIcon` + `XIcon`) used by coverage and automation. Banner state is persisted in `localStorage` under `dd_packs_explainer_dismissed`. New i18n keys added to all 12 locale files under `packTemplates.*`: `explainerTitle`, `explainerBullet1` (what playbooks are), `explainerBullet2` (how they're wired to automation rules), `explainerBullet3` (how to use Start-from-template vs Create-pack). The pre-existing `embeddedPacksInfoBanner` (Browse-templates link) below the state card is unchanged. No data wiring, API, or modal flow changes — pure visual continuity with the rest of the embedded redesign.

**Automation page custom-rule modal (2026-04-30 follow-up):** the "Add custom rule" `Page.primaryAction` and the per-row "Edit" buttons in the Advanced custom rules list now open a co-located `CustomRuleModal` (in `app/(embedded)/app/rules/CustomRuleModal.tsx`) instead of redirecting to the portal `/portal/rules`. The merchant stays in Shopify Admin — earlier behaviour redirected to `disputedesk.app/portal/rules`, which the embedded iframe refused to load (CSP). Modal fields mirror the portal form 1:1 (name, reason multi-select, min/max amount, mode auto|review) and POST to `/api/rules` (create, validated by `ruleCreateSchema`) or PATCH `/api/rules/:id` (edit, validated by `ruleUpdateSchema`); the Edit modal also exposes a destructive `Delete` secondary action that hits DELETE `/api/rules/:id`. New rules sort below the catch-all (`max(existing.priority) + 1`, starting at 100001) so baseline / safeguard rules continue to win first. After save/delete the modal closes and the page re-runs `fetchAll()` to refresh the custom-rules list and counts.

**Automation page Figma redesign (2026-04-30):** the per-family card retains the same data wiring (`/api/setup/automation` → `pack_modes`, plus `/api/rules` for safeguard + custom rules) but switches from a Polaris `Select` per row to a Figma-matched **segmented mode toggle** (Review / Automatic) with explicit blue (`#0EA5E9`) and green (`#22C55E`) active fills. Adds a dismissible "What you're looking at" explainer banner (same chrome as the coverage page — `#EBF5FA` bg, `#B4E1FA` border, plain `InfoIcon` + `XIcon`, dismissed via `dd_automation_explainer_dismissed` localStorage key). The status summary card now uses the simpler Figma copy (`rules.figmaSummary`) plus two custom pill spans — green `{auto} Automatic`, blue `{review} Review before submit` — instead of the longer plural-form `stateAllAuto / stateMostlyAuto / stateWithGaps / stateNoSetup` sentence. The automation rules `Card` becomes `padding="0"` with three internal sections: a header strip (title + subtitle), the per-family rows (each row: 40-px family icon square in `FAMILY_ICON_COLOR`, family label + Using-X subtitle, segmented toggle on the right; Install playbook button replaces the toggle when no playbooks are installed), and a gray (`#F6F8FB`) bottom toolbar with `Automate all` / `Review all` quick buttons on the left and a primary `Save {count} rules` (or fallback `Save starter rules`) on the right. The `firstMatchWinsHint` sits below the toolbar in a separate gray strip. Safeguards card and the read-only Custom advanced rules list remain functionally identical, with custom rules now separated by `borderTop` instead of Polaris `<Divider>` for visual consistency. New i18n keys added to all 12 locale files under `rules.*`: `figmaSummary`, `saveNRules`, `modeReviewShort`, `modeAutomaticShort`, `explainerTitle`, `explainerBullet1`, `explainerBullet2`, `explainerBullet3`. Save flow, `pack_modes` payload, safeguard `__dd_safeguard__:high_value` rule shape, and the deep-link scroll-to-family behavior (`?family=fraud` from coverage page) are all preserved.

**Coverage / Automation Current Mode parity fix (2026-05-02):** `ruleMatchesFamily` in [lib/coverage/deriveLifecycleCoverage.ts](lib/coverage/deriveLifecycleCoverage.ts) and [lib/coverage/deriveCoverage.ts](lib/coverage/deriveCoverage.ts) now requires an explicit `match.reason` overlap with the family's reasons — rules with no `match.reason` (safeguard rule `__dd_safeguard__:high_value`, the setup fallback `__dd_setup__:fallback:default`, custom global rules) are no longer treated as the family's defining rule. Previously the safeguard rule (priority 5, `match.amount_range` only, `mode: "review"`) won `pickRuleForFamilyAndPhase` for every family because the original "catch-all rule matches every family" branch in `ruleMatchesFamily` returned `true` for any rule without a reason filter. This made the Coverage page's Current Mode column display "Review before submit" for families whose pack-specific rule was actually `mode: "auto"` — diverging from the Automation page (which only reads `__dd_setup__:pack:{id}` rules via `parsePackModesFromRules`). The two pages now agree because Coverage skips the same non-family-handling rule classes the Automation page already skipped. Safeguard and fallback rules still apply at dispatch time inside the rule engine — only the per-family Current Mode display is corrected.

**Coverage page Figma redesign (2026-04-30):** the per-family card stack collapses into a single Figma-matched table — one row per dispute family with Dispute Type / Chargeback Handling / Inquiry Handling / Current Mode / Action columns. Live data wiring is unchanged (`/api/rules`, `/api/packs`, `/api/reason-mappings` → `deriveLifecycleCoverage`); a new view-model layer in `app/(embedded)/app/coverage/coverageHelpers.ts` derives per-row pill states (`chargebackStatus` ∈ `configured` | `missing-playbook` | `needs-rule`; `inquiryStatus` ∈ `enabled` | `disabled`; `currentMode` ∈ `auto-submit` | `review` | `manual`) from each `LifecyclePhaseHandling`. Desktop renders `CoverageTable.tsx` (HTML table inside a Polaris `Card padding="0"`); mobile (`useBreakpoints().smDown`) renders `MobileCoverageList.tsx` (stacked label/badge cards with a full-width Edit button). The dismissable explainer banner, status sentence + `fullyConfigured` / `gapsFound` badges, and inquiry-coverage card stay above the table — the empty state (`emptyStateTitle` / `emptyStateBody`) and loading spinner branches are unchanged. Page `primaryAction` is the static `primaryReviewRules` (no longer the priority-gap `primaryFixGap`); per-row Edit buttons preserve the `withShopParams("/app/rules?family=" + familyId, …)` deep link. Pill colors are exact Figma hex (configured/auto `#D1FAE5`/`#065F46`, missing-playbook/review `#FEF3C7`/`#92400E`, needs-rule `#FEE2E2`/`#991B1B`, manual/disabled `#E1E3E5`/`#6D7175`); per-family icon tints come from `FAMILY_ICON_COLOR` (fraud red, pnr blue, n.a.d. amber, subscription green, refund purple, duplicate cyan, general grey). New i18n keys added to all 12 locale files under `coverage.*`: `colDisputeType`, `colChargebackHandling`, `colInquiryHandling`, `colCurrentMode`, `colAction`, `handlingConfigured`, `handlingMissingPlaybook`, `handlingNeedsRule`, `inquiryEnabled`, `inquiryDisabled`, `modeAutoSubmit`, `modeReviewLabel`, `modeManualLabel`. The legacy per-phase split UI (and the `PhaseSection` / `LifecycleFamilyCard` helpers) is dropped from the page; `deriveLifecycleCoverage` itself and the per-family rules deep link via Edit are unchanged so the richer per-phase configuration remains accessible from the rules page.

**Automation page** (`app/(embedded)/app/rules/page.tsx`): Single unified list. The page answers the three merchant questions at the top — purpose (subtitle `rules.purposeLine`), current state (priority-ordered sentence `rules.stateNoSetup` / `stateWithGaps` / `stateMostlyAuto` / `stateAllAuto` with automated / review / not-configured badges plus the subdued `rules.phaseBlindNote`), and next action (Page `primaryAction` = `rules.primaryAddCustom` → `/portal/rules`). Below that sits **one** `Card` titled by `rules.automationRulesTitle` / `automationRulesSubtitle` containing every rule the engine evaluates — the four baseline presets (`RULE_PRESETS` from `lib/rules/presets.ts`) and any custom rules — merged into a `UnifiedRow` list sorted by `priority` ascending. Baseline rows render inline with a `Select` for routing (Auto-Pack / Review), a `Baseline` badge, and an `Unsaved` attention badge when the preset has no DB row yet; custom rows render with a `Custom` badge, a `success`/undefined status badge, and an `Edit` button that pushes to `/portal/rules`. Each row also shows the preset description or `matchSummary(match)` and the action label. The card footer holds a subdued `firstMatchWinsHint`, an `Add custom rule` secondary button, and the primary `Save starter rules` button that writes all baseline mode choices in one pass. The previous "two-section" layout (standalone starter workflow card + separate custom rules `BlockStack`) and the "Activated packages" subsection have been removed along with the `EmbeddedStarterRulesWorkflow` component.

**Playbooks list** (`app/(embedded)/app/packs/page.tsx`): Added Family column (derived from `DISPUTE_REASON_FAMILIES`). Top of page answers the three merchant questions: purpose (subtitle `packTemplates.purposeLine` — "Playbooks are the bundles of evidence DisputeDesk uses to respond to each type of dispute"), current state (priority-ordered sentence — `stateNoPlaybooks` → `stateOnlyDrafts` → `stateGaps` → `stateAllCovered` — plus `activeCount` / `draftCount` / `uncoveredCount` badges and a subdued `stateHint` linking to the Automation page), and next action (existing `primaryAction` "Start from template" opens the template library modal; `secondaryActions` "Create Pack" opens the blank-pack modal). Coverage count is computed against `DISPUTE_FAMILIES.length` by bucketing each ACTIVE pack's `dispute_type` via `getPackFamily`.

**Pack detail** (`app/(embedded)/app/packs/[packId]/page.tsx`): For dispute-linked packs, shows dispute phase badge and lifecycle context banner (inquiry vs chargeback framing). API extended to return `dispute_phase` from joined disputes table.

**Scope:** Rules remain phase-blind. Both phases show the same automation mode from rules. Lifecycle differentiation comes from `reason_template_mappings` (per-phase template defaults). Phase-specific rules are a future enhancement.

### Supporting Surfaces Cleanup — Phase D (2026-04-09)

Phase D cleans up Settings, Help, Connect, Session Required, and Analytics for product coherence.

**Settings** (`app/(embedded)/app/settings/page.tsx`): Reordered sections — Notifications before Automation. Automation section labeled as "Advanced defaults" with note pointing to the Automation page for policy configuration.

**Help** (`lib/help/categories.ts`, `lib/help/articles.ts`, `lib/help/embedded.ts`): Added "Inquiry & Chargeback Lifecycle" category with 3 new articles: Understanding Inquiries, Understanding Chargebacks, Lifecycle Overview. Updated category descriptions and guide titles to reflect lifecycle model. Category "Disputes" renamed to "Inquiries & Chargebacks" in descriptions.

**Connect** (`app/(embedded)/app/connect/page.tsx`): Reframed as "Connection Readiness" with lifecycle-aware copy. Added readiness note about inquiry/chargeback coverage activation.

**Session Required** (`app/(embedded)/app/session-required/page.tsx`): Updated from "Session Required" / "Store session not found" to "Restoring Session" / "Session needs to be restored" for friendlier framing.

**Analytics** (`app/(embedded)/app/analytics/page.tsx`): Demoted to "Reporting" with subtitle clarifying it's supplemental to the Dashboard. Added back-navigation to Dashboard. Not in primary nav.

### Internal Admin Portal Polish (2026-04-09)

Admin portal visual polish and enhancement pass. All admin pages already existed with functional backend (API routes + DB functions).

**Overview** (`app/admin/page.tsx`): Platform health dashboard. Health status bar (sync, jobs, mappings, automation — green/red). KPIs: active shops, disputes processed, automation success rate, save-to-Shopify rate, win rate, amount recovered, avg time to submit/close, manual intervention %, submission uncertainty %. Systemic bottlenecks: top evidence blockers, failing dispute types, unmapped reasons. Status distribution + outcome breakdown. Plan distribution + financials demoted to bottom. Links to Operations Queue for case triage.

**Operations** (`app/admin/operations/page.tsx`): Exception queue for manual review. 6 ops counters (needs attention, failed jobs, sync issues, submission uncertain, overridden, stale 7d+). Triage panel with grouped actionable items. Shops Needing Intervention leaderboard. Ops Activity feed (failures, overrides, resyncs, notes).

**Reason Mapping** (`app/admin/reason-mapping/page.tsx`): Enhanced phase toggle with segmented control UI. Added unmapped reasons warning banner when gaps exist.

**Shared components**: AdminPageHeader, AdminStatsRow, AdminFilterBar, AdminTable, StatusPill all already in use across all admin pages. Template Library, Template Detail, Template Health, Shops, Jobs, Audit, Billing, and Team pages were already production-quality with consistent styling.

### Merchant-First Page Reset (2026-04-09)

Structural reset of all embedded app pages around the four-question contract: Purpose → Current State → Recommended Next Action → Advanced Controls.

**Dashboard**: Restructured to Protection Status → Active Cases → KPIs → Recent Disputes → Charts. Protection card uses strict status taxonomy (Active/Partially Configured/Needs Attention/Needs Setup) with state-dependent primary CTA and blocker list.

**Case Detail**: Added hero section at page top showing phase explanation, case status description, and state-dependent primary CTA. Inquiry CTA: "Prepare Response" / "Review & Send Response". Chargeback CTA: "Build Evidence" / "Review & Save to Shopify". Unknown phase: warning banner + "Re-sync Dispute" as only CTA (workflow suppressed until phase known). Removed silent chargeback default for unknown phase.

**Coverage**: Fixed coverage logic — family is "Fully Covered" only when BOTH phases have handling. Shows "Partial" when only one phase covered. Removed template language from merchant view. Gap CTAs are now specific: "Configure Inquiry Handling" / "Configure Chargeback Handling" → links to Automation page. "Install Playbook" → links to Playbooks.

**Disputes List**: Added summary strip (X inquiries, Y chargebacks, Z need review, W need sync). NULL phase displays as "Needs Sync" badge (orange, attention tone). Added Urgency column (Overdue/Urgent/Review Required/On Track). Reordered columns: Phase → Order → Reason/Family → Amount → Status → Urgency → Actions. Added needs-review banner.

**Automation**: Replaced "phase-blind" jargon banner with plain-language note. Removed Default Templates by Phase table (internal governance). Lead with policy summary showing automated/review/unconfigured counts per family.

**Playbooks List**: Removed Source column (TEMPLATE/MANUAL is internal). Simplified to: Name, Type, Family, Status, Actions.

**Playbook Detail**: NULL phase on dispute-linked packs now shows explicit warning banner instead of silent omission.

**Phase utilities** (`lib/disputes/phaseUtils.ts`): Added `isPhaseKnown()`, `casePrimaryCta()` for state-dependent CTA logic. `phaseLabel()` returns "Needs Sync" for NULL (not "Unknown"). `phaseBadgeTone()` returns "attention" for NULL (not undefined).

## Signal Radar (admin-only merchant intelligence)

Admin-only Shopify-merchant pain monitor. Lives at `/admin/signal-radar`, ingested by `/api/cron/signal-radar-reddit` (hourly), classified by `/api/cron/signal-radar-classify` (every 5 min), with manual refresh via `POST /api/admin/signal-radar/refresh` (admin auth via `internal_admin_grants`).

**Purpose:** synthesize public Shopify-merchant pain (Reddit submissions + top-level comments for M1) into structured intelligence — categories, recurring phrases, week-over-week trends, competitor weaknesses — that informs DisputeDesk positioning, onboarding, and content. **Not outreach. Not auto-reply. Read-only feed in M1.**

**Tables** (migration `20260509120000_signal_radar.sql`, all service-role-only RLS):
- `signal_sources` — raw items + classifier work-queue (`analysis_status pending|classified|failed|skipped`, `analysis_attempts`, `analysis_locked_at`, `cluster_key`, `content_type submission|comment`, `parent_external_id`).
- `signal_analysis` — 1:1 with `signal_sources` after classification. Holds **two emotion dimensions** (`frustration_score` for operational pain, `emotional_intensity_score` for psychological urgency — they don't ladder), `signal_score` (DisputeDesk-strategic value), `source_confidence_score` (trustworthiness/specificity), `category`, `competitor`, `merchant_type`, `merchant_stage`, `merchant_scale_signals` (jsonb array of inferred GMV/volume/vertical hints), `suggested_angle`, `why_this_matters` (explicit synthesis — what DisputeDesk should DO), `summary`, plus snapshot cluster trend metrics (`cluster_size_24h`, `cluster_growth_rate`).
- `signal_alerts` — sent-alert ledger with both `dedup_key` (category-keyed) and `cluster_dedup_key` (cluster-keyed), powering two dedup paths plus a global circuit breaker (>10 immediate alerts/hour → suppress).

**Source adapter abstraction** (`lib/signal-radar/sources/types.ts`): `SignalSourceAdapter { platform, ingest(): Promise<IngestedItem[]> }`. Reddit adapter (`sources/reddit.ts`) is the only M1 implementation; M2/M3 will add Shopify Community + App Store reviews adapters against the same interface — no plugin loader, just a typed boundary so platform-specific assumptions don't leak.

**Adapter selection** (`lib/signal-radar/sources/index.ts`): `getDefaultAdapters()` returns `[shopifyCommunityAdapter, redditOrApifyAdapter]`. Shopify Community always runs (no auth, no IP issues, free). The Reddit slot picks Apify when `APIFY_API_TOKEN`/`APIFY_API_KEY` is set, falls through to direct Reddit (which 403s on Vercel) otherwise. Both adapters share `applyIngestGates()` from `lib/signal-radar/sources/utils.ts` — bot/automod filter + Shopify-context gate + Shopify-pain term gate, applied uniformly so the dashboard cannot fill with off-topic content regardless of source.

**Shopify Community adapter** (`lib/signal-radar/sources/shopify-community.ts`): community.shopify.com runs on Discourse and exposes public unauth JSON endpoints. The adapter hits `/latest.json` + `/top.json`, dedupes by topic id, decodes HTML entities in excerpts, filters closed/archived/globally-pinned topics. The forum is implicitly Shopify-context (the entire domain is Shopify), so `implicitShopifyContext: true` is passed to the gate — only the pain-term check applies. **Highest-signal source by far** — actual merchants discussing Shopify Payments, reserves, disputes, evidence, app problems on the official forum.

**Apify adapter** (`lib/signal-radar/sources/apify.ts`): calls `POST /v2/acts/{actor}/run-sync-get-dataset-items` synchronously. Default actor `trudax~reddit-scraper-lite`; override via `APIFY_REDDIT_ACTOR_ID`. **Search-based input** — `startUrls` is a list of Reddit search URLs (`https://www.reddit.com/search/?q=...&sort=new&t=month`) targeting Shopify-pain queries (`shopify chargeback`, `shopify reserve`, `chargeflow`, `disputifier`, etc.) instead of subreddit `/new` listings. This finds Shopify-specific content wherever it appears — including posts in subs we don't ingest directly. Defensive field mapping over common Reddit-scraper schemas via `pickString`/`pickNumber`; schema drift surfaces as a clear error through `IngestResult.errors`. r/shopify subreddit is implicitly Shopify-context; everything else requires literal "shopify" mention.

**Cloudflare Worker proxy** (`cloudflare-workers/signal-radar-reddit-proxy/`): ~50-line edge function with shared-secret `Authorization: Bearer` auth and a path whitelist (`/r/`, `/comments/` only). Available as a free fallback if Apify subscription is dropped — see folder README for two-step deploy.

Subreddits: `r/shopify`, `r/ecommerce`, `r/dropshipping`, `r/Entrepreneur`, `r/smallbusiness`. Submissions via `/r/{sub}/new.json?limit=50&raw_json=1`; top-level comments via `/r/{sub}/comments/{id}.json?limit=20&depth=1&sort=top&raw_json=1`.

Adapter routing: when `REDDIT_PROXY_URL` + `REDDIT_PROXY_SECRET` are set, the helper `redditFetch(path)` calls `${REDDIT_PROXY_URL}?path=...` with `Authorization: Bearer ${REDDIT_PROXY_SECRET}` and forwards the User-Agent via `X-Reddit-UA`. When unset, it falls back to direct fetches against `www.reddit.com` — fine for local dev (residential IPs), fails on Vercel.

Filters: skip `[deleted]`/`[removed]`, skip `collapsed=true`, skip `score < 1`, cap 20 comments/submission. Per-subreddit fetch errors are collected (not silently swallowed) and surfaced through `IngestResult.errors` → `/api/admin/signal-radar/refresh` JSON → admin UI banner, so operators see *why* an ingest returned 0 rows. If all 5 subs fail and the proxy isn't configured, the adapter adds an explicit hint to deploy the Cloudflare Worker.

**Clustering** (`lib/signal-radar/cluster.ts`): `computeClusterKey(text)` is a deterministic, embedding-free token fingerprint — lowercase, strip URLs/punct/markdown, drop stopwords, take top-8 by frequency-then-length, sort alphabetically, sha1 first 16 hex. Computed inline at ingest. Acceptable false-positives (related complaints collapse) — that's **better** than alert flooding. M2 upgrade path: replace with embedding cosine similarity + `signal_clusters` table. `extractPhrases(items)` powers the dashboard "Top Recurring Phrases" widget — 1- to 3-grams over the last 7d, stopword-filtered, with a curated Shopify-domain phrase whitelist boosted (×3): `black box`, `rolling reserve`, `payout hold`, `frozen funds`, `manual evidence`, `losing disputes`, etc.

**Classifier** (`lib/signal-radar/classify.ts`): OpenAI Chat Completions with **strict JSON schema mode** (`response_format: { type: "json_schema", strict: true, json_schema: SIGNAL_ANALYSIS_JSON_SCHEMA }`). Returns 13 fields including `merchant_type`, `merchant_scale_signals`, `why_this_matters`, both emotion dimensions, and `source_confidence_score`. Comments are passed alongside their parent submission's title for context. Model: `SIGNAL_RADAR_MODEL` (default `gpt-4o-mini-2024-07-18`) — **separate from `GENERATION_MODEL`** so content-gen tuning doesn't drift classifier behavior. Defense-in-depth: Zod parse at the boundary (`SignalAnalysisSchema`) — strict mode + Zod can drift.

**Classifier drain** (`lib/signal-radar/classify-drain.ts`): claims rows with `analysis_status='pending'`, `analysis_locked_at IS NULL OR < now() - 5 minutes`, AND `posted_at > now() - 30 days` (defense-in-depth max-age gate so stale items still queued from earlier ingest runs can't fire alert emails about years-old content), sets `analysis_locked_at`, classifies, computes cluster metrics, inserts `signal_analysis`, fires alerts. Wall-clock budget 45 s, max 2 in-flight, max 3 attempts before status=`failed`. Duplicate-key (PG `23505`) on the analysis insert reconciles the source row to `classified` instead of retrying — earlier passes can split the analysis insert from the source-status update, leaving a stuck pending row otherwise.

**Ingest max-age** (`lib/signal-radar/ingest-loop.ts`): `MAX_ITEM_AGE_MS = 30 days` is enforced on every adapter's output before upsert. Items with `posted_at` older than 30 days are dropped with a `dropped_stale` log line. Combined with the classify-drain gate, no item past the cutoff can reach the classifier even if a future adapter mis-parses dates.

**App Store sentiment-polarity gate** (`lib/signal-radar/sources/app-store.ts`): reviews with `rating >= 4` are dropped at ingest. Positive reviews on chargeback apps (e.g. "5/5 — Disputifier's support resolved my chargeback alert") were misclassified as `support_failure` / `competitor_frustration` because the classifier sees "support" + "chargeback" keywords without sentiment context. Only 1-3 star reviews ingest — those are the actual pain signal.

**Alerts** (`lib/signal-radar/alerts.ts`): pure `decideAlert()` rules:
- `migration_intent` AND `signal_score >= 8` → immediate, **no** category cooldown, but cluster cooldown 24h still applies, hard cap 5/day
- `transparency_frustration` AND `signal_score >= 8` → immediate, 4h category cooldown + 24h cluster cooldown
- `reserve_fear` AND `signal_score >= 9` → immediate, 4h category cooldown + 24h cluster cooldown
- `competitor_frustration` AND `signal_score >= 8` → immediate, 4h category cooldown + 24h cluster cooldown
- everything else → digest (digest is no-op in M1; rolls up in M3)

**Source-confidence gate**: `source_confidence_score < 5` always falls through to digest, regardless of category — vague low-confidence rants don't fire immediates. Both dedup keys (`category` and `cluster`) are stored on every `signal_alerts` row. Global circuit breaker: > 10 immediate alerts in any 1h window suppresses further immediates.

**Email**: reuses `sendAdminEmail()` (`lib/email/adminEmail.ts`), `logTag: "signal-radar-immediate"`. Subject `[Signal Radar] {category}: {title}`. Body shows `why_this_matters` first (the synthesis the operator should read first), then summary, suggested angle, scores, "Open original" + "Open Signal Radar" links.

**Manual refresh** (`/api/admin/signal-radar/refresh`, POST, admin auth): inserts a `signal_radar_ingest_runs` row, returns `202 { run_id, started_at }` immediately, then runs `ingestLoop` inside Next.js `after()` so the work continues post-response. Synchronous response would otherwise return Vercel `504` because the full Reddit + Shopify Community + App Store loop takes 100–150s and exceeds the edge-proxy first-byte timeout (~60s for browser-facing routes), even with `maxDuration=300`. The UI polls `/api/admin/signal-radar/refresh-status?run_id=…` every 5s; the `signal_radar_ingest_runs` row flips to `done`/`error` with `fetched`, `inserted`, `errors`, `by_platform`. Migration `20260510140000_signal_radar_ingest_runs.sql`.

**Dashboard** (`/admin/signal-radar/page.tsx` server component, `revalidate=300`): rebuilt as four curated intelligence streams. Classifier internals (raw category enums, emotion sliders, confidence sliders, sort buttons) are hidden in drill-down only.
- **KPI strip** — high-intent today, looking-to-switch today, reserve & payout pain today, competitor frustration today. All scoped to last 24h, `merchant_relevance=true`, `spam`/`trolling` excluded.
- **🔥 Merchants actively looking to switch** — `category=migration_intent` rows from the last 30 days, sorted by `signal_score`. Real merchant quotes prominent.
- **⚠ Competitor pain spikes** — grouped by `competitor`. Each row shows mention count this week vs prior week + delta + the top 3 recent signals for that competitor.
- **💰 High-value merchant leads** — rows where `merchant_scale_signals != '[]'` AND `signal_score >= 6`. Scale signal chips rendered inline.
- **📈 Emerging narratives** — re-themed `compareWeekOverWeek` widget. Plain-English category labels via `lib/signal-radar/category-labels.ts` (e.g. `transparency_frustration` → "Lost trust in their tool").
- **Detail panel** (`detail-panel.tsx`) — `why_this_matters` first, four scores side-by-side, `merchant_scale_signals` chips, cluster trend badge, excerpt, "Open original" link.
- **/admin/signal-radar/all** secondary route — operator "Browse all signals" view with the original FeedClient (filter bar, cluster expansion, Top Recurring Phrases widget). Not the default landing. Server load window is 30 days (matches ingest max-age) and the client `timeframe` defaults to `30d` when a `?category=…` URL param is present (drill-through from What Changed widget) so re-classified items with older `posted_at` aren't accidentally hidden behind the 7d default. **When `?category=…` is set, the analyses query filters by category server-side** — without that, a flood of `general_discussion` rows (300+/week) crowds out narrow categories like `transparency_frustration` (2/week) under the 200-row top-by-`created_at` cap. The source rows are then loaded by `id` from the analysis result rather than via a separate `posted_at` cap, so the cap can't drop them either.

Stream queries live in `lib/signal-radar/queries.ts` — `fetchKpiCounts`, `fetchSwitchingSignals`, `fetchCompetitorPain`, `fetchHighValueLeads`. All exclude `spam`/`trolling` via `HIDDEN_CATEGORIES`.

**What's NOT in M1**: save/dismiss/reviewed buttons, daily digest, Shopify Community/App Store ingesters, vocabulary persistence, content-opportunities tab, weekly intelligence report, per-admin alert preferences, outreach automation. The product direction is **intelligence synthesis, not social-media monitoring**.

**Cron schedule** (`vercel.json`): `/api/cron/signal-radar-reddit` hourly (`0 * * * *`), `/api/cron/signal-radar-classify` every 5 min (`*/5 * * * *`). Both authed via `Authorization: Bearer ${CRON_SECRET}` (or `?secret=` query fallback).

**Env vars**: production needs *one of* `APIFY_API_TOKEN` (preferred, paid) OR `REDDIT_PROXY_URL`+`REDDIT_PROXY_SECRET` (free Cloudflare Worker) — without either, every Reddit fetch from Vercel will 403. Optional: `APIFY_REDDIT_ACTOR_ID`, `REDDIT_USER_AGENT`, `SIGNAL_RADAR_MODEL`. Reuses `OPENAI_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFY_EMAIL`, `CRON_SECRET`.
