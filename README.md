# DisputeDesk — Shopify Chargeback Evidence Governance

> **Branding note:** The name "DisputeDesk" may overlap with disputedesk.co.
> Consider using **DisputeDesk.app** or an alternative for public branding.
> This is non-blocking for development.

## What It Does

DisputeDesk is a Shopify public embedded app that helps merchants handle
chargebacks by:

- Syncing disputes from Shopify Payments
- Generating structured evidence packs (JSON + PDF)
- Providing governance controls (auto-pack rules, review queues)
- Saving evidence back to Shopify via GraphQL
- Maintaining an immutable audit log of all actions

**Important:** DisputeDesk saves evidence to Shopify — it does NOT
programmatically submit dispute responses to card networks. Merchants
finalize submission in Shopify Admin.

## Tech Stack

- **Frontend:** React 18 + Polaris + App Bridge React (embedded in Shopify Admin)
- **Backend:** Next.js 15 App Router (Node runtime)
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
cp .env.example .env
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
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key (never expose to client) |
| `TOKEN_ENCRYPTION_KEY_V1` | AES-256-GCM key for token encryption (64 hex chars) |
| `CRON_SECRET` | Shared secret for cron → worker auth |

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
design, auth model, async job architecture, and data flow.

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
3. Forbidden copy grep (no "submit response" language in UI)
4. `npm audit`
