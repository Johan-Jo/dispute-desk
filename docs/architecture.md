# Architecture — DisputeDesk (Dispute Ops)

## Overview

DisputeDesk is a Shopify chargeback evidence governance app with **two surfaces**:

1. **Embedded App** — lives inside Shopify Admin (Polaris + App Bridge).
2. **External Portal** — standalone SaaS web app + marketing landing page.

Both share the same Next.js codebase, Supabase database, and API routes.

## Two Surfaces

| Surface | Route group | Auth model | UI toolkit | Purpose |
|---------|-------------|------------|------------|---------|
| Marketing | `[locale]` — `/` (default English), `/de`, `/es`, … | None (public) | Tailwind | Acquisition landing page (locale-aware SEO URLs) |
| Portal Auth | `(auth)` — `/auth/*` | None (public) | Tailwind | Sign in / sign up / reset |
| Portal App | `(portal)` — `/portal/*` | Supabase Auth | Tailwind | SaaS web for merchants + team |
| Embedded App | `(embedded)` — `/app/*` | Shopify session | Polaris + App Bridge | Inside Shopify Admin |
| API | `/api/*` | Mixed (see below) | — | Backend routes |

### Why two surfaces?

The embedded app is the primary experience for merchants who install from the
Shopify App Store. The external portal serves:
- Team members who don't have Shopify Admin access.
- Merchants who prefer a standalone SaaS experience.
- Multi-store operators who want a single dashboard across shops.
- Public marketing and acquisition (hero landing page).

**Marketing → embedded billing:** The public landing page **Pricing** section links to `/app/billing?plan=free|starter|growth|scale` so merchants who already use the embedded app land on Billing with the correct tier selected or upgrade flow started. Unauthenticated visitors are handled by existing `/app/*` session rules (see `docs/technical.md` § *Billing deep link*).

### Route group isolation

Next.js App Router route groups ensure:
- Marketing pages never load Polaris or App Bridge scripts.
- Portal pages use Supabase Auth (email/password, magic link).
- Embedded pages use Shopify session tokens.
- Each group has its own `layout.tsx` with appropriate providers.

### UI toolkit split

| Surface | CSS / Components | Icons |
|---------|-----------------|-------|
| Embedded | Polaris (Shopify design system) | Polaris built-in |
| Portal + Marketing + Auth | Tailwind CSS + `components/ui/*` (CVA) | lucide-react |

The shared component library lives in `components/ui/` and uses
`class-variance-authority` for type-safe variants plus `clsx` /
`tailwind-merge` for conditional class merging. Design tokens are defined
as CSS custom properties in `app/globals.css` (prefixed `--dd-*`).
See [`docs/technical.md`](technical.md) for the full component catalog.

## System Diagram

```
┌─────────────────────────────────┐    ┌──────────────────────────────────┐
│  Marketing (/)                  │    │    Shopify Admin (embedded UI)   │
│  Public landing, Tailwind       │    │    Polaris + App Bridge React    │
└──────────────┬──────────────────┘    └──────────────┬───────────────────┘
               │                                      │
┌──────────────▼──────────────────┐                   │
│  Portal (/portal/*)             │                   │
│  Supabase Auth, Tailwind        │                   │
└──────────────┬──────────────────┘                   │
               │                                      │
               └──────────┬──────────────────────────-┘
                          │ HTTPS
               ┌──────────▼───────────────────┐
               │    Next.js Node Runtime      │
               │                              │
               │  ┌──────────┐  ┌───────────┐ │
               │  │ OAuth /  │  │ API Routes│ │
               │  │ Session  │  │ /api/*    │ │
               │  │ Middleware│  │           │ │
               │  └──────────┘  └─────┬─────┘ │
               │                      │       │
               │  ┌───────────────────▼─────┐ │
               │  │   Job Worker            │ │
               │  │   (cron → claim → exec) │ │
               │  └─────────────────────────┘ │
               └──────────────┬───────────────┘
                              │
                  ┌───────────┼────────────┐
                  │           │            │
                  ▼           ▼            ▼
            ┌──────┐    ┌────────┐   ┌──────────────────┐   ┌────────┐
            │Shopify│    │Supabase│   │Supabase Storage  │   │External│
            │GraphQL│    │Postgres│   │(evidence-packs,  │   │APIs    │
            │Admin  │    │+ Auth  │   │ evidence-uploads,│   │(Gorgias│
            │API    │    │(RLS)   │               │ evidence-samples,│   │ etc.)  │
            │ policy-uploads) │   │        │
            └──────┘    └────────┘   └──────────────────┘   └────────┘
```

## Auth Model

### Shopify OAuth (Embedded App)

- **Offline session** (shop-wide): used for background sync, job execution,
  and all read operations. Stored encrypted with key versioning.
