# EPIC 6 — Billing and Plan Limits

> **Status:** Pending
> **Week:** 5
> **Dependencies:** EPIC 0, EPIC 2, EPIC 4

## Goal

Monetize with tiered plans enforced server-side; integrate Shopify's billing API.

## Tasks

### 6.1 — Plan Definition
| Plan | Price | Packs/Month | Auto-Pack | Rules | Notes |
|------|-------|-------------|-----------|-------|-------|
| Free | $0 | 3 | No | No | Manual generation only |
| Starter | $29/mo | 50 | Yes | Yes | — |
| Pro | $79/mo | Unlimited | Yes | Yes | Priority support, team access (later) |

Plan stored in `shops.plan` column.

### 6.2 — Shopify Billing Integration
- `appSubscriptionCreate` GraphQL mutation for recurring charges.
- `/api/billing/subscribe` route:
  1. Create subscription charge via GraphQL.
  2. Redirect merchant to Shopify approval URL.
  3. On callback, confirm charge and update `shops.plan`.
- Handle `app/uninstalled` webhook to deactivate billing.

### 6.3 — Usage Metering
- Monthly pack count per shop: count `evidence_packs` where `created_at` in current month.
- Before `buildPack()`: check count >= plan limit, reject with clear error.
- Return remaining quota in API responses.

### 6.4 — Enforcement Middleware
- Server-side guards on pack creation and rule routes:
  - Free: block auto-pack, block rules CRUD, enforce 3/month cap.
  - Starter: enforce 50/month cap.
  - Pro: no limits.
- Never enforce client-side only.

### 6.5 — Billing Settings UI
- `app/settings/billing/page.tsx`:
  - Current plan with feature comparison table.
  - Usage meter: "X of Y packs used this month" + progress bar.
  - "Upgrade" buttons per tier.
  - "Downgrade" info (takes effect next billing cycle).

### 6.6 — Upgrade CTAs
- Free at 3-pack limit: inline banner + modal on "Generate Pack".
- Starter at 40 packs: warning. At 50: hard block.
- Free accessing rules: "Available on Starter and above" + upgrade CTA.

## Key Files
- `app/api/billing/subscribe/route.ts`, `app/api/billing/callback/route.ts`
- `lib/billing/checkQuota.ts`, `lib/billing/plans.ts`
- `app/settings/billing/page.tsx`
- Modified: `lib/packs/buildPack.ts`, middleware/route guards

## Acceptance Criteria
- [ ] Shopify recurring billing works for Starter and Pro.
- [ ] Pack generation blocked with clear UX at monthly limit.
- [ ] Free users cannot access auto-pack or rules.
- [ ] Usage count accurate and displayed.
- [ ] Upgrade flow completes end-to-end.
- [ ] Downgrades handled gracefully (features disabled, data retained).
