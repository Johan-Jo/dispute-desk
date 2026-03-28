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
| Email              | Resend (transactional; welcome email)               |
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

Transactional email is sent via **Resend**. Layout is minimal string-based
HTML (single link, no big CTA buttons or "copy this link" blocks) to
minimize spam classification.

- **Env:** `RESEND_API_KEY` (required). `EMAIL_FROM` defaults to
  `DisputeDesk <notifications@mail.disputedesk.app>` (sending subdomain). The
  domain must be verified in Resend (resend.com/domains). `EMAIL_REPLY_TO` sets
  Reply-To (defaults to same as FROM; avoid no-reply for deliverability).
- **Deliverability (inbox vs spam):** (1) Add DMARC (Resend: resend.com/docs/dashboard/domains/dmarc). (2) **Links in the email must use your sending domain** — set `NEXT_PUBLIC_APP_URL=https://disputedesk.app` so the dashboard link is not localhost. (3) Sending subdomain `mail.disputedesk.app` is the default; keep `EMAIL_FROM`/`EMAIL_REPLY_TO` on that subdomain so root domain reputation stays separate. (4) In Resend dashboard, turn off click/open tracking for the domain if enabled.
- **Templates:** `lib/email/templates.ts` (welcome HTML/text).
- **Send:** `lib/email/sendWelcome.ts`; `POST /api/emails/welcome` (body:
  `email`, optional `fullName`).
- **Welcome email** is sent when:
  1. User completes email/password sign-up (client calls API after success).
  2. User links their first shop via Shopify OAuth (callback sends server-side).
- Idempotency keys (`welcome/{email}` or `welcome/{userId}`) avoid duplicates.

## Resources Hub (public marketing)

The **Resources Hub** is the localized **marketing / SEO** surface for long-form content (articles, templates, case studies, glossary, blog). It is **not** part of the embedded Shopify app.

### Surfaces

| Area | Routes | Notes |
|------|--------|--------|
| Public hub | `/resources`, `/templates`, `/case-studies`, `/glossary`, `/blog` and locale-prefixed variants (`/sv/resources`, …) | `app/[locale]/*`, next-intl |
| Hub UI shell | `components/resources/ResourcesHubShell.tsx` | Shared horizontal layout with the marketing header via `MARKETING_PAGE_CONTAINER_CLASS` in `lib/marketing/pageContainer.ts` |
| Hub filter bar | `components/resources/ResourcesFilterBar.tsx` | Client component: content-type filters with icons, **More Filters** for additional types, language picker, clear filters — embedded in `ResourcesHubShell`. |
| Public article chrome | `components/resources/ArticleStickyBar.tsx` | Sticky bar on article pages: back to resources, share (native share or copy link). |
| Admin | `/admin/resources/*` | Dashboard, content list, calendar, queue, backlog, settings. Figma-based redesign (CH-2+). |
| In-app help (embedded) | `/app/help`, `/app/help/[slug]` | Separate copy from `lib/help/embedded` — **not** the CMS hub |

### Embedded app guard

Merchants must not browse the public hub **inside** Shopify Admin’s iframe. When a hub path is requested with the App Bridge **`host`** query parameter, `middleware.ts` **redirects to `/app/help`** and preserves `shop`, `host`, `locale`, and other params. Path matching lives in `lib/middleware/marketingHubPaths.ts` (see `tests/unit/marketingHubPaths.test.ts`).

### Content model and publishing

