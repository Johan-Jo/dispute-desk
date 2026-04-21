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

Current 17 scopes (reflected in both TOML and `.env.example`):

```
read_orders, write_orders, read_customers, read_products, write_products,
read_fulfillments, read_shipping, read_shopify_payments_disputes,
read_shopify_payments_dispute_evidences, write_shopify_payments_dispute_evidences,
read_files, write_files, write_draft_orders, write_fulfillments,
write_merchant_managed_fulfillment_orders, read_locations, read_inventory,
write_inventory
```

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

RLS is enabled on all tables as defense-in-depth. Policies allow service
role full access. If a request somehow bypasses application code, RLS
prevents cross-shop data leakage.

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
  - `lib/email/sendPackSavedAlert.ts` — "Evidence saved" confirmation with locale-aware "Submit now in Shopify Admin" CTA. Includes an auto-submit note explaining Shopify will submit on the deadline if the merchant doesn't act. Fired after `save_to_shopify` job completes (fire-and-forget). Gated by `evidenceReady` notification preference.
- **Email trigger points:**
  1. **Welcome — email/password sign-up:** the Send Email hook emails a link to `GET /api/auth/confirm?token_hash=…&type=signup&redirect=…` (and optional `locale`). The confirm route calls `verifyOtp` with `token_hash` (no PKCE). On `type=signup` it sends welcome + admin notification server-side, then redirects. Legacy: `?code=…` still uses PKCE `exchangeCodeForSession` when the link came from Supabase-hosted verify.
  2. **Welcome — Shopify OAuth new user:** `GET /api/auth/shopify/callback` calls `sendWelcomeEmail` + `sendAdminSignupNotification` after creating the Supabase user.
  3. **Welcome — Shopify OAuth first store (signed-in):** callback sends welcome + admin notification on the first `portal_user_shops` row only.
  4. **Magic link sign-in:** `POST /api/auth/magic-link` calls `admin.generateLink` server-side (redirect URL from `NEXT_PUBLIC_APP_URL`, never client origin) then sends our branded magic-link email via Resend. The sign-in page calls this route — Supabase's own OTP email is never triggered.
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

| Type             | Trigger                              | Handler                                |
|------------------|--------------------------------------|----------------------------------------|
| sync_disputes    | Cron, manual, or dispute webhooks    | lib/jobs/handlers/syncDisputesJob.ts   |
| build_pack       | Automation pipeline or manual        | lib/jobs/handlers/buildPackJob.ts      |
| render_pdf       | POST /api/packs/:packId/render-pdf   | lib/jobs/handlers/renderPdfJob.ts      |
| save_to_shopify  | Auto-save gate or POST .../approve   | lib/jobs/handlers/saveToShopifyJob.ts  |

### Execution Flow

1. API route validates + creates resource → enqueues job → returns 202.
2. Vercel Cron hits worker every 2 minutes.
3. Worker claims jobs via `SELECT ... FOR UPDATE SKIP LOCKED`.
4. Per-shop concurrency: max 1 running job (V1).
5. Retry: 3 attempts, 30s × attempt backoff on failure.
6. UI polls `GET /api/jobs/:id` every 3 seconds until terminal state.

## Database Migrations

Migrations live in `supabase/migrations/`. **Primary workflow** is the **Supabase CLI** (tracks migrations in the remote `supabase_migrations` history — this is what the project uses day to day).

### Supabase CLI (recommended)

- **One-time:** `npx supabase login` then `npx supabase link --project-ref <ref>` (ref from `SUPABASE_URL` / Dashboard, e.g. `sddzuglxdnkhcnjmcpbj`). Enter the database password when prompted; link state stays local (see `.gitignore` for `supabase/.temp/`).
- **Apply migrations:** `npm run db:migrate` (alias for `npx supabase db push`) to push any new SQL files not yet applied remotely.
- **Existing DB:** If the database was created outside the CLI (e.g. Dashboard SQL or an old script), the CLI may have no migration history. Run `npx supabase migration repair <001> <002> … --status applied` once to mark already-applied files without re-running SQL; then `db push` applies only new migrations.
- **Without CLI link:** `npm run db:migrate:script` runs `scripts/run-migration.mjs`, which uses a local `_migrations` table and requires `SUPABASE_URL_POSTGRES` (or `SUPABASE_URL` + `SUPABASE_DB_PASSWORD`). Prefer the CLI when possible so there is a single source of truth with hosted Supabase.

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

### Pack Status Flow

```
queued → building → ready → saved_to_shopify
                  → ready (auto-save blocked by gate, merchant can still act)
                  → ready (parked for review → approve → saved_to_shopify)
                  → failed
```

**Core principle:** Packs are ALWAYS generated (`ready` or `failed`). Missing evidence never blocks pack creation — blockers only gate auto-save/submission. The `blocked` status is no longer set by the build step.

### Conditional Requirement Modes

Template items have a `requirement_mode` column (`pack_template_items`):
- `required_always` — always required
- `required_if_fulfilled` — required only when order has been shipped (AVS/tracking items)
- `required_if_card_payment` — required only when payment is a card (AVS/CVV)
- `recommended` — not required but weighted in scoring (0.5x)
- `optional` — nice to have (0.1x)

