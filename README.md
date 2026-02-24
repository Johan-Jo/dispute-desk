# DisputeDesk — Shopify Chargeback Evidence Governance

> **Branding note:** The name "DisputeDesk" may overlap with disputedesk.co.
> Consider using **DisputeDesk.app** or an alternative for public branding.
> This is non-blocking for development.

## What It Does

DisputeDesk helps merchants handle Shopify Payments chargebacks by:

- Syncing disputes from Shopify Payments
- Generating structured evidence packs (JSON + PDF)
- Providing governance controls (auto-pack rules, review queues)
- Saving evidence back to Shopify via GraphQL
- Maintaining an immutable audit log of all actions

**Important:** DisputeDesk saves evidence to Shopify — it does NOT
programmatically submit dispute responses to card networks. Merchants
finalize submission in Shopify Admin.

## Surfaces

DisputeDesk ships as two web surfaces from one codebase:

| Surface | URL | Auth | Description |
|---------|-----|------|-------------|
| Marketing | `/` | Public | Landing page, hero, CTAs |
| Portal Auth | `/auth/*` | Public | Sign in, sign up, password reset |
| Portal App | `/portal/*` | Supabase Auth | SaaS web: disputes, packs, settings |
| Embedded App | `/app/*` | Shopify session | Inside Shopify Admin (Polaris) |
| API | `/api/*` | Mixed | Backend routes |

- **Embedded app** is the primary surface for merchants who install from Shopify.
- **Portal** serves team members without Shopify Admin access, multi-store
  operators, and merchants who prefer a standalone web experience.

## Tech Stack

- **Frontend (Embedded):** React 18 + Polaris + App Bridge React
- **Frontend (Portal/Marketing):** React 18 + Tailwind CSS
- **Backend:** Next.js 15 App Router (Node runtime)
- **Auth (Portal):** Supabase Auth (email/password, magic link)
- **Auth (Embedded):** Shopify OAuth (offline + online sessions)
- **Database:** Supabase Postgres (server-only access, RLS enabled)
- **Storage:** Supabase Storage (private buckets for PDFs + uploads)
- **PDF:** @react-pdf/renderer
- **Deployment:** Vercel + Vercel Cron
- **CI:** GitHub Actions

## Local Setup

### Prerequisites

- Node.js 20+
- npm
- Supabase CLI (`npx supabase`)
- Shopify CLI (`npx shopify`)
- A Shopify Partner account + dev store

### Steps

```bash
# 1. Clone and install
cd DisputeDesk
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in all values (see .env.example for descriptions)

# 3. Run Supabase migrations
npx supabase db push

# 4. Start dev server
npm run dev

# 5. Start Shopify tunnel (separate terminal)
npx shopify app dev
```

### Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Purpose |
|----------|---------|
| `SHOPIFY_API_KEY` | App API key from Shopify Partners |
| `SHOPIFY_API_SECRET` | App secret for webhook verification + OAuth |
| `SHOPIFY_API_VERSION` | Pinned GraphQL API version (default: `2026-01`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key (used for portal auth only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key (never expose to client) |
| `TOKEN_ENCRYPTION_KEY_V1` | AES-256-GCM key for token encryption (64 hex chars) |
| `CRON_SECRET` | Shared secret for cron → worker endpoint auth |

### Shopify Scopes

```
read_orders
read_shopify_payments_disputes
write_shopify_payments_dispute_evidences
```

### Permissions

Saving evidence requires the merchant user to have **"Manage orders
information"** permission in Shopify Admin (Settings → Plan and permissions).
This is a Shopify Admin permission, not an OAuth scope.

**Troubleshooting "Access denied" on save:**
1. Check user has "Manage orders information" in Shopify Admin.
2. Verify app has `write_shopify_payments_dispute_evidences` scope.
3. Ensure user has an active online session (re-open app from Shopify Admin).

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full system
design, two-surface architecture, auth models, async job architecture,
and data flow.

## Development

### Running Tests

```bash
npx vitest run
```

Tests include:
- **Contract tests:** Validate Shopify GraphQL response shapes (zod schemas)
- **Unit tests:** Encryption roundtrip, field mapping, etc.

### CI

GitHub Actions runs on push/PR to main:
1. Typecheck + lint + build
2. Vitest (contract + unit)
3. Forbidden copy grep (no "submit response" language in UI or translations)
4. `npm audit`