- **DB:** `content_items`, `content_localizations`, `content_publish_queue`, archive tables — migration `030_resources_hub.sql`. Planning columns (`topic`, `target_keyword`, `search_intent`, `priority`) added in `031_content_items_planning_columns.sql`. Hub locale `pt-PT` → `pt-BR` alignment: `20260328144057_hub_locale_pt_br.sql`.
- **Workflow:** `lib/resources/workflow.ts` — 11-status state machine with validated transitions (`idea` → `backlog` → … → `published` → `archived`). Display helpers for status/type/priority badges and locale flags.
- **Admin queries:** `lib/resources/admin-queries.ts` — stats, scheduled posts, translation gaps, content list (paginated + filterable), queue items, backlog, editor detail, workflow transitions, CMS settings.
- **Admin components:** `components/admin/resources/` — `WorkflowStatusBadge`, `ContentTypeBadge`, `PriorityBadge`, `LocaleStatusIndicator`, `LocaleCompletenessBadge`, `ValidationChecklist`, `SchedulePicker`.
- **Admin shell:** `app/admin/layout.tsx` — under `/admin/resources/*`, the left sidebar shows Resources Hub sub-navigation (Dashboard, Content List, Calendar, Queue, Backlog, Settings, **Help** → `/admin/help`). Elsewhere (including **`/admin/help`**), the sidebar shows top-level Admin nav (Resources, Shops, Jobs, Audit Log, Billing, Help) so the guide is not nested under Resources Hub (avoids duplicate labels like “Dashboard”). Top bar, mobile responsive.
- **Admin dashboard:** `app/admin/resources/page.tsx` + `dashboard-client.tsx` — 4 KPI cards, upcoming scheduled, translation gaps, queue health, recently edited table.
- **Admin content list:** `app/admin/resources/list/page.tsx` + `list-client.tsx` — status tabs with counts, search + filter (type, topic), multi-select with bulk actions, locale indicators, pagination.
- **Admin API (list):** `GET /api/admin/resources/content?status=&contentType=&topic=&search=&page=&pageSize=` — paginated, filterable content list for the admin UI.
- **Admin API (editor):** `GET/PUT /api/admin/resources/content/[id]` — load full content item for editor (item + localizations + tags + revisions), save item fields + per-locale data + workflow transitions + schedule.
- **Block editor:** `app/admin/resources/content/[id]/editor-client.tsx` — custom block editor with 13 block types (html, paragraph, heading, list, callout, code, quote, divider, image, key-takeaways, faq, disclaimer, update-log). Blocks reorderable, add/remove. Locale tabs with completeness badges.
- **Body adapter:** `lib/resources/body-adapter.ts` — bidirectional `bodyJsonToBlocks` / `blocksToBodyJson` converting legacy `{mainHtml, keyTakeaways, faq, disclaimer, updateLog}` ↔ `EditorBlock[]`.
- **Block renderer:** `components/admin/editor/BlockRenderer.tsx` — per-type inline editors for all 13 block types with type indicators and drag controls.
- **Backlog page:** `app/admin/resources/backlog/` — ideas pipeline with 4 KPI cards, search/filter (priority, status), reorderable table, convert-to-draft action.
- **Calendar page:** `app/admin/resources/calendar/` — agenda view (posts grouped by date), calendar grid view (7-col Mon–Sun with dot indicators), month navigation, queue health panel.
- **Queue page:** `app/admin/resources/queue/` — 4 status stat cards, filter tabs (all/pending/processing/succeeded/failed), card-based item list with error display, retry actions, system status panel.
- **Settings page:** `app/admin/resources/settings/` — publishing (time, weekend, auto-save), translation (skip incomplete, locale priority), workflow (reviewer, archive threshold, CTA), legal (disclaimer, review email), AI autopilot, and **Run scheduled tasks now** (manual autopilot + publish-queue triggers). Auto-saves via debounced PUT to `/api/admin/resources/settings`.
- **Mobile editor:** Responsive editor with Content/Metadata/Checklist tab bar, locale picker bottom sheet, fixed bottom action bar (Save/Schedule/Publish).
- **Toast system:** `components/admin/Toast.tsx` — `ToastProvider` + `useToast()` hook for success/error/info notifications across admin.
- **Cron:** `GET` or `POST` `/api/cron/publish-content` runs `publishLocalization` from `lib/resources/publish` after validation.
- **Queries (public):** `lib/resources/queries.ts`, locale mapping `lib/resources/localeMap.ts`.