`OrderContext { isFulfilled, hasCardPayment, avsCvvAvailable }` is derived in `buildPack.ts` from the fetched order and passed to the completeness engine. Items that are inapplicable for the order context are marked `unavailable` with a reason string, not counted as blockers. `avsCvvAvailable` is true only when a card transaction actually returned AVS/CVV codes — external gateways (Stripe via Shopify, Adyen) often return null even for card payments.

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

### Customer IP Collection

`ORDER_DETAIL_QUERY` fetches `clientIp` (often null on many stores due to Shopify privacy restrictions). When present, the `paymentSource.ts` collector provides a `customer_ip` field. Shopify's `ShopifyPaymentsDisputeEvidenceUpdateInput` does **not** have a dedicated `customerPurchaseIp` field (verified via introspection 2026-04-21; earlier codebase claim was stale). When IP evidence exists the save-to-Shopify job appends `Customer purchase IP: <ip>` to `accessActivityLog` so the IP still reaches the bank in the "Activity logs" field. Priority: `recommended` for fraud disputes.

## Dispute Workspace

The dispute detail page (`/app/disputes/:id`) is a **unified tabbed workspace** with 3 tabs: Overview, Evidence, Review & Submit. It replaces the previous separate dispute detail + pack detail pages.

**Architecture:** `page.tsx` → `WorkspaceShell.tsx` (Polaris Tabs) → `OverviewTab`, `EvidenceTab`, `ReviewSubmitTab`. Central data hook `useDisputeWorkspace.ts` loads all data from `GET /api/disputes/:id/workspace` (composite endpoint). Tab state is React state, not URL params (avoids App Bridge iframe re-renders).

**Argument Engine** (`lib/argument/`):
- `templates.ts` — per-reason counterclaim templates (toWin, strongestEvidence, claims with required/supporting evidence)
- `generateArgument.ts` — builds `ArgumentMap` from reason + checklist (evaluates per-claim strength)
- `generateRebuttal.ts` — generates structured rebuttal sections (summary + per-claim + conclusion)
- `caseStrength.ts` — overall + per-claim strength scoring + improvement signal
- `whyThisCaseWins.ts` — auto-generated strengths/weaknesses
- `riskExplanation.ts` — risk assessment for submit tab
- `nextAction.ts` — computes single next step for merchant

**Auto-generation:** When the workspace loads and finds a pack but no argument map, it auto-generates one (`POST /api/disputes/:id/argument`). No manual trigger needed.

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

### Overview tab structure (recommendation engine)

The Overview tab is structured as a **decision-oriented recommendation engine**, not a dashboard. It answers three questions only: *what is this page for, what is the current state, what should the user do next.* Sections, in order:

0. **Polaris page title** (in `WorkspaceShell`) — `"Dispute #1068 — Unauthorized transaction"` using `merchantDisputeReasonLabel()` from `lib/rules/disputeReasons.ts`. The subtitle is intentionally omitted: order/amount/customer/state now live in the Case Summary card so the page header carries identity only.
1. **Case summary card** (first block in `OverviewTab`) — answers *what is this dispute*, scannable in under two seconds. Two-column layout: left column is the **amount at risk** rendered at `heading2xl` size for prominence; right column is a tight grid of order, customer, dispute reason, and submitted-on date (or "Awaiting submission"). Strict separation of concerns: this card is identity-only — it never repeats status, strength, deadline, or recommendation copy.
2. **Page header** — `"Review your defense before submitting to Shopify"` when the pack has not been saved to Shopify, or `"Your defense has been submitted to Shopify"` after submission. Lives inside `OverviewTab` itself between the summary and status cards.
3. **Case status card** (top priority for *what to do*) — single block with three facts (status, strength, deadline/submitted-on date) plus a bold **`Recommendation:`**-prefixed sentence. Submitted + strong/moderate: `"Recommendation: No further action is required. Your defense has been successfully submitted. We will notify you when the bank responds."` Submitted + weak: `"Recommendation: Monitor this case. Consider strengthening evidence for future disputes."` Not submitted: `"Recommendation: Submit now..."` / `"Recommendation: You can submit, but adding <missing>..."` / `"Recommendation: Add <missing> before submitting..."`. Submitted helper line shows elapsed days plus the response window: `"<N> days since submission. The issuing bank typically responds within 30–75 days."` Primary CTA: **Submit to Shopify** + **Edit evidence** when not submitted; **View in Shopify** (deep link to `admin/payments/dispute_evidences/:id`) once submitted. **Secondary post-submit CTA is gated on actual gaps in this case** (`OverviewTab.tsx`): if a refund/shipping/cancellation policy is missing → "Set up policies for future cases" → `/app/policies` (highest leverage: published policies auto-attach to every future pack); else if any non-policy field is missing → "Automate this for future cases" → `/app/rules?family=<id>` deep-linked to the family that matches this dispute's reason; if nothing is missing, no secondary CTA renders.
3. **How we defend this case** — fixed intro `"We are arguing that this transaction was legitimate based on:"` followed by assertive bullets synthesized from which evidence fields are present (`DEFENSE_RULES` in `OverviewTab.tsx`). Examples: *"Payment verification checks passed (AVS/CVV)"*, *"Order was successfully fulfilled and delivered"*, *"Customer behavior matches previous legitimate purchases"*. No counterclaim IDs, no hollow-circle placeholders.
4. **Your supporting evidence** — one row per checklist item with three signals: status badge (Included / Missing), strength badge (Strong / Moderate / Weak without it / Helpful), and an outcome-driven one-liner from `WHY_EVIDENCE_MATTERS` (e.g., *"Security checks passed — strong indicator of legitimate cardholder use."*). Missing items expose an inline "Add this evidence" button that jumps to the Evidence tab focused on the field.
5. **What Shopify will receive** — fixed intro `"This case demonstrates that the transaction was legitimate and properly verified."` followed by synthesized highlight bullets (`HIGHLIGHT_RULES`) such as *"Payment verification passed"*, *"Order fulfilled and delivered"*, *"Customer actively participated"*. Below a divider: evidence item count (from `submissionFields`) and the submission format.
6. **Evidence by category** — a one-sentence interpretation line above the progress bar (*"Coverage is complete. All required evidence categories are fully supported."* / *"Coverage has critical gaps..."* / *"Coverage is mostly complete..."*), then the bar, then per-category rows with a Fix button on gaps.

