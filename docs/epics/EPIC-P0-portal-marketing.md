# EPIC P0 — External Portal + Marketing

> **Status:** Pending
> **Week:** 0–1 (parallelizable with EPIC 1+)
> **Dependencies:** EPIC 0 (Supabase configured, Shopify OAuth endpoints exist)

## Goal

Provide a public marketing landing page and an external web portal with its own
auth (Supabase Auth), store-connect flow, and the same core screens as the
embedded app (initially read-only placeholders).

## Why a separate portal?

The embedded app lives inside Shopify Admin. The external portal gives merchants
(and their team members who may not have Shopify Admin access) a standalone SaaS
surface to view disputes, evidence packs, and settings. It also provides a
public landing page for acquisition.

## Two Surfaces

| Surface | Route group | Auth | UI toolkit |
|---------|-------------|------|------------|
| Marketing | `(marketing)` — `/` | None | Tailwind |
| Portal | `(portal)` — `/portal/*` | Supabase Auth | Tailwind / shadcn |
| Portal Auth | `(auth)` — `/auth/*` | None (public) | Tailwind |
| Embedded App | `(embedded)` — `/app/*` | Shopify session | Polaris + App Bridge |

## Scope (V1)

### P0.1 — Marketing Landing
- Hero section at `/` with headline, subhead, CTA buttons.
- "Install on Shopify" + "Sign in" CTAs.
- Compliance footer: "Evidence saved via API. Submission happens in Shopify Admin."
- No Polaris or App Bridge loaded.

### P0.2 — Portal Auth (Supabase Auth)
- `/auth/sign-in` — email + password, magic link option.
- `/auth/sign-up` — name + email + password.
- `/auth/magic-link-sent` — confirmation + resend.
- `/auth/forgot-password` — request reset email.
- `/auth/reset-password` — set new password (from email link).
- All pages use a centered card layout (no sidebar/nav).

### P0.3 — Portal Shell + Placeholder Pages
- `/portal/dashboard` — overview placeholder.
- `/portal/disputes` + `/portal/disputes/[id]` — dispute list/detail placeholder.
- `/portal/packs` + `/portal/packs/[packId]` — pack list/detail placeholder.
- `/portal/rules` — rules placeholder.
- `/portal/policies` — policies placeholder.
- `/portal/billing` — billing placeholder.
- `/portal/settings` — settings placeholder.
- `/portal/team` — team management placeholder.
- Shell: top bar + left nav sidebar + active shop selector dropdown.
- Each page clearly labeled as placeholder.

### P0.4 — Store Connect Flow
- `/portal/connect-shopify` — explains what connecting does, CTA triggers OAuth.
- Reuses existing `/api/auth/shopify` with `source=portal` + `return_to` query params.
- After OAuth: shop created/found in `shops` table, offline session stored,
  `portal_user_shops` row links portal user to shop.
- If portal user is not signed in when starting connect: redirect to `/auth/sign-in`
  with `continue=/portal/connect-shopify`.

### P0.5 — Store Selector
- `/portal/select-store` — shows all shops linked to current portal user.
- Sets `active_shop_id` secure cookie.
- If no linked shops: prompt to connect first.
- Portal pages require an active shop; redirect here if cookie missing.

### P0.6 — Permission Error Screen
- `/portal/permissions` — explains "Missing Shopify permission: manage_orders_information".
- Steps: contact store admin, retry, link to Shopify Admin permissions page.
- UI-only for now; enforcement happens in EPIC 5.

## DB Changes

### New tables (migration 009_portal.sql)

**portal_user_profiles**
- `id` uuid PK → references `auth.users(id)`
- `full_name` text
- `created_at` timestamptz

**portal_user_shops**
- `id` uuid PK
- `user_id` uuid → references `auth.users(id)`
- `shop_id` uuid → references `shops(id)`
- `role` text (`admin` | `member` | `read_only`)
- `created_at` timestamptz
- UNIQUE(`user_id`, `shop_id`)

**RLS:**
- `portal_user_profiles`: user reads/writes own row; service role full access.
- `portal_user_shops`: user reads own rows; service role full access.

## Key Files
- `app/(marketing)/layout.tsx`, `app/(marketing)/page.tsx`
- `app/(auth)/layout.tsx`, `app/(auth)/auth/*/page.tsx`
- `app/(portal)/layout.tsx`, `app/(portal)/portal/*/page.tsx`
- `app/(embedded)/layout.tsx` (moved from `app/layout.tsx`)
- `lib/supabase/portal.ts` (portal auth helpers)
- `lib/portal/activeShop.ts` (cookie-based shop selector)
- `middleware.ts` (multi-surface gating)
- `supabase/migrations/009_portal.sql`

## Acceptance Criteria
- [ ] `/` renders marketing hero without Polaris or App Bridge scripts.
- [ ] Portal auth pages work with Supabase Auth (sign-in, sign-up, magic link, reset).
- [ ] `/portal/*` is gated; redirects to `/auth/sign-in` when logged out.
- [ ] "Connect Shopify store" completes OAuth and creates a `portal_user_shops` link.
- [ ] `/portal/select-store` shows linked shops and sets active shop cookie.
- [ ] Placeholder portal screens render in portal shell with shop selector.
- [ ] Embedded app continues to work unchanged at `/app/*`.