### Public URLs, hub locales, and pillars

- **Article path (resources):** `/{localePrefix}/resources/{primary_pillar}/{slug}`. Default English omits the locale segment (`/resources/chargebacks/my-article`). Other marketing locales use the short prefix from `lib/i18n/pathLocales.ts` (e.g. `/pt/resources/...` for `pt-BR`).
- **Pillar segment:** Required. Allowed values match `content_items.primary_pillar` and `lib/resources/pillars.ts` (`chargebacks`, `dispute-resolution`, `small-claims`, `mediation-arbitration`, `dispute-management-software`). Generation resolves/normalizes pillar from archive data; publish rejects invalid pillars.
- **Legacy slug-only URLs:** A single segment after `/resources/` that is not a pillar name is treated as a **slug**: `app/[locale]/resources/[pillar]/page.tsx` looks up a published localization and **redirects** to `/resources/{pillar}/{slug}`.
- **Hub DB locales (`content_localizations.locale`):** `en-US`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, `sv-SE` — see `lib/resources/constants.ts` (`HUB_CONTENT_LOCALES`). Portuguese uses **`pt-BR`** (aligned with app `LOCALE_LIST` and `/pt` paths); migration `20260328144057_hub_locale_pt_br.sql` migrated existing `pt-PT` rows.
- **Autopilot / email:** `lib/email/sendPublishNotification.ts` builds “View article” links with locale prefix + `/resources/{pillar}/{slug}`. Post-publish hooks in `publish-content` cron load `primary_pillar` via a joined `content_items` select.
- **Sitemap / IndexNow:** `app/sitemap.ts` and `lib/seo/indexnow.ts` use the same locale prefixes and include the pillar segment for resources URLs.

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
- `prompts.ts` — Built-in **system prompt** (SEO, domain, originality) and **default user suffix** (anti-repetition). Per-locale tone lines and content-type lines. `buildUserPrompt(brief, locale, resolved, context)` injects **similar published articles** into the user message (titles, slugs, excerpts, headings, intro snippets). *Prompt-only “don’t repeat” rules are insufficient without this peer list.* `resolveGenerationPrompts(cmsSettings)` merges `cms_settings.settings_json`: non-empty `generationSystemPrompt` overrides the built-in system prompt; `generationUserPromptSuffix` overrides the built-in suffix **only if the key is present** in JSON (empty string = no extra suffix block). If the key is **omitted**, the built-in anti-repetition suffix applies. Per-locale / per-content-type maps still ignore empty override values.
- `similarArticles.ts` — `fetchSimilarPublishedArticles(brief, locale, routeKind)` returns up to ~10 scored peers (published, same locale/route, heuristic match on type/pillar/keyword/title).
- `similarity.ts` — Deterministic post-check: slug collision (DB or peer list), title Jaccard overlap, title+excerpt overlap. Failed check → **one** model retry with an explicit “too similar” instruction → second failure returns a clear error (no `content_items` insert).
- `htmlSnippet.ts` — Extracts headings / intro snippet from `mainHtml` for the overlap block.
- `contentRouteKind.ts` — `routeKindForContentType()` maps `content_type` → `content_localizations.route_kind` (slug scope + similar-article query).
- `generate.ts` — OpenAI Chat Completions (`generateForLocale` per locale with `GenerationContext`; `generateAllLocales` runs locales in parallel with similarity guard + retry). Temperature: `0.3` for `legal_update`, else `0.4`.
- `pipeline.ts` — `loadArchiveForGeneration()` / `runGenerationPipeline()`: **idempotency** — if `content_archive_items.created_from_archive_to_content_item_id` is already set, returns an error and the existing `content_item` id (no second draft). Loads CMS settings → fetches similar articles per target locale → generates → creates `content_items` + `content_localizations` + `content_revisions` → links archive row. `buildBriefFromArchive()` remains for callers that only need a brief (returns `null` if archive missing or already converted).