Rule: every section must explain *why* something matters and guide the user toward the next action. No raw scores, no system jargon, no generic dashboard phrasing. Assertive language only.

### Evidence tab structure (decision-driven analysis)

The Evidence tab is the analysis surface for a single dispute. It must answer three questions in order: *Will I win this case? Why? What should I do next?* Sections, in order:

1. **Top summary card** (`EvidenceTab.tsx`) — outcome + confidence badges (`outcomeFromStrength()`, `confidenceFrom()`), a `Recommendation:` sentence, key strengths (top 3 from `whyWins.strengths`), and key gaps (top 3 from `missingItems` rendered through `impactSentence()`). Scannable in 3 seconds.
2. **How strong your case is** (renamed from "Argument map") — counterclaims with strength badges and supporting/missing evidence. Field labels are routed through `FRIENDLY_FIELD_LABEL` (e.g., `avs_cvv_match` → "Card security checks"). Weak items always show an impact sentence rather than a bare "Insufficient" label.
3. **Defense letter** (renamed from "Rebuttal letter") — collapsed by default to a 220-character excerpt of the summary section; full letter behind a `View full defense letter` disclosure (Polaris `Collapsible`).
4. **Evidence categories** — unchanged. Per-category collapsible card with relevance badge, item rows with status / strength / Upload / Skip / Preview controls. This is the proof surface and is intentionally untouched.
5. **Closing action guidance Banner** — `success` tone with *"No action needed. Your case is ready for submission."* when strong; otherwise `warning` tone with *"Add &lt;top gap&gt; to strengthen your case."*

Removed in this rewrite to eliminate duplication: the standalone "Argument summary" card (folded into How-strong's intro line), the standalone "Case strength" card (covered by Top Summary), and the "Ways to strengthen this case" + "Collected automatically" cards (gaps now live inside How-strong's per-claim missing rows; auto-collected items appear inside Evidence categories).

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
- Storage: Supabase Storage `evidence-uploads/{shopId}/{packId}/`
- Max 10 MB, types: PNG, JPEG, GIF, WebP, PDF, TXT, CSV
- Creates `evidence_items` row with `source: manual_upload`

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
4. PDF buffer uploaded to Supabase Storage `evidence-packs/{shopId}/{packId}/{timestamp}.pdf`.
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
- `GET /api/dashboard/stats?shop_id=...&period=24h|7d|30d|all` — returns the full shared metrics layer: `activeDisputes`, `winRate`, `amountRecovered`, `amountLost`, `disputesWon`, `disputesLost`, `totalClosed`, `avgTimeToSubmit`, `avgTimeToClose`, `statusBreakdown` (by `normalized_status`), `outcomeBreakdown` (by `final_outcome`), `submissionBreakdown` (by `submission_state`, open disputes only), plus period-over-period change fields (`activeDisputesChange`, `winRateChange`, `amountAtRiskChange`, `amountRecoveredChange`, `disputesWonChange` — null when period is "all"). Also returns `recentActivity` (last 10 merchant-visible `dispute_events` enriched with `orderName`), `winRateTrend` (6 buckets), `disputeCategories` (by reason), and legacy fields (`totalDisputes`, `revenueRecovered`, `avgResponseTime`). Pack count from `evidence_packs`. Previous period is an equal-length window immediately before the current period.

