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

```
read_orders
read_customers
read_products
read_fulfillments
read_shipping
read_shopify_payments_disputes
read_shopify_payments_dispute_evidences
write_shopify_payments_dispute_evidences
read_files
write_files
```

> **Approved (2026-03-02):** `read_shopify_payments_dispute_evidences` and
> `write_shopify_payments_dispute_evidences` were approved by Shopify App
> Review (Reggie F.). However, the Shopify CLI deploy pipeline rejects
> these scopes in `shopify.app.toml` ([Shopify/cli#4288](https://github.com/Shopify/cli/issues/4288) —
> restricted to "Payments Apps" category). **Workaround:** the evidence
> scopes are requested only in the custom OAuth flow (`SHOPIFY_SCOPES` env
> var) and Shopify grants them at install/re-auth time. They are NOT in the
> TOML `[access_scopes]`.

### Additional Scopes (seed script only)

The test store seed script (`scripts/shopify/seed-teststore.mjs`) requires
these extra scopes in `shopify.app.toml`, deployed via `shopify app deploy`:

```
write_orders
write_products
write_inventory
write_draft_orders
write_fulfillments
write_merchant_managed_fulfillment_orders
```

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

### Embedded session cookies

After Shopify OAuth, the callback sets `shopify_shop` and `shopify_shop_id`
as HTTP-only, secure cookies with **`sameSite: "none"`**. This is required
so the browser sends them when the app is loaded inside Shopify Admin’s
iframe (cross-origin). With `sameSite: "lax"`, cookies would not be sent
in that context and the app would redirect to auth repeatedly.

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
- **Email trigger points:**
  1. **Welcome — email/password sign-up:** the Send Email hook emails a link to `GET /api/auth/confirm?token_hash=…&type=signup&redirect=…` (and optional `locale`). The confirm route calls `verifyOtp` with `token_hash` (no PKCE). On `type=signup` it sends welcome + admin notification server-side, then redirects. Legacy: `?code=…` still uses PKCE `exchangeCodeForSession` when the link came from Supabase-hosted verify.
  2. **Welcome — Shopify OAuth new user:** `GET /api/auth/shopify/callback` calls `sendWelcomeEmail` + `sendAdminSignupNotification` after creating the Supabase user.
  3. **Welcome — Shopify OAuth first store (signed-in):** callback sends welcome + admin notification on the first `portal_user_shops` row only.
  4. **Magic link sign-in:** `POST /api/auth/magic-link` calls `admin.generateLink` server-side (redirect URL from `NEXT_PUBLIC_APP_URL`, never client origin) then sends our branded magic-link email via Resend. The sign-in page calls this route — Supabase's own OTP email is never triggered.
- **Idempotency keys** prevent duplicate welcome sends: `welcome-confirm/{email}` (email flow), `welcome-shopify/{userId}` (Shopify flow), `welcome/{userId}` (signed-in connect).

## Resources Hub (public marketing)

The **Resources Hub** is the localized **marketing / SEO** surface for long-form content (articles, templates, case studies, glossary, blog). It is **not** part of the embedded Shopify app.

### Surfaces

| Area | Routes | Notes |
|------|--------|--------|
| Public hub | `/resources`, `/templates`, `/case-studies`, `/glossary`, `/blog` and locale-prefixed variants (`/sv/resources`, …) | `app/[locale]/*`, next-intl |
| Privacy | `/privacy`, `/{pathLocale}/privacy` (e.g. `/de/privacy`) | `app/[locale]/privacy/page.tsx`; copy under `messages/*/consent.*` |
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

### Key modules

| Module | Path | Purpose |
|--------|------|---------|
| Settings | `lib/automation/settings.ts` | Read/write shop_settings with auto-upsert |
| Completeness | `lib/automation/completeness.ts` | Per-reason templates, score + blockers |
| Auto-Save Gate | `lib/automation/autoSaveGate.ts` | Decision logic for auto-save |
| Pipeline | `lib/automation/pipeline.ts` | Orchestrator: trigger build + evaluate gate |

### Pack Status Flow

```
queued → building → ready → saved_to_shopify
                  → blocked (missing required items)
                  → ready (parked for review → approve → saved_to_shopify)
                  → failed
```

## Evidence Pack Builder

### Build Pipeline (`lib/packs/buildPack.ts`)

1. Load dispute → shop → offline session from DB
2. Decrypt access token (AES-256-GCM)
3. Run 4 source collectors concurrently (`Promise.allSettled`)
4. Insert `evidence_items` rows + audit events per section
5. Compute completeness from collected fields
6. Assemble `pack_json`, update pack row

### Source Collectors (`lib/packs/sources/`)

| Collector | File | Fields Provided |
|-----------|------|-----------------|
| Order | `orderSource.ts` | `order_confirmation`, `billing_address_match` |
| Fulfillment | `fulfillmentSource.ts` | `shipping_tracking`, `delivery_proof` |
| Policy | `policySource.ts` | `shipping_policy`, `refund_policy`, `cancellation_policy` (terms, refunds, shipping; privacy/contact stored but not yet mapped to Shopify evidence) |
| Manual | `manualSource.ts` | `customer_communication` |

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
- **Dispute pack** — `dispute_id != null`. The user is preparing evidence for **one specific dispute**. The UI shows "Prepare your evidence pack", the full flow (upload → save to Shopify → submit in Admin), and copy that states order/tracking/policies are already pulled from Shopify; upload is for additional documents.

Conditional copy and sections are driven by `isLibraryPack` (derived from `pack.dispute_id == null`) in both embedded and portal pack detail pages. i18n keys are namespaced (e.g. `detailHeroTitleTemplate`, `step1DescriptionDispute`) so template vs dispute wording stays consistent.

### Auto-collected evidence vs manual upload

When a pack is **built** for a dispute (automation or "Generate Pack"), evidence is collected automatically from Shopify and stored policy snapshots: order data (orderSource), fulfillment/tracking (fulfillmentSource), and store policies (policySource). Manual upload is for **additional** evidence that is not in Shopify (e.g. customer emails, screenshots, custom receipts). The pack detail UI in dispute mode states this explicitly: "We've pulled order details, tracking, and your store policies from Shopify. Add any extra documents below to strengthen the pack." and "Already included from your store: order, tracking, policies. Add more below if needed."

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
- `GET /api/dashboard/stats?shop_id=...&period=24h|7d|30d|all` — returns KPIs matching the portal: `activeDisputes`, `winRate`, `packCount`, `amountAtRisk`, plus period-over-period change fields (`activeDisputesChange`, `winRateChange`, `amountAtRiskChange` — null when period is "all"), `winRateTrend` (6 buckets), `disputeCategories` (by reason), and legacy fields (`totalDisputes`, `revenueRecovered`, `avgResponseTime`). Also returns lifecycle counts: `inquiryCount`, `chargebackCount`, `unknownPhaseCount`, `needsAttentionCount`. Pack count is queried from `evidence_packs`. Previous period is computed as an equal-length window immediately before the current period.

**Overview KPI cards (embedded dashboard):** 4 bordered cards matching the portal — Active Disputes (`AlertCircleIcon`), Win Rate (`ChartLineIcon`), Evidence Packs (`PackageIcon`), Amount at Risk (`CashDollarIcon`). Label top-left, icon top-right. When period comparison data is available shows `↗ +N% vs last month` / `↘ -N% vs last month` in green/red; falls back to a purple accent bar + period label for "All" or when comparison is unavailable. Period selector (24h / 7d / 30d / All) sits above the cards.

**Recent Disputes table (embedded dashboard):** Fetches `/api/disputes?per_page=5` + `/api/billing/usage` in parallel. Columns: Order (links to Shopify Admin order), ID (plain short UUID), Customer, Amount, Reason, Status (colored badge), Deadline, View Details. Order URL is built from `order_gid` + `shop_domain`.

**Disputes list page (embedded):** `app/(embedded)/app/disputes/page.tsx` uses Polaris `Page` / `Layout` / `Card` (same shell as other embedded routes). The table inside `Card padding="0"` matches the dashboard **Recent Disputes** column set: **Order, ID** (first 8 chars of UUID, uppercased), **Customer**, **Amount**, **Reason**, **Status**, **Deadline** (short month + day), **Actions** → “View Details” link (`recentDisputesViewDetailsLinkStyle` from `lib/embedded/recentDisputesTableStyles.ts`). Shared helpers: `lib/embedded/shopifyOrderUrl.ts`, `withShopParams` on detail links. CSV export uses the same column order and includes customer. See **Review Queue** for toolbar (search, filter, export, sync).

**Dispute detail page (embedded):** `app/(embedded)/app/disputes/[id]/page.tsx`. Fetches `/api/disputes/:id` and `/api/disputes/:id/profile` in parallel. The API also returns `matchedRule` (first enabled automation rule for the shop). Layout and Figma-aligned chrome live in **`dispute-detail.module.css`**; the five-step **Dispute status** rail is driven by **`getDisputeProgressSteps`** (`lib/embedded/disputeDetailProgress.ts`) and **`DisputeStatusStepper.tsx`** (Dispute Created → Work in Progress → Submit Evidence → Bank Review → Dispute Settled; terminal dispute statuses mark all steps complete).
- **Page chrome:** Title is phase-aware: **`Inquiry {id}`** / **`Chargeback {id}`** / **`Case {id}`** (unknown phase), with a blue **⚡ Automated** pill badge when an auto_pack rule matches. Subtitle shows **`Order date: {date}`**. A case metadata bar displays phase, family (from `DISPUTE_REASON_FAMILIES`), and handling mode. CTA is phase-aware: "Respond to Inquiry" for inquiries, "Build Evidence" for chargebacks.
- **Info banner:** Dismissible blue `Banner` at the top with 24-hour guarantee messaging. Dismissal persisted in `localStorage` (`dd-info-banner-dismissed`).
- **Dispute Summary (left column):** Collapsible `Card` with 2-column key-value grid (Dispute ID, Source, Transaction ID, RRN, Opened On, Status, Due Date, State, Amount, Reason). Uses `SummaryItem` component and `summaryGrid` CSS class.
- **Managed by DisputeDesk (right column top):** Card showing green lightning icon + "Fully Automated" heading + description. When `matchedRule` exists, shows a green "Auto-Pack Active" status row with the rule name.
- **More Evidence (right column bottom):** Card with "DO YOU HAVE MORE EVIDENCE?" header, file count badge (`0/5 files`), upload zone icon, and status-dependent copy. When any pack has been saved to Shopify, an **Open evidence pack** button links to the most recently saved pack.
- **Order Data:** Collapsible card merging Customer Info + Order Details (profile rows, order link, total, tracking).
- **Fulfillment Journey:** Collapsible card with the real Shopify order events timeline. Events fetched via `Order.events(first: 30, reverse: true)` in `DISPUTE_PROFILE_QUERY`. The profile API receives `?locale=` and forwards it as `Accept-Language`. Rail styling uses **`timeline*`** classes.
- **Evidence Packs table:** Pack ID (link to `/app/packs/:id`), Status badge, score (green ≥80 / amber ≥50 / red), blocker count, created date, View Details link or "Saved {date}" indicator. Header/cell classes: **`evidenceTable`** / **`evidenceTh`** / **`evidenceTd`**.
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

- `GET /api/disputes` — list disputes (portal: pass `shop_id` query; embedded: shop from cookies). Optional `?phase=inquiry|chargeback` filter.
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
- `progress.total` / `doneCount` count all 5 onboarding steps; `nextStepId` is the next actionable `todo` step based on prerequisites.

#### Rules vs library packs (mental model)

- **Pack templates** (`POST /api/templates/:id/install`): Creates shop **library** rows in `packs`, `pack_sections`, narratives, etc. (`installTemplate` in `lib/db/packs.ts`). When the Packs wizard step completes, installed template IDs are stored in `shop_setup.steps.packs.payload.installedTemplates`.
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
- `GET /api/admin/metrics` — dashboard stats (shops, disputes, packs, jobs, plans, templates, reason mappings)
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

## Governance Controls & Review Queue

### Rule Engine

`lib/rules/evaluateRules.ts` — deterministic, first-match-wins evaluator:

1. Fetches enabled rules for shop, ordered by `priority ASC`.
2. Each rule has `match` (JSONB: reason[], status[], amount_range) + `action` (JSONB: mode, require_fields).
3. All match conditions are AND-joined; empty match = match all.
4. First matching rule wins. No match defaults to `{ mode: "review" }`.
5. Every evaluation logged as `rule_applied` audit event.

### Sync Integration

When `syncDisputes()` detects a new dispute:
- Calls `evaluateRules()` with dispute context.
- `auto_pack` → triggers `runAutomationPipeline()`.
- `review` → sets `needs_review = true` on the dispute row.

### Review Queue

Both embedded and portal dispute pages have an "All Disputes" / "Review Queue" tab.
Review queue filters `needs_review=true`, sorted by due date (most urgent first).
Each row has an "Approve" button that clears `needs_review`, logs `rule_overridden`, and triggers automation.

**Embedded disputes list page (`app/(embedded)/app/disputes/page.tsx`):** Polaris `Page` / `Layout` / `Card` with toolbar (`TextField` search, Filter popover, Export, More actions → Sync). Table styling in `disputes-list.module.css` inside `Card padding="0"`. Columns align with **Recent Disputes** on the dashboard: Order (Shopify link when available), ID (short 8-char), Customer, Amount, Reason, Status (Polaris `Badge`), Deadline (short date), Actions (“View Details” `Link`). Row click was removed in favor of explicit View Details + order link. Search matches dispute GID, UUID, short ID, legacy `DP-` display form, order fields, reason, and customer. CSV: `Order,ID,Customer,Amount,Reason,Status,Due date`.

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
| `/api/rules/install-preset` | POST | Bulk install rule presets (body: `shop_id`, optional `preset_ids[]`). Idempotent by preset name. Plan-gated. |
| `/api/disputes/:id/approve` | POST | Approve from review queue |

Rule presets are defined in `lib/rules/presets.ts` (e.g. fraud auto-pack, PNR auto-pack, high-value review, catch-all review). Portal Rules page offers "Install Suggested Rules" and empty-state preset cards. The **embedded** Rules page (`app/(embedded)/app/rules/page.tsx`) always shows these four as **Suggested Starter Rules** with a **routing** control per row (Auto-Pack vs Send to Review) and **Save starter rules** (creates or updates `rules` rows by preset name). It also lists **ACTIVE** library packs from `GET /api/packs?status=ACTIVE`.

## Save Evidence to Shopify

### Field Mapping Engine

`lib/shopify/fieldMapping.ts` maps internal pack sections to `DisputeEvidenceUpdateInput` fields:

- `buildEvidenceInput(sections, disabledFields?)` — builds the Shopify input. Only non-empty fields are included.
- `previewEvidenceMapping(sections)` — returns per-field preview for the UI.
- Mapping: `shippingDocumentation` ← fulfillment/tracking/shipping, `refundPolicyDisclosure` ← refund_policy_snapshot, etc.

### Save Pipeline

1. `POST /api/packs/:packId/save-to-shopify` — enqueues `save_to_shopify` job, sets status to `saving`.
2. Job handler loads pack sections + decrypted offline session token.
3. Calls `disputeEvidenceUpdate` mutation with the dispute's `dispute_evidence_gid`.
4. On success → `saved_to_shopify` status + timestamp. On error → `save_failed` + audit log.

### Save Safeguards

The API and the client enforce three gates before a save is allowed:

| Condition | Server response | Client behaviour |
|---|---|---|
| `status === "blocked"` or `completeness_score === 0` | 422 `PACK_INCOMPLETE` | Critical banner shown; no API call made |
| `completeness_score < 80` without `confirmLowCompleteness: true` | 422 `PACK_LOW_COMPLETENESS` (includes `score`) | Polaris `Modal` shown for merchant confirmation; on confirm, resends with `{ confirmLowCompleteness: true }` |
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
| Rules Install Preset API | `tests/api/rules/installPreset.test.ts` | POST /api/rules/install-preset |
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

A 5-step guided setup wizard helps merchants configure DisputeDesk after
installation. Progress is tracked per-shop in the `shop_setup` table and surfaced on the
dashboard via a Setup Checklist card with a ring progress indicator.

**Billing, Settings, and Help** are app sections (reachable from nav) but are **not** part of the onboarding checklist.

### Welcome Page (Step 0)

Route: `/app/setup` (`app/(embedded)/app/setup/page.tsx`). Shown to new installs before entering the wizard steps. Displays:
- Hero with shield icon and "Welcome to DisputeDesk" heading
- Three benefit cards (Automated Response, Higher Win Rates, Save Time)
- "What to expect in setup" checklist (5 numbered items)
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
| 5 | `activate` | Activate | — |

All 5 steps are shown in both `WIZARD_STEP_IDS` and `WIZARD_STEPPER_IDS` (no separate welcome/pre-steps).

Legacy step ids (`permissions`, `open_in_admin`, `overview`, `welcome_goals`, `disputes`, `sync_disputes`, `packs`, `evidence_sources`, `policies`, `business_policies`, `rules`, `automation_rules`, `team`, `team_notifications`) are migrated to the new 5-step ids when reading `shop_setup.steps` (see `LEGACY_STEP_ID_MAP` in `lib/setup/constants.ts`).

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

**UI:** Evidence summary (read-only, from Step 2) + dispute family cards with template toggles (on/off). On save: installs selected templates via `POST /api/templates/:id/install`, saves step payload with `installedTemplateIds`, `selectedFamilies`, `evidenceConfidence`.

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

**Data & API:** Loads via `GET /api/setup/automation` (`activePacks`, `pack_modes`, `reason_rows`, safeguards, `installedTemplateIds`). The step shows one row per template-backed library pack with a segmented control (**Manual review** / **Automatic**). Saves with `POST` `{ shop_id, pack_modes }` (keys = `packs.id`). Presets and per-reason cards still map to the same automation payload where used; see § *Rules vs library packs*.

**Evaluation order** (unchanged; see `lib/rules/pickAutomationAction.ts`): amount safeguards → per-reason rule → default (General) → catch-all. Merchant-facing help article: `help.articles.configuringAutomation`.

**Evidence-aware defaults:** On first load (no existing pack_modes), defaults are set based on `steps.coverage.payload.evidenceConfidence`:
- `high` → all packs default to "auto"
- `medium` → fraud/PNR packs to "auto", others to "manual"
- `low` → all packs default to "manual"

### Step 5: Activate (`ActivateStep`)

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
- No hard prerequisite gating between the 5 steps — all steps have empty `prerequisites` arrays.

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
| ActivateStep | `components/setup/steps/ActivateStep.tsx` | Step 5: config summary + bulk pack activation |

### Shared Utilities

| Module | Path | Purpose |
|--------|------|---------|
| Types | `lib/setup/types.ts` | StepStatus, StepState, ShopSetupRow, etc. |
| Constants | `lib/setup/constants.ts` | SETUP_STEPS, prerequisite logic, helpers |
| Readiness | `lib/setup/readiness.ts` | `evaluateReadiness()` — live connection/scope/webhook checks |
| Recommend Templates | `lib/setup/recommendTemplates.ts` | `recommendTemplates()` + `deriveEvidenceConfidence()` + `getDefaultEvidenceConfig()` — store profile → template recs + evidence confidence |
| Evidence Types | `lib/setup/evidenceTypes.ts` | 8 evidence type definitions + source mappings |
| Events | `lib/setup/events.ts` | `logSetupEvent()` → app_events table |
| withShopParams | `lib/withShopParams.ts` | Preserve shop/host params in URLs |

### Business Policies (`BusinessPoliciesStep`) — formerly Step 7

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
- Dual-mode display based on `dispute_id`: library packs show as "Playbook Details", dispute-linked packs show as "Evidence Pack"
- Back link: Playbooks → `/app/packs`, Evidence → `/app/disputes/{id}`

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

**Coverage page** (`app/(embedded)/app/coverage/page.tsx`): Rewritten to show per-family, per-phase handling. Each family card has Inquiry and Chargeback rows showing automation mode, default template, and gap warnings. Summary shows fully-configured count, inquiry/chargeback flow counts, and gap count.

**Automation page** (`app/(embedded)/app/rules/page.tsx`): Restructured into policy sections: policy overview (automated/review/manual counts), default templates by phase table (from `reason_template_mappings`), starter rules workflow (preserved), and custom rules (secondary). Includes info banner noting rules are phase-blind.

**Playbooks list** (`app/(embedded)/app/packs/page.tsx`): Added Family column (derived from `DISPUTE_REASON_FAMILIES`).

**Pack detail** (`app/(embedded)/app/packs/[packId]/page.tsx`): For dispute-linked packs, shows dispute phase badge and lifecycle context banner (inquiry vs chargeback framing). API extended to return `dispute_phase` from joined disputes table.

**Scope:** Rules remain phase-blind. Both phases show the same automation mode from rules. Lifecycle differentiation comes from `reason_template_mappings` (per-phase template defaults). Phase-specific rules are a future enhancement.