**Admin-editable prompts** (stored in `cms_settings.settings_json`, edited at **Admin → Resources → Settings → AI generation prompts**):
- `generationSystemPrompt` — Full system message (optional; if blank, built-in default from `prompts.ts` is used). UI toggle shows the built-in text read-only when using defaults.
- `generationUserPromptSuffix` — Appended under “Additional instructions” before the final JSON instruction. **Omit this key** in saved JSON (admin saves blank field without key) to use the built-in anti-repetition block; set to `""` explicitly to disable the extra block.
- `generationLocaleInstructions` — Partial map of locale → style line; non-empty values override defaults.
- `generationContentTypeInstructions` — Partial map of `content_type` → instruction line; non-empty values override defaults.

**API Routes**:
- `POST /api/admin/resources/generate` — Triggers pipeline for an archive item. Returns 503 if disabled; **207** if `error` is set but `contentItemId` is present (e.g. archive already converted); 500 on hard failure; 200 on success.
- `POST /api/admin/resources/cron/autopilot` — Manual run of the autopilot cron (admin session). Same behavior as `GET /api/cron/autopilot-generate` with `CRON_SECRET`.
- `POST /api/admin/resources/cron/publish` — Manual run of the publish-queue cron (admin session). Same behavior as `GET /api/cron/publish-content` with `CRON_SECRET`.
- `POST /api/admin/resources/ai-assist` — In-editor AI tools: `improve_readability`, `generate_meta`, `suggest_related`. Each calls OpenAI with task-specific system prompts.

**Editor Integration**:
- `AIAssistantPanel` component (`components/admin/editor/AIAssistantPanel.tsx`) — Sidebar panel with three AI actions. Results can be applied directly to editor state.

**Backlog Integration**:
- "Generate" button on each backlog item triggers `POST /api/admin/resources/generate`, then redirects to editor for the newly created draft.

**Shopify chargeback launch cluster (content briefs in DB):**
- Editorial spec + linking plan: `docs/content-briefs/shopify-chargeback-cluster-launch.md`.
- Seed eight `content_archive_items` rows (idempotent by `proposed_slug`): `npm run seed:shopify-chargeback-cluster` (`scripts/seed-shopify-chargeback-cluster.mjs`). Pillar uses `content_type = pillar_page` and highest `priority_score` so autopilot picks it first.
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
- `POST /api/auth/portal/sign-out` — sign out portal user
- `GET /api/portal/clear-shop` — no Shopify session required (exempt in middleware). Clears active-shop cookies and redirects to `/portal/connect-shopify` so the user can reconnect. Used by the portal sidebar link "Clear shop & reconnect".

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

### Shopify OAuth
- `GET /api/auth/shopify` — start OAuth (accepts `source=portal` + `return_to`).
  Always responds with 302 redirect to Shopify’s authorize URL. State is encoded
  as a signed token (not a cookie) via `encodeOAuthState()`.
- `GET /api/auth/shopify/callback` — verify HMAC + signed state token, exchange
  code for access token, store session. Sets `shopify_shop` and `shopify_shop_id`
  cookies with `sameSite: "none"` so they are sent when the app is loaded in
  Shopify Admin’s iframe. For `source=portal`: links the portal user to the shop,
  sets `active_shop_id` cookie, and redirects to `/portal/dashboard`.

### Dashboard Stats (Embedded)
- `GET /api/dashboard/stats?shop_id=...&period=24h|7d|30d|all` — returns real KPIs for the embedded dashboard: `totalDisputes`, `winRate`, `revenueRecovered`, `avgResponseTime`, `winRateTrend` (6 buckets), `disputeCategories` (by reason). Period filters disputes by `created_at`.

### Shop Preferences (Embedded Settings)
- `GET /api/shop/preferences?shop_id=...` — returns notification preferences from `shop_setup.steps.team.payload.notifications` (newDispute, beforeDue, evidenceReady). Used by embedded Settings page.
- `PATCH /api/shop/preferences` — body `{ shop_id, notifications: { newDispute?, beforeDue?, evidenceReady? } }`. Merges into team step payload and upserts `shop_setup`. Used to persist notification toggles.