**Operational Summary card (embedded dashboard):** Replaces the old "Protection Status" hero. Shows 4 counters: Action Needed (`new` + `action_needed` + `needs_review` — freshly-synced `new` disputes still need merchant attention and were previously invisible in every tile), Ready to Submit, Waiting on Issuer, Closed in Period. Primary CTA is context-aware: "Review N cases needing action" when action_needed > 0, "Submit N ready cases" when ready_to_submit > 0, otherwise "View All Disputes". Action Needed tile + CTA filter to `/app/disputes?normalized_status=new,action_needed,needs_review`.

**Lifecycle Status Cards (embedded dashboard):** 4-column grid below the summary: Action Needed (critical), Ready to Submit (warning), Saved to Shopify (info, from `submissionBreakdown`), Waiting on Issuer (info). Each links to a filtered dispute list.

**KPI cards (embedded dashboard):** 6 bordered cards — Active Disputes, Win Rate, Amount Recovered, Amount Lost, Avg. Time to Submit (days), Avg. Time to Close (days). Amount at Risk shown as a secondary amber banner below the grid. Period selector (24h / 7d / 30d / All) sits above the cards. Period-over-period comparison where available.

**Status Distribution (embedded dashboard):** Stacked horizontal bar + legend showing all `normalized_status` values with color-coded segments.

**Outcome Breakdown (embedded dashboard):** Per-outcome progress bars with counts and percentages from `final_outcome`. Won = green, Lost = red, others = amber/gray.

**Recent Activity feed (embedded dashboard):** Last 10 `dispute_events` (merchant-visible). Each row shows event type label, order name, description, and relative time. Rows link to the dispute detail page.

**Recent Disputes table (embedded dashboard):** Fetches `/api/disputes?per_page=8` + `/api/billing/usage` in parallel. Columns: Order (links to Shopify Admin order), Amount, Reason, Normalized Status (badge — status taxonomy already conveys the submission journey: new → submitted_to_shopify → submitted_to_bank → won/lost), Date (initiated_at, long format), Deadline (short month + day), Final Outcome (badge when closed), View Details. Order URL built from `order_gid` + `shop_domain`. The earlier separate "Submission" column was removed (2026-04-19) because Status already covers submission progress and the two columns frequently drifted out of sync when `normalized_status` advanced to `submitted_to_bank` without `submission_state` being promoted to `submitted_confirmed`. Nuanced submission-state detail (saved as draft vs. submitted but unconfirmed vs. manually reported) now lives only on the dispute detail page.

**Disputes list page (embedded):** `app/(embedded)/app/disputes/page.tsx` uses Polaris `Page` / `Layout` / `Card` (same shell as other embedded routes). The table inside `Card padding="0"` matches the dashboard **Recent Disputes** column set: **Order, ID** (first 8 chars of UUID, uppercased), **Customer**, **Amount**, **Reason**, **Status**, **Deadline** (short month + day), **Actions** → “View Details” link (`recentDisputesViewDetailsLinkStyle` from `lib/embedded/recentDisputesTableStyles.ts`). Shared helpers: `lib/embedded/shopifyOrderUrl.ts`, `withShopParams` on detail links. CSV export uses the same column order and includes customer. See **Review Queue** for toolbar (search, filter, export, sync).

**Dispute detail page (embedded):** `app/(embedded)/app/disputes/[id]/page.tsx`. Fetches `/api/disputes/:id` and `/api/disputes/:id/profile` in parallel. The API also returns `matchedRule` (first enabled automation rule for the shop). The page is structured as a **4-tier command center** with components in `[id]/components/`:

- **Tier 1 — StatusHero** (`components/StatusHero.tsx`): Single dominant card answering "what's happening" and "what to do next". Displays phase badge, family, amount, deadline (with urgent warning banner), and a state-dependent headline + explanation + primary CTA. Six states: no pack → "Build Evidence Pack"; building → "Generating..." (disabled); blocked → "Complete Evidence Pack"; ready → "Review & Save to Shopify"; saved → "Open in Shopify"; terminal (won/lost) → outcome display. i18n keys: `disputes.hero.*`.
- **Tier 2 — EvidencePackModule** (`components/EvidencePackModule.tsx`): Dashboard card for the latest evidence pack. Shows `ProgressBar` (completeness score), 3-stat grid (required missing / recommended missing / included), blockers list as `Banner`, and full-width CTA to open the pack detail page. Empty state shows "Generate Evidence Pack" button. Multiple packs shown as compact links below a divider. i18n keys: `disputes.evidence.*`.
- **Tier 3 — KeyDisputeFacts** (`components/KeyDisputeFacts.tsx`): Compact 2-column grid with 6 essential facts: Amount, Deadline, Reason, Status, Source, Created. Non-collapsible reference card. Reuses `summaryGrid`/`summaryItem` CSS classes. i18n keys: `disputes.facts.*`.
- **Tier 4 — DetailsAndHistory** (`components/DetailsAndHistory.tsx`): Secondary information. Handling mode card (only for automated/review modes), collapsible Order Data (customer + order details, default closed), and `DisputeTimeline` component. Low visual emphasis.
- **Shared utilities** (`components/utils.ts`): Types (`Dispute`, `Pack`, `MatchedRule`, `DisputeProfile`) and formatting helpers (`formatCurrency`, `formatDate`, `statusTone`, `statusLabel`, `packStatusTone`, `daysUntilInfo`) shared across all tier components.
- **Page chrome:** Title is phase-aware: **`Inquiry {id}`** / **`Chargeback {id}`** / **`Case {id}`** (unknown phase), with a blue **⚡ Automated** pill badge when an auto_pack rule matches. Subtitle shows **`Order date: {date}`**. Page-level `primaryAction` mirrors the hero CTA for quick access when scrolled. Secondary actions: Re-sync, Open in Shopify.
- **Navigation / i18n:** `fetchData` depends on `[id, searchParams]` so changing `?locale=` refetches the profile with the correct `Accept-Language`. All links use `withShopParams` to preserve `?shop`, `?host`, and `?locale`.
- **Open dispute in Shopify:** links to `https://admin.shopify.com/store/{handle}/finances/disputes/{id}` (note: `/finances/disputes/`, not the deprecated `/payments/disputes/`).
- **Help:** Merchants can read **Dispute detail page** / **Dispute detail in this app** in embedded Help (`dispute-detail-page` article; i18n: `help.articles.disputeDetailPage` and `help.embedded.articles.disputeDetailPage`).