- **Online session** (user-scoped): required for `disputeEvidenceUpdate`
  (Epic 5) which operates in merchant-user context. Stored with `user_id`
  and `expires_at`.

### Supabase Auth (External Portal)

- Portal users authenticate via Supabase Auth (email/password, magic link, or Shopify OAuth).
- Session is stored as an HTTP-only cookie by Supabase SSR helpers.
- Portal users connect Shopify stores via OAuth. This creates:
  - A `shops` row (or finds existing).
  - An offline session (same as embedded).
  - A `portal_user_shops` row linking the portal user to the shop.

### Internal Admin (`/admin`)

- Uses the **same Supabase Auth session** as the portal (single sign-on cookie).
- Authorization is **not** implied by portal membership: a separate table,
  `internal_admin_grants`, maps `auth.users.id` to allowed operators (`is_active`, audit fields).
- Middleware requires a valid session **and** an active grant; API routes re-check via `hasAdminSession()`.
- Granting the first operator is done with a service-role script (`npm run add:admin-user`) or SQL; subsequent grants use **Admin → Team** in the UI.

### Supabase DB Access

Supabase is **server-only** for data access. All database queries go through
Next.js API routes using the service role key.

- The anon key is used ONLY for Supabase Auth (portal sign-in/sign-up).
- RLS is enabled on all tables as a defense-in-depth backstop.
- Shop isolation is enforced in application code by verifying the Shopify
  session (embedded) or the `portal_user_shops` link (portal).

### Portal → Shop Access Flow

#### Email / password sign-up

1. User fills the sign-up form → Supabase sends a confirmation email.
2. User clicks the confirmation link → browser hits `GET /api/auth/confirm?code=…&type=signup`.
3. Confirm route exchanges the PKCE code for a session, sends a welcome email (locale-aware) and an admin notification, then redirects to `/portal/dashboard`.
4. User connects a Shopify store separately via the portal.

#### "Continue with Shopify" (sign-up or sign-in)

This flow connects the store, signs the user into the portal (if needed), then sends them to the **embedded app in Shopify Admin** to continue setup there.

1. User clicks **Continue with Shopify** on the sign-in or sign-up page and enters their store domain.
2. Browser is sent to `GET /api/auth/shopify?source=portal&return_to=/auth/open-in-shopify`.
3. Shopify OAuth completes → callback at `GET /api/auth/shopify/callback`.
4. Callback creates/updates the `shops` row, stores an offline session, registers webhooks.
5. **Already signed in** (Supabase session cookie present): shop is linked to the current user; welcome email + admin notification sent on first shop only.
6. **Not signed in** — callback fetches the shop owner's email from Shopify GraphQL, then:
   - **New user**: `admin.generateLink({ type: 'signup' })` creates an auto-confirmed Supabase user, returns an `action_link`.
   - **Existing user**: `admin.generateLink({ type: 'magiclink' })` returns an `action_link` for the existing account.
   - In both cases the shop is linked immediately and the browser is redirected to `action_link` → Supabase sets the session → user lands on **`/auth/open-in-shopify`** (same-origin redirect URL required by Supabase). No email confirmation step, no extra clicks.
7. `active_shop_id` and `dd_active_shop` cookies are set on the redirect response so the portal scopes to the connected shop.
8. **`/auth/open-in-shopify`** verifies the session and active shop, then redirects to `https://{shop}/admin/apps/{SHOPIFY_API_KEY}` so the merchant continues in the embedded app. **Supabase Auth** must allowlist `{APP_URL}/auth/open-in-shopify` as a redirect URL.

For multi-store users, the sidebar store selector links to `/portal/select-store` where they can switch between connected shops and the demo store.

**Portal sidebar links (under the store row):** Behavior depends on whether a **real** linked shop is active (the active-shop cookie matches a `portal_user_shops` row for the user):

- **Real shop active:** Shows **Switch to demo store** → `/portal/select-store?shop_id=demo` → `GET /api/portal/switch-demo` (sample data, same as choosing Demo on the store picker).
- **Demo active but the user has linked shops:** Shows **Connect your real store** → `/portal/connect-shopify`.
- **At least one linked shop:** **Clear shop & reconnect** → `GET /api/portal/clear-shop` (always available in that case). This route is exempt from the API middleware's Shopify-session requirement so portal-only users (who may have no Shopify cookies) can use it. It clears the active-shop cookies and redirects to `/portal/connect-shopify` for a fresh connect flow.

**Portal APIs**: The middleware allows certain API prefixes without Shopify session cookies when the user has Supabase Auth and a valid `active_shop_id` in `portal_user_shops`: `/api/setup/`, `/api/integrations/`, `/api/files/samples`, and `/api/disputes`. So the portal disputes page (list, Sync Now, dispute detail) and setup/integrations/sample-files flows work with Supabase + active-shop only. See `docs/technical.md` § API middleware — shop identity and portal fallback.