### Automation
- `GET /api/automation/settings?shop_id=...` — read shop automation settings
- `PATCH /api/automation/settings` — update automation toggles
- `POST /api/disputes/sync` — enqueue dispute sync job
- `POST /api/packs/:packId/approve` — approve pack for save + enqueue job

### Authenticated (shop context required)

Shop context is provided by either (1) Shopify session cookies (embedded app) or (2) Supabase Auth + active_shop (portal) for the routes listed under "Portal API prefixes" above.

- `GET /api/disputes` — list disputes (portal: pass `shop_id` query; embedded: shop from cookies)
- `GET /api/disputes/:id` — single dispute
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
- `GET /api/templates?locale=&category=` — list pack templates (portal Packs page; filter `is_recommended` for suggested)
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
- `progress.total` / `doneCount` count all 8 onboarding steps (`permissions` + `open_in_admin` included); `nextStepId` is the next actionable `todo` step based on prerequisites.

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

### Completeness Gate

Pack preview pages show a yellow warning banner when `completeness_score < 60%`:
- Lists missing required checklist items.
- Guidance only — merchant can still proceed.

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

### UX Compliance

All UI labels say "Save evidence." Never "Submit response" or "Submit to card network."

## Billing & Plan Limits

### Plans

| Plan | Price | Packs/Month | Auto-Pack | Rules |
|------|-------|-------------|-----------|-------|
| Free | $0 | 3 | No | No |
| Starter | $29/mo | 50 | Yes | Yes |
| Pro | $79/mo | Unlimited | Yes | Yes |

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
- V1: env-based `ADMIN_SECRET` validated against a password input.
- HTTP-only session cookie (`dd_admin_session`, 8h TTL, path `/` so it is sent to both `/admin/*` pages and `/api/admin/*` routes).
- Middleware redirects unauthenticated `/admin/*` requests to `/admin/login`.

### Pages
| Route | Purpose |
|-------|---------|
| `/admin` | Dashboard — active shops, disputes, packs, job queue, plan distribution |
| `/admin/shops` | Searchable shop list with plan/status filters |
| `/admin/shops/[id]` | Shop detail + admin overrides (plan, pack limit, notes) |
| `/admin/jobs` | Job monitor with status filters, stale detection, retry/cancel actions |
| `/admin/audit` | Audit log viewer with shop/type filters, expandable payloads, CSV export |
| `/admin/billing` | MRR, plan distribution, per-shop monthly usage |

### API Routes
- `POST /api/admin/login` — authenticate with admin secret
- `GET /api/admin/logout` — clear session
- `GET /api/admin/metrics` — aggregated dashboard data
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
- **Hreflang / alternates:** `app/[locale]/layout.tsx` sets `metadata.alternates.languages` using BCP-47 keys (`en-US`, `de-DE`, …) pointing to the correct path for each language, plus `x-default` → `/`. Canonical URLs follow the same paths (English home is `/`, not `/en`).
- **Crawlers (e.g. Googlebot):** Each language is a **distinct, indexable URL** with reciprocal `hreflang`-style annotations in the document head. That is what Google recommends for multilingual pages: separate URLs per language version and consistent `link rel="alternate" hreflang="…"` (exposed here via Next.js `metadata.alternates`). Ensure pages are not blocked by `robots.txt` and return `200` for each locale URL. A **sitemap** listing `/`, `/de`, `/es`, … is optional but can help discovery; the repo does not yet ship a locale-aware sitemap generator.

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

An 8-step guided setup wizard helps merchants configure DisputeDesk after
installation. Progress is tracked per-shop in the `shop_setup` table and surfaced on the
dashboard via a Setup Checklist card with a ring progress indicator.

**Billing, Settings, and Help** are app sections (reachable from nav) but are **not** part of the onboarding checklist.

### Wizard Steps (onboarding only)