**Dispute detail page (portal):** `app/(portal)/portal/disputes/[id]/page.tsx`. Same data sources. Renders the same real Shopify order timeline section between the Details/Automation grid and the Evidence Packs table. Timeline is built inline from `profile?.orderEvents` (Shopify) merged with pack events (DisputeDesk), sorted newest-first. Demo mode still uses hardcoded demo timeline data.

### Shop Preferences (Embedded Settings)
- `GET /api/shop/preferences?shop_id=...` — returns notification preferences from `shop_setup.steps.team.payload.notifications` (newDispute, beforeDue, evidenceReady). Used by embedded Settings page.
- `PATCH /api/shop/preferences` — body `{ shop_id, notifications: { newDispute?, beforeDue?, evidenceReady? } }`. Merges into team step payload and upserts `shop_setup`. Used to persist notification toggles.
- `POST /api/setup/invite` — body `{ email }`. Sends a teammate invite email via Resend pointing to the portal sign-up page. Used by the "Send invite" button in the Setup Wizard Team & Notifications step.

### Automation
- `GET /api/automation/settings?shop_id=...` — read shop automation settings (`auto_build_enabled`, `auto_save_enabled`, `auto_save_min_score`, `enforce_no_blockers`)
- `PATCH /api/automation/settings` — update any subset of the four automation fields. Called by the embedded Settings page Automation section (four controls: Auto Build toggle, Auto Save toggle, Min Score number input, Blocker Gate toggle + Save button).

**Embedded Settings page — Automation section:** `app/(embedded)/app/settings/page.tsx` now includes a full Automation card above Notifications. Fetches `/api/automation/settings` on load alongside usage and prefs. Renders four controls in bordered rows matching the Notifications style. Saving PATCHes `/api/automation/settings` and shows a 3-second success banner. The dashboard Automation Status card "Settings" link uses `withShopParams` to preserve locale when navigating here.
- `POST /api/disputes/sync` — enqueue dispute sync job
- `POST /api/packs/:packId/approve` — approve pack for save + enqueue job

### Authenticated (shop context required)

Shop context is provided by either (1) Shopify session cookies (embedded app) or (2) Supabase Auth + active_shop (portal) for the routes listed under "Portal API prefixes" above.

