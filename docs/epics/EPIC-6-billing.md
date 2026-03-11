# EPIC 6 — Billing and Plan Limits

> **Status:** Done
> **Week:** 5
> **Dependencies:** EPIC 0, EPIC 2, EPIC 4

## Goal

Monetize with tiered plans enforced server-side; integrate Shopify's billing API.

## Implementation

### 6.1 — Plan Definitions

`lib/billing/plans.ts`:

| Plan | Price | Packs/Month | Auto-Pack | Rules | Trial |
|------|-------|-------------|-----------|-------|-------|
| Free | $0 | 3 | No | No | — |
| Starter | $29/mo | 50 | Yes | Yes | 7 days |
| Pro | $79/mo | Unlimited | Yes | Yes | 7 days |

Plan stored in `shops.plan` column (CHECK constraint: free/starter/pro).

### 6.2 — Quota Checker

`lib/billing/checkQuota.ts`:

- `checkPackQuota(shopId)` — counts packs created this calendar month, compares to plan limit.
- Returns `{ allowed, plan, used, limit, remaining, reason? }`.
- `checkFeatureAccess(planId, feature)` — gates on `autoPack` or `rules`.

### 6.3 — Shopify Billing Integration

**Subscribe** (`POST /api/billing/subscribe`):
1. Creates `appSubscriptionCreate` GraphQL mutation.
2. Returns `confirmationUrl` for merchant approval redirect.
3. Includes 7-day trial for paid plans.
4. Uses `test: true` in non-production environments.

**Callback** (`GET /api/billing/callback`):
1. Shopify redirects here after merchant approves/declines.
2. If `charge_id` present → updates `shops.plan`, logs `billing_plan_activated`.
3. If declined → logs `billing_subscription_declined`.
4. Redirects back to app settings.

**Usage** (`GET /api/billing/usage`):
- Returns current plan details + monthly usage stats.

### 6.4 — Server-Side Enforcement

| Guard Location | Enforcement |
|----------------|-------------|
| `POST /api/disputes/:id/packs` | Pack quota check — 403 if exceeded |
| `POST /api/rules` | Feature gate — 403 if Free plan |
| `runAutomationPipeline()` | Quota + autoPack feature check before auto-build |

All enforcement is server-side. Client CTAs are convenience, not security.

### 6.5 — Billing Settings UI

**Embedded App** (`app/(embedded)/app/billing/page.tsx`):
- Current plan badge + usage progress bar.
- Three-column plan comparison with features list.
- Upgrade buttons redirect to Shopify approval flow.

**Portal** (`app/(portal)/portal/billing/page.tsx`):
- Usage meter with color-coded progress bar (blue/yellow/red).
- Plan cards with feature checklists and upgrade buttons.
- Downgrade note: "Contact support" (takes effect next cycle).

### 6.6 — Upgrade CTAs

- **Pack limit reached**: Warning banner on dispute detail with "Upgrade Plan" action → `/app/billing`.
- **Rules on Free plan**: Blue info box on rules settings page with "Upgrade Plan" link.
- **Automation pipeline**: Returns `quota_exceeded` or `feature_blocked` silently (no auto-pack, dispute goes to review).

### 6.7 — Store session invalid (upgrade blocked)

When `POST /api/billing/subscribe` is called with a shop that has no session or a session missing `shop_domain`, the API returns 404 or 400 with an error telling the merchant to use **Clear shop & reconnect** and then open the app from Shopify Admin. The billing page (portal and embedded) shows this error and an **Open in Shopify Admin** link so the merchant can fix the session in one click.

## Key Files

| File | Purpose |
|------|---------|
| `lib/billing/plans.ts` | Plan definitions (Free/Starter/Pro) |
| `lib/billing/checkQuota.ts` | Monthly quota + feature access checks |
| `lib/shopify/mutations/appSubscriptionCreate.ts` | Billing GraphQL mutation |
| `app/api/billing/subscribe/route.ts` | Create subscription |
| `app/api/billing/callback/route.ts` | Handle approval/decline |
| `app/api/billing/usage/route.ts` | Usage + plan info |
| `app/(embedded)/app/billing/page.tsx` | Embedded billing UI |
| `app/(portal)/portal/billing/page.tsx` | Portal billing UI |
| `app/api/disputes/[id]/packs/route.ts` | Modified: quota guard |
| `app/api/rules/route.ts` | Modified: feature gate |
| `lib/automation/pipeline.ts` | Modified: quota + feature checks |

## Acceptance Criteria

- [x] Shopify recurring billing works for Starter and Pro.
- [x] Pack generation blocked with clear UX at monthly limit.
- [x] Free users cannot access auto-pack or rules.
- [x] Usage count accurate and displayed.
- [x] Upgrade flow completes end-to-end.
- [x] Downgrades handled gracefully (features disabled, data retained).
