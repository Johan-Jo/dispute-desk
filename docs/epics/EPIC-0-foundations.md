# EPIC 0 — Repo, Tooling, and Foundations

> **Status:** DONE
> **Week:** 1
> **Dependencies:** None (first epic)

## Goal

Stand up the project skeleton so the app installs on a Shopify dev store, renders an embedded page, and has a working Supabase database with the full V1 schema.

## Tasks

### 0.1 — Scaffold Next.js + Shopify Embedded App
- Initialize Next.js 15 with App Router and TypeScript strict mode.
- Install `@shopify/shopify-api` (Node library) with custom session storage adapter for Next.js API routes.
- Configure `shopify.app.toml` for the public app (scopes: `read_orders`, `read_shopify_payments_disputes`, `write_shopify_payments_dispute_evidences`).
- Set up Polaris via `@shopify/polaris` + `@shopify/app-bridge-react` for embedded UI shell.

### 0.2 — Shopify OAuth + Session Management
- Implement `/api/auth/shopify` (redirect to Shopify consent screen) and `/api/auth/shopify/callback` (exchange code for access token).
- Store sessions in Supabase `shop_sessions` table (custom session storage adapter).
- Encrypt access tokens at rest using AES-256-GCM with key versioning.
- Implement session validation middleware that checks token validity on every authenticated request.
- Support both offline (shop-wide) and online (user-scoped) sessions.

### 0.3 — Supabase Project + Full V1 Schema Migrations
- 8 migrations deployed:
  - `001_core_shops_sessions.sql` — `shops` and `shop_sessions` tables with online/offline support.
  - `002_disputes.sql` — `disputes` table with `dispute_evidence_gid` for Epic 5.
  - `003_evidence_packs_items.sql` — `evidence_packs`, `evidence_items` tables.
  - `004_audit_events.sql` — `audit_events` table with immutability triggers.
  - `005_rules_policies.sql` — `rules` and `policy_snapshots` tables.
  - `006_rls_policies.sql` — RLS on all tables; service role access.
  - `007_jobs.sql` — async jobs table for pack/PDF work.
  - `008_claim_jobs_rpc.sql` — `claim_jobs()` RPC with SKIP LOCKED.

### 0.4 — Environment + CI
- `.env.example` with all required variables.
- `/api/health` route.
- GitHub Actions CI: typecheck, lint, build, vitest, forbidden copy grep, npm audit.

### 0.5 — Documentation
- `README.md`, `docs/architecture.md`, `docs/technical.md`.

## Key Files
- `app/layout.tsx`, `app/page.tsx` (embedded shell)
- `app/api/auth/shopify/route.ts`, `app/api/auth/shopify/callback/route.ts`
- `lib/shopify/client.ts` (GraphQL client factory)
- `lib/shopify/sessionStorage.ts` (Supabase-backed session adapter)
- `lib/security/encryption.ts` (AES-256-GCM encrypt/decrypt with key rotation)
- `supabase/migrations/001-008*.sql`
- `middleware.ts` (session validation)

## Acceptance Criteria (all met)
- [x] App builds and dev server starts without errors.
- [x] OAuth flow supports offline + online token phases.
- [x] Supabase: 9 tables, RLS on all, immutability triggers, `claim_jobs` RPC.
- [x] `/api/health` returns 200.
- [x] CI pipeline defined.

## Risks
- Shopify's session management libraries are Remix-oriented. **Mitigated:** custom adapter using `@shopify/shopify-api` directly.