| # | ID | Title | Prerequisites |
|---|-----|-------|---------------|
| 1 | `permissions` | Connect your store | — |
| 2 | `open_in_admin` | Open in Shopify Admin | `permissions` |
| 3 | `overview` | Overview & Goals | `permissions`, `open_in_admin` |
| 4 | `disputes` | Disputes | `permissions` |
| 5 | `packs` | Evidence Packs | `disputes` |
| 6 | `rules` | Automation Rules | — |
| 7 | `policies` | Business Policies | `disputes` |
| 8 | `team` | Team & Notifications | — |

Legacy step ids (`welcome_goals`, `sync_disputes`, etc.) are migrated to the new ids when reading `shop_setup.steps` (see `LEGACY_STEP_ID_MAP` in `lib/setup/constants.ts`).

### Step 5: Generate Packs

**Current state (as of 2026-03-18):** The setup step displays a **template catalog** fetched from `GET /api/templates`. Each template appears as a card with name, dispute type badge, recommended badge, and an **Install** button. Clicking Install opens a 4-step **Template Setup Wizard** modal (`TemplateSetupWizardModal`):

1. **Choose Evidence** — Select from 8 evidence types (Order Details, Customer Info, Shipping, Product, Policies, Communication, Payment Proof, Custom Fields). Types are grouped as auto-collected vs manual. Recommended types are pre-selected.
2. **Set Sources** — Displays available data sources per selected evidence type with status badges (Connected / Setup Required / Available).
3. **Review** — Shows the 4-step automation flow: Detection → Collection → Pack Creation → Notification.
4. **Activate** — Summary of evidence configuration + green activation banner.

On wizard completion the template is installed via `POST /api/templates/:id/install`. The card flips to a green "Installed" state with a checkmark. On "Save & Continue", all installed template IDs are recorded in `shop_setup.steps.packs.payload.installedTemplates`.

Evidence type definitions and source mappings live in `lib/setup/evidenceTypes.ts`. The wizard is client-side only (no new API routes). i18n keys: `setup.packs.*` and `setup.templateWizard.*` in `messages/en-US.json`.

### Step 6: Automation Rules (`AutomationRulesStep`)

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

### State Machine

Per-shop state persisted in `shop_setup` table:
- Step statuses: `todo | in_progress | done | skipped`.
- Each step has an optional `payload` (JSON) and `skipped_reason`.
- "Save & Continue" marks done. "Skip for now" marks skipped with reason. "Undo skip" resets to todo.
- Light gating: `permissions` → `overview` → `disputes` → `packs`; `disputes` → `policies`.

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
| AutomationRulesStep | `components/setup/steps/AutomationRulesStep.tsx` | Automation & review onboarding: presets, General default, per-reason cards, safeguards, live summary |

### Shared Utilities

| Module | Path | Purpose |
|--------|------|---------|
| Types | `lib/setup/types.ts` | StepStatus, StepState, ShopSetupRow, etc. |
| Constants | `lib/setup/constants.ts` | SETUP_STEPS, prerequisite logic, helpers |
| Evidence Types | `lib/setup/evidenceTypes.ts` | 8 evidence type definitions + source mappings |
| Events | `lib/setup/events.ts` | `logSetupEvent()` → app_events table |
| withShopParams | `lib/withShopParams.ts` | Preserve shop/host params in URLs |