- `GET /api/disputes` — list disputes. Supports: `shop_id`, `status`, `phase`, `needs_review`, `due_before`, `normalized_status`, `final_outcome`, `submission_state`, `closed` (true/false), `date_field` (initiated_at|submitted_at|closed_at), `date_from`, `date_to`, `amount_min`, `amount_max`, `sort` (due_at|initiated_at|closed_at|submitted_at|amount), `sort_dir` (asc|desc), `page`, `per_page`.
- `GET /api/disputes/:id` — single dispute. Response includes `family` (from `DISPUTE_REASON_FAMILIES`) and `handling_mode` (`automated`|`review`|`manual`).
- `POST /api/disputes/sync` — run sync for shop (portal: body `{ shop_id }`; runs synchronously, not job)
- `POST /api/disputes/:id/sync` — re-sync one dispute
- `POST /api/disputes/:id/packs` → 202 `{ packId, jobId }` (creates pack + enqueues build)
- `GET /api/disputes/:id/packs` → list packs for a dispute
- `GET /api/packs/:packId` → full pack: items, checklist, audit log, active jobs. If the id is not in `evidence_packs`, falls back to the library `packs` table (e.g. template-installed packs) and returns a compatible shape with empty evidence/jobs.
- `GET /api/packs?status=&q=` — list packs for the current shop (shopId resolved via middleware `x-shop-id`)
- `POST /api/packs` — create a manual pack for the current shop (client no longer needs to send `shopId`; server resolves from `x-shop-id`)
- `POST /api/packs/:packId/upload` → multipart file upload (10 MB, creates evidence_item)
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
- **Setup automation** (`GET` / `POST /api/setup/automation`): `GET` returns `activePacks` (the library list above), `pack_modes` (per-pack handling keyed by `packs.id`: `manual` | `review` | `auto_pack`), `installedTemplateIds`, and merged `reason_rows` / safeguards derived from pack modes plus existing setup rules (`buildAutomationPayloadFromPackModes` in `lib/rules/packHandlingAutomation.ts`). `POST` with `{ shop_id, pack_modes }` validates modes against that pack list and installed templates, then persists via `replacePackBasedAutomationRules`. The legacy body with `reason_rows` / `safeguards` still goes through `replaceSetupAutomationRules` when `pack_modes` is omitted (see `lib/rules/setupAutomation.ts`). Setup-managed rows use the `__dd_setup__:` prefix; saving replaces setup-managed rules and removes legacy `install-preset` rows with the old fixed names.
- **Evaluation** (`pickAutomationAction` in `lib/rules/pickAutomationAction.ts`, used by `evaluateRules`): Tier order is **amount safeguards → per-reason rules → catch-all** `match: {}`. Default when nothing matches: **manual** (no pipeline, no `needs_review`). Within the same tier and priority, **review** sorts before **auto_pack**. On **new dispute** sync (`syncDisputes.ts`), `review` sets `needs_review`; `auto_pack` runs `runAutomationPipeline` and stores `pack_template_id` on the new `evidence_packs` row (`029_evidence_packs_pack_template.sql`); `manual` does neither.
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
- `DashboardOperationalSummary.tsx` — mobile header stacks title → attention badge → full-width CTA; counters collapse from `minmax(140px, 1fr)` to a 2×2 grid
- `DashboardKpis.tsx` — mobile reshapes the 5-tile grid into a hero tile (Amount at Risk, background tinted critical when `> 0`) over two 2-col rows (Win Rate / Active · Recovered / Lost); icon chip shrinks 32→24 px, value font 24→22 px, padding 16→12 px
- `DashboardRecentDisputesPreview.tsx` — desktop keeps the 8-column table; mobile reuses `MobileDisputesList` directly (fetch returns raw `Dispute[]`, both branches read from the same state)
- `DashboardHelpCard.tsx` — mobile stacks icon + text + link vertically with a full-width link button
- `dashboardHelpers.ts` — lifted types (`DashboardStats`, `PeriodKey`), `DEFAULT_STATS`, `useDateLocale`, `useFormatCurrency`, `safeStatusLabel`, `safeOutcomeLabel`
- `dashboard.module.css` — mobile-only CSS (`kpiTileMobile`, `kpiHeroTileRisk`, `mobileGrid2`, `summaryCounterMobile`, `helpCardMobile`). Desktop inline styles untouched.

**Section order (identical on desktop and mobile):** Operational Summary → Performance Overview (KPIs) → Outcome Breakdown → Recent Disputes → Recent Activity → Charts → Help. The Operational Summary card owns the primary triage CTA ("Review N cases"), so Recent Disputes doesn't need to jump ahead of the KPIs.

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
- Calls `evaluateRules()` with dispute context.
- `auto_pack` → triggers `runAutomationPipeline()`.
- `review` → sets `needs_review = true` on the dispute row.

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

### Why evidence is text-only

`ShopifyPaymentsDisputeEvidenceUpdateInput` has 6 file fields (`uncategorizedFile`, `customerCommunicationFile`, `shippingDocumentationFile`, etc.), but as of 2026-04-21 there is **no currently-public Shopify Admin API path** for a third-party app to produce a valid `ShopifyPaymentsDisputeFileUpload` GID to put in those fields. Verified:

- REST `/admin/api/{2024-10|2025-04|2026-01}/shopify_payments/disputes/:id/dispute_file_uploads.json` → HTTP 404.
- GraphQL `stagedUploadsCreate` → rejects `resource: "DISPUTE_FILE_UPLOAD"` as an invalid enum value (valid resources are COLLECTION_IMAGE, FILE, IMAGE, MODEL_3D, PRODUCT_IMAGE, SHOP_IMAGE, VIDEO, BULK_MUTATION_VARIABLES, RETURN_LABEL, URL_REDIRECT_IMPORT — nothing dispute-scoped).
- `DisputeFileUploadInput.id` is `ID!` — strictly a GID, not a URL. A prior attempt (git `7e4bcb6`) passed the staged-upload GCS URL as the id, which Shopify rejected with `Invalid global id '…storage.googleapis.com/…'`.

All evidence is therefore routed into the 9 text fields (`uncategorizedText` as the primary rebuttal destination; `accessActivityLog` for order + payment + activity; `cancellationPolicyDisclosure` / `refundPolicyDisclosure` for policies; etc.). Files merchants upload inside Shopify Admin's UI still attach to the dispute — that path is inside Shopify, not through our app.

The stub `lib/shopify/disputeFileUpload.ts` is kept as a documentation artifact of what was tried; it exports nothing and is not called. If Shopify ever adds a supported upload path, re-introspect first, confirm the returned identifier shape matches `DisputeFileUploadInput.id: ID!`, and rebuild from scratch.