**Demo vs real data**: When no shop is selected, the portal runs in demo mode (placeholder UI). Only the store domain `demo.myshopify.com` is treated as a demo-data store; all other connected stores (including development stores) get live dispute data and sync. See `docs/technical.md` § Portal demo mode & test stores.

### Cookieless OAuth State

Shopify OAuth state is carried in a **signed token** instead of cookies.
`encodeOAuthState()` packs `{ nonce, phase, source, returnTo }` into a
base64url payload with an HMAC-SHA256 signature, passed as the `state`
parameter. The callback verifies the signature with `decodeOAuthState()`.
This avoids cross-site cookie issues that occur when the OAuth flow
starts inside a Shopify Admin iframe.

### Embedded session cookies

The callback sets `shopify_shop` and `shopify_shop_id` with **`sameSite: "none"`**
(and `secure: true`) so the browser sends them when the app is loaded in
Shopify Admin’s iframe. Without this, the middleware would not see the
session and would redirect to auth again (redirect loop). The auth route
always responds with a 302 redirect to Shopify OAuth; no HTML breakout
page is used.

### Why no JWT shop_id claims?

V1 does not rely on custom Supabase JWT claims for shop isolation. The
Shopify session (offline or online) is the source of truth for the
authenticated shop. This avoids complexity around claim issuance and
keeps the auth surface small.

## Async Job Architecture

All heavy operations run as async jobs to avoid serverless function
timeouts:

| Job type | Trigger | Handler |
|----------|---------|---------|
| `sync_disputes` | Cron (every 2–5 min) or manual | Fetch disputes from Shopify, upsert, trigger automation pipeline |
| `build_pack` | Automation pipeline or manual | Collect sources, score completeness, evaluate auto-save gate |
| `render_pdf` | Manual request | Render PDF, upload to Storage |
| `save_to_shopify` | Auto-save gate or manual approve | Push evidence to Shopify via GraphQL |

### Execution model

1. Trigger creates the resource and enqueues a job row.
2. Route returns `202 Accepted` with `jobId` for polling.
3. Vercel Cron calls `POST /api/jobs/worker` every 2 minutes.
4. Worker claims queued jobs using `SELECT ... FOR UPDATE SKIP LOCKED`.
5. Handler executes the work, updates status, writes audit events.
6. UI polls `GET /api/jobs/:id` until `succeeded` or `failed`.

Per-shop concurrency: 1 running job at a time (V1).
Retry: up to 3 attempts with 30s × attempt backoff.

## Shopify API Version

Pinned centrally in `lib/shopify/client.ts`:

```
SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-01"
```

All GraphQL calls go through `requestShopifyGraphQL()` which uses this
version, implements retry with exponential backoff + jitter for throttling
(429, THROTTLED errors, 5xx), and never logs access tokens.

## Data Flow (V1) — Automation-First

DisputeDesk operates as an **automation-first** pipeline. The default
behavior is fully automatic; merchants configure gates and thresholds.

### Automatic flow (default)

1. **Sync** — `sync_disputes` cron job (or manual trigger) fetches disputes
   from Shopify GraphQL, upserts into `disputes` table.
2. **Auto-build** — for each new/updated dispute, `runAutomationPipeline()`
   checks `shop_settings.auto_build_enabled`. If ON, creates an
   `evidence_packs` row and enqueues a `build_pack` job.
3. **Build** — worker collects sources (order, fulfillment, policies),
   writes `evidence_items` + `audit_events`, runs the completeness engine
   (per-reason templates → score + blockers + recommended actions).
4. **Auto-save gate** — `evaluateAndMaybeAutoSave()` checks:
   - `auto_save_enabled` on store settings
   - `completeness_score >= auto_save_min_score`
   - `blockers == 0` (if `enforce_no_blockers`)
   - `require_review_before_save` (parks pack for manual approval)
5. **Save** — if gates pass, enqueues `save_to_shopify` job → worker
   calls `disputeEvidenceUpdate` with evidence GID → logs audit event →
   updates pack status to `saved_to_shopify`.
6. **Review queue** — if review is required, pack stays in `ready`
   status. Merchant clicks "Approve & Save" → triggers save job.
7. **Submit** — merchant finalizes in Shopify Admin (or Shopify
   auto-submits on the dispute due date).

### Manual overrides

Merchants can always:
- Trigger a manual sync (`POST /api/disputes/sync`)
- Generate a pack manually (existing `build_pack` flow)
- Approve a parked pack (`POST /api/packs/:packId/approve`)

### Pack status flow

```
queued → building → ready → saved_to_shopify
                  → blocked (missing required evidence)
                  → ready (parked for review) → approve → saved_to_shopify
                  → failed
```