### Step 7: Business Policies (`BusinessPoliciesStep`)

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
- **Data:** `lib/help/embedded.ts` defines which article slugs are available in the app (`EMBEDDED_ARTICLE_SLUGS`), ordered categories, and optional copy overrides. Portal-only articles (e.g. `template-setup-wizard`) are excluded from the embedded list.
- **Copy:** Embedded UI strings (title, search, backToHelp, etc.) and selected article bodies use the `help.embedded` i18n namespace in `messages/{locale}.json`. Where `EMBEDDED_ARTICLE_COPY_OVERRIDES` is set, titles and bodies are taken from `help.embedded.articles.{slug}.title` / `.body`; otherwise the shared `help.articles.*` keys are used.
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
| Settings UI | `app/admin/resources/settings/settings-client.tsx` | Autopilot toggle, articles/day, email config |
| Pipeline | `lib/resources/generation/pipeline.ts` | `PipelineOptions.autopilot` flag — auto-publishes, enqueues |
| Publish prerequisites | `lib/resources/generation/publishPrerequisites.ts` | Ensures author, primary CTA, ≥3 tags so `publishLocalization` succeeds |
| Daily Cron | `app/api/cron/autopilot-generate/route.ts` | Picks highest-priority backlog items, calls pipeline |
| Publish Cron | `app/api/cron/publish-content/route.ts` | Drains `content_publish_queue`, sends autopilot email after successful publish |
| Publish Email | `lib/email/sendPublishNotification.ts` | Resend-based email with article link |

**Settings** are stored in `cms_settings.settings_json` (existing pattern). New fields: `autopilotEnabled`, `autopilotArticlesPerDay`, `autopilotNotifyEmail`, `autopilotStartedAt`, and `defaultCta` (e.g. `free_trial` — matches `content_ctas.event_name`).

**Publish prerequisites (generation):** Before inserting `content_items`, `ensurePublishPrerequisites()` loads or creates default `authors`, `content_tags` (three stable keys: `chargebacks`, `shopify`, `merchant-resources`), and resolves **primary CTA**: prefers `content_ctas` where `event_name` equals **Settings → Default CTA** (`defaultCta`), otherwise first CTA row, otherwise a generic external CTA. Migration `20260328123100_seed_hub_content_ctas_presets.sql` seeds preset CTAs (`free_trial`, `demo_request`, `newsletter`, `download`) so the admin dropdown resolves to real rows.

**5-day burst:** When autopilot is first enabled, `autopilotStartedAt` is recorded. The cron checks how many articles have been auto-published since that timestamp. If fewer than 5, it generates 1/day until the burst is complete.

**Pipeline autopilot flag:** When `options.autopilot = true`, the pipeline sets `workflow_status = "published"` and auto-enqueues all localizations in `content_publish_queue` for immediate processing.

### Cron Schedule

In `vercel.json`:
```json
{ "path": "/api/cron/autopilot-generate", "schedule": "0 8 * * *" },
{ "path": "/api/cron/publish-content", "schedule": "0 9 * * *" }
```
- **08:00 UTC** — autopilot generation (`/api/cron/autopilot-generate`). Requires `CRON_SECRET` (Vercel injects `Authorization: Bearer` when the env var is set).
- **09:00 UTC** — publish queue + email (`/api/cron/publish-content`). Same secret.

**Manual test:** `GET` or `POST` the route with header `Authorization: Bearer <CRON_SECRET>` (or `x-cron-secret: <CRON_SECRET>`). Example: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<deployment>/api/cron/autopilot-generate"`.

## SEO & Search Engine Indexing (CH-8)

### Sitemap

`app/sitemap.ts` (Next.js metadata API) generates a dynamic XML sitemap:
- All published `content_localizations` with `hreflang` alternates per locale.
- Static pages: root, resources, glossary, templates, case studies.
- Locale URL prefixes: en-US = root, de-DE = `/de`, fr-FR = `/fr`, es-ES = `/es`, pt-BR = `/pt`, sv-SE = `/sv`.

### Robots.txt

`app/robots.ts` serves a robots.txt that allows all crawlers on public routes and disallows `/admin/`, `/api/`, `/app/`, `/portal/`, `/auth/`.

### IndexNow

`lib/seo/indexnow.ts` implements:
- **IndexNow API call** (`POST https://api.indexnow.org/indexnow`) — instant indexing on Bing, Yandex, Seznam, Naver.
- **Key verification:** `keyLocation` points to `https://{host}/{INDEXNOW_KEY}.txt`; the key file is served from `public/{INDEXNOW_KEY}.txt` at the site root.

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