### Save Safeguards

The API and the client enforce three gates before a save is allowed:

| Condition | Server response | Client behaviour |
|---|---|---|
| `submission_readiness === "blocked"` | 422 `PACK_BLOCKED` | Critical banner shown; no API call made |
| `submission_readiness === "ready_with_warnings"` or `completeness_score < 80` without `confirmWarnings: true` | 422 `PACK_HAS_WARNINGS` (includes `score`, `readiness`) | Polaris `Modal` shown for merchant confirmation; on confirm, resends with `{ confirmWarnings: true }` |
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

Server-side only. `checkPackQuota()` counts packs in the current calendar month.
`checkFeatureAccess()` gates auto-pack and rules by plan tier.

Guards at: `POST /api/disputes/:id/packs` (quota), `POST /api/rules` (feature),
`runAutomationPipeline()` (both).

### Shopify Billing Flow

1. `POST /api/billing/subscribe` → `appSubscriptionCreate` → merchant redirected to Shopify approval
2. `GET /api/billing/callback` → `shops.plan` updated on approval
3. `GET /api/billing/usage?shop_id=...` → returns plan, monthly usage, and `shop_domain` (used by embedded Settings for store connection display).

If the store session is invalid (e.g. missing shop domain) or the shop is not connected, subscribe returns 400 or 404 with an error message. The billing UI (portal and embedded) shows this message and an **Open in Shopify Admin** link so the merchant can open the app from Shopify Admin to restore a valid session (after using **Clear shop & reconnect** in the sidebar if needed).

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

**Purpose:** Collect store metadata and Shopify evidence preferences to personalize coverage recommendations and automation settings.

**Implementation:** `components/setup/steps/StoreProfileStep.tsx`. Collects:
- Store type (physical / digital / services / subscriptions)
- Delivery proof level (always / sometimes / rarely)
- Digital proof capabilities
- Preferred handling style (automated / review / conservative)
- Review threshold ($)
- **Shopify evidence config** — per-group behavior preferences for 7 Shopify-native evidence groups:
  - Order details, Customer & address, Fulfillment records, Tracking from Shopify, Order timeline, Refund history, Notes & metadata
  - Each group: `always` | `when_present` | `review` | `off`
  - Defaults recalculate when store type or delivery proof changes (`getDefaultEvidenceConfig` in `lib/setup/recommendTemplates.ts`)
- "Other evidence" informational section (carrier proof, support conversations, digital access logs, custom docs — all manual upload in V1)

Payload (including `shopifyEvidenceConfig`) is saved to `shop_setup.steps.store_profile.payload` on Continue.

### Step 3: Coverage (`CoverageStep`)

**Purpose:** Based on store profile and Shopify evidence config from Step 2, recommend dispute templates for the merchant to install.

**Implementation:** `components/setup/steps/CoverageStep.tsx`. On mount:
1. Reads `steps.store_profile.payload` from `GET /api/setup/state`
2. Fetches template catalog from `GET /api/templates`
3. Checks already-installed templates from `GET /api/setup/automation`
4. Runs `recommendTemplates(profile)` (pure function in `lib/setup/recommendTemplates.ts`) to derive recommended templates

**Recommendation algorithm** maps store types + evidence config to templates:
- Physical + strong tracking → `pnr_with_tracking`; weak → `pnr_weak_proof`
- Digital/services → `digital_goods`, `credit_not_processed`
- Subscriptions → `subscription_canceled`
- Always: `fraud_standard` (universal) + `general_catchall` (fallback)
- Evidence confidence (`high` / `medium` / `low`) derived from evidence config, passed to Step 4

**UI:** Evidence summary (read-only, from Step 2) + dispute family cards with template toggles (on/off) + an **"Add more playbooks"** disclosure that lists every non-recommended chargeback template (e.g. `pnr_weak_proof`, `digital_goods`, `credit_not_processed`, `duplicate_incorrect`, `policy_forward`) so merchants whose store doesn't match a single profile can opt in to extras.

**Silent inquiry pairing:** Inquiry-phase template variants from migration `20260411150000` (`fraud_inquiry`, `pnr_inquiry`, …) are installed alongside their chargeback siblings using `inquiryPairsFor()` from `lib/setup/recommendTemplates.ts`. Merchants never see them in the wizard or the Automation Rules page (`listLibraryPacksForAutomationRules` filters them out via `INQUIRY_TEMPLATE_ID_SET`). Routing happens in `replacePackBasedAutomationRules`, which writes a phase-paired rule per chargeback pack: one rule with `match.phase = ["chargeback"]` pointing at the chargeback template, plus a sibling rule named `__dd_setup__:pack:{packId}:inquiry` with `match.phase = ["inquiry"]` pointing at the inquiry template. `digital_goods` deliberately has no inquiry sibling — inquiries on digital products fall back to `general_inquiry` via the `reason_template_mappings` defaults consulted in `lib/automation/pipeline.ts → resolveAutomationTemplate`.