### Automation settings (per store)

| Setting | Default | Description |
|---------|---------|-------------|
| auto_build_enabled | true | Auto-create packs on new disputes |
| auto_save_enabled | false | Auto-push evidence to Shopify |
| require_review_before_save | true | Park packs for manual approval |
| auto_save_min_score | 80 | Min completeness score for auto-save |
| enforce_no_blockers | true | Block save if required items missing |

Settings are stored in `shop_settings` (010_automation.sql) with
auto-upsert via `ensure_shop_settings()` RPC.

## Cross-Cutting: Two-Surface UX Copy Compliance

Both surfaces (embedded + portal) must use "Save evidence" language — never
"submit response" or "submit dispute". The CI `forbidden-copy` grep check
covers all source files and translation files.

Portal always deep-links to Shopify Admin for final submission.

## Setup Wizard & Onboarding

DisputeDesk includes a guided setup wizard (`/app/setup/[step]`). After optional steps (permissions, open in admin) and welcome/goals, the main wizard flow is: **sync disputes → policies → pack templates → automation & review queue → team**. Billing, settings, and help are app sections only (not part of the onboarding checklist). The wizard is embedded within Shopify Admin using Polaris and preserves `shop`/`host` query params for App Bridge compatibility.

### Packs step vs Rules step (product model)

- **Packs:** Installing a template creates the shop’s **pack library** (`packs`, sections, narratives). IDs are stored in `shop_setup.steps.packs.payload.installedTemplates` when the step completes. The **Evidence packs** wizard step highlights **activated** rows (`packs.status = ACTIVE`) where the UI shows what is “live.” Installs can remain **DRAFT** until activation.
- **Automation & review (setup):** Lists **every template-backed library pack** that is not archived (`listLibraryPacksForAutomationRules` — **DRAFT** and **ACTIVE**), ordered oldest-first, with per-pack handling (**Manual review** vs **Automatic**) so merchants configure routing for each installed template, not only activated packs.
- **Rules:** Starter rules in the `rules` table are evaluated when a **new** dispute syncs (`auto_pack` → automation pipeline; `review` → `needs_review`). This is **routing**, not “pick library template X for the build.”
- **Embedded Rules page** (`/app/rules` in the Shopify app): Presents the four **suggested starter rules** from `lib/rules/presets.ts` with per-rule **Auto-Pack** vs **Send to Review** and **Save starter rules**; optional **Other rules** lists custom portal-created rules. Also lists **ACTIVE** library packs for context (narrower than the setup automation list).
- **Onboarding UI (Automation & review step):** The setup wizard presents routing as **presets → default (General) → optional per-reason cards → safeguards → live summary**, plus **per installed library pack** handling, so first-time merchants see a decision flow instead of a single settings table. At least one installed pack template is required before template assignment and the full **Automatic** preset is enabled. See [`docs/technical.md`](technical.md) § *Step 6: Automation Rules*.
- **Build:** `buildPack` uses source collectors; it does not currently merge library template structure into automated per-dispute builds. See [`docs/technical.md`](technical.md) (*Rules vs library packs*).

### Dashboard Integration

The merchant dashboard displays a **Setup Checklist** card with:
- SVG ring progress indicator (completed / total steps).
- Checklist rows for each step with done/incomplete/skipped states.
- "Continue setup" button navigating to the next actionable step.
- "Book a 15-min setup call" link.

### State Persistence

Wizard state is stored in `shop_setup` (one row per shop):
- `steps` JSONB column: per-step `{ status, payload, skipped_reason }`.
- Light prerequisite gating between specific steps.
- All state mutations logged to `app_events`.

### Third-Party Integrations

The wizard supports connecting external services (V1: Gorgias helpdesk):
- Credentials stored encrypted in `integration_secrets` (AES-256-GCM).
- Server-side connection testing before marking as connected.
- `integrations` table tracks per-shop integration status.

### Help (embedded vs portal)

In-app help (`/app/help`) is separate from the portal help center (`/portal/help`):
- Embedded app uses a curated subset of articles and optional copy overrides for Shopify Admin context (`lib/help/embedded.ts`, `help.embedded` i18n).
- Portal uses the full article set and shared `help.*` namespace. See Technical Specification — Help System (EPIC 10).

### Evidence Sample Files

Merchants can upload sample evidence files during setup:
- Private Supabase Storage bucket: `evidence-samples/{shop_id}/samples/`.
- Metadata tracked in `evidence_files` table.
- Events logged to `app_events`.

## Audit Log

`audit_events` table is append-only:
- Database triggers reject UPDATE and DELETE.
- `logAuditEvent()` is the only writer in application code.
- Events are never deleted (regulatory/compliance requirement).