On save: installs the recommended chargeback templates plus any extras the merchant ticked, plus their inquiry pairs, all via `POST /api/templates/:id/install`. Saves step payload with `installedTemplateIds` (chargeback ids only), `selectedFamilies`, `evidenceConfidence`.

### Step 4: Automation (`AutomationRulesStep`)

**Purpose:** Onboarding-first screen for **what happens when a new dispute syncs** — not a dense admin table. Implemented in `components/setup/steps/AutomationRulesStep.tsx`. Copy lives under `setup.rules` in locale files.

**UX structure (merchant mental model):**

1. **Header** — Title + short subtitle: default first, then optional exceptions; safeguards apply on top.
2. **Recommended starting point** — Three selectable preset cards: **Manual**, **Review first**, **Automatic**. Manual is visually marked as suggested for first-time users. **Automatic** is disabled until at least one pack template is installed (same prerequisite as template pickers).
2b. **Installed library packs** — One row per template-backed pack (DRAFT or ACTIVE, not archived) with **Manual review** / **Automatic** segments and a status badge; mirrors installs from the Packs step so draft packs are configurable before activation.
3. **Default rule (General)** — Presented as the **fallback** when no per-reason override applies: pack template (when mode is review/auto-build) + handling mode (Manual / Review first / Auto-build). Not a row inside a large table.
4. **Exceptions by dispute reason** — One card per Shopify reason (fraud, product not received, etc.): title, one-line helper, template `Select`, handling `Select`. Optional to customize; easy to scan.
5. **Safeguards** — Visually separated “safety” block: **switch-style** controls (not plain checkboxes) for high-value review threshold and catch-all review. Helper copy states these **override** the default and per-reason rules when conditions match.
6. **Live summary** — Read-only recap of effective configuration (default line, per-reason lines, safeguard lines).

**Data & API:** Loads via `GET /api/setup/automation` (`activePacks`, `pack_modes`, `installedTemplateIds`). The step shows one row per template-backed library pack with a segmented control (**Manual review** / **Automatic**). Saves with `POST` `{ shop_id, pack_modes }` (keys = `packs.id`). The embedded `/app/rules` page uses the same API, presenting a per-family view of the same data.

**Evaluation order** (unchanged; see `lib/rules/pickAutomationAction.ts`): amount safeguards → per-reason rule → default (General) → catch-all. Merchant-facing help article: `help.articles.configuringAutomation`.

**Evidence-aware defaults:** On first load (no existing pack_modes), defaults are set based on `steps.coverage.payload.evidenceConfidence`:
- `high` → all packs default to "auto"
- `medium` → fraud/PNR packs to "auto", others to "manual"
- `low` → all packs default to "manual"

### Step 5: Policies (`BusinessPoliciesStep`)

**Purpose:** Let merchants set up their shipping, refund, terms, and privacy policies so they get included in every evidence pack.

**Implementation:** `components/setup/steps/BusinessPoliciesStep.tsx`. Three flows — use your own policies (URL or upload), use suggested templates, or mix and match. Selections persist via `POST /api/policies/apply` + `POST /api/setup/step`. Same component also powers the standalone `/app/policies` page so there is one source of truth for policy management.

### Step 6: Activate (`ActivateStep`)

**Purpose:** Review configuration summary and activate protection.

**Implementation:** `components/setup/steps/ActivateStep.tsx`. On mount fetches setup state and automation data.

**UI:** Three summary cards:
1. **Evidence sources** — X of 7 Shopify evidence groups enabled, plus "Other: manual upload"
2. **Coverage** — X templates installed covering Y dispute families, with template names
3. **Automation** — X packs on automatic, Y on manual review

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
| StoreProfileStep | `components/setup/steps/StoreProfileStep.tsx` | Step 2: store type, proof levels, handling style, Shopify evidence config |
| CoverageStep | `components/setup/steps/CoverageStep.tsx` | Step 3: evidence summary + template recommendations + install |
| AutomationRulesStep | `components/setup/steps/AutomationRulesStep.tsx` | Step 4: per-pack manual/auto toggle with evidence-aware defaults |
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
- 29 articles defined in `lib/help/articles.ts` (slug, category, title/body keys, tags); categories in `lib/help/categories.ts`.
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

**Publish notification email:** After each successful queue row, `executePublishQueueTick` calls `sendPublishNotification` **only for `locale === "en-US"`** when `cms_settings.settings_json.autopilotNotifyEmail` is non-empty (trimmed) and the localization has `title` and `slug`. One email per article — non-English locale rows are intentionally skipped so the recipient receives a single notification with the canonical English URL. The same `locale === "en-US"` guard applies in `repairStuckPublishedWorkflow` (`lib/resources/publish.ts`). There is **no default recipient in application code** — operators must enter an address under **Admin → Resources → Settings → AI Autopilot → Notification email** and let settings auto-save. Production needs `RESEND_API_KEY` (and optional `EMAIL_FROM`); without Resend, the helper returns failure and the tick logs it. If publish never ran (queue stuck or failed), no email is sent. HTML body escapes the article title for safe interpolation.

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
