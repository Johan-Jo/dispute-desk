# No-orders install gate

Status: PLAN ONLY — nothing built. Written 2026-10-08.

## Problem

Stores with zero orders install DisputeDesk, then sit in the embedded app and
browse. Trigger: `vkqq7k-d1.myshopify.com` ("Elio Varen"), installed
2026-10-08 01:49 UTC, brand-new store, free plan, historical import
`not_started`, 0 orders. DisputeDesk cannot do anything for a store with no
orders, so these installs only cost attention and let someone poke around.

## Goal

1. At install, check whether the store has any orders.
2. If none: block the app UI behind a friendly "no orders yet" screen.
3. Tell the admin: "Yet another store with no orders was installed."
4. When the store later gets orders, unlock automatically.

## What exists today (verified in code)

- Two shop-creating paths, both already routed through
  `lib/shopify/onNewShopCreated.ts` (the OAuth callback, and
  `app/api/auth/shopify/token-exchange/route.ts`). A test
  (`newShopSideEffects.test.ts`) fails the build if a third path inserts into
  `shops` without it. So install-time logic belongs there; no new path can skip it.
- `onNewShopCreated` already sends the admin alert via
  `sendAdminInstallNotification` (lib/email/sendAdminNotification.ts) and the
  merchant welcome email. It is awaited on purpose (Vercel freezes the
  instance on redirect).
- The embedded shell is `app/(embedded)/app/layout.tsx`: a server layout that
  renders the nav and children. It is the single choke point for every
  `/app/*` page.
- Shopify API version is 2026-01, which has `ordersCount { count }`.

## Design

### 1. Order check (new `lib/shopify/hasAnyOrders.ts`)

- Admin GraphQL: `ordersCount(limit: 1) { count precision }` via
  `makeAuthedRequest` and the stored offline session.
- Returns `true | false | null`. `null` = could not tell (API error, token
  not propagated yet, missing session). **Fail open on `null`.** Never block
  a merchant because our check failed.
- Known blind spot: without the `read_all_orders` scope, Shopify only exposes
  orders from the last 60 days. A real but dormant store whose orders are all
  older, with a dispute on an old order, would look empty. Mitigation: treat
  the shop as "has activity" if it has any dispute row in our DB or any
  dispute on Shopify (disputes are fetched by the existing sync). So the
  verdict is `noOrders = ordersCount == 0 AND no disputes`. We do NOT add
  `read_all_orders` (scope change = consent-screen churn for every shop).

### 2. Persist the verdict (migration)

New nullable column `shops.orders_verified_at timestamptz`.

- Set once the check returns "has orders" (or has disputes). Never checked
  again after that; one flag read per embedded load, no Shopify call.
- Migration backfills `now()` for every existing shop so nobody already
  installed is affected (grandfather). Only new installs after the deploy
  go through the gate. `vkqq7k-d1` is created after, so it is gated.
- Also `shops.no_orders_notified_at` is NOT needed: the admin alert fires
  once at install from `onNewShopCreated`, which already only runs on a new
  shop row.
- Apply with `npm run db:migrate:dev` first; prod via the documented TTY
  fallback (`scripts/run-migration.mjs`) when the prod PR is approved.

### 3. Install time (`onNewShopCreated`)

- After the session is stored, call `hasAnyOrders`. If `true`, stamp
  `orders_verified_at`. If `false`, leave null and pass `noOrders: true` to
  the admin notification. If `null`, leave null (re-checked on first load).
- Admin email: when `noOrders`, subject and headline become
  **"Yet another store with no orders was installed"**, plus shop domain,
  store name, owner email, primary domain. Still sent once, awaited.
- Merchant email: for a no-orders install, REPLACE the normal "get started"
  welcome (otherwise we invite them in and then lock the door) with a
  "we couldn't set up DisputeDesk" email. It says plainly that we cannot
  complete the install because the store has no order history, and so no
  disputes for us to work on, that nothing was set up and nothing is
  charged, and that they are very welcome back once the store has orders.
  Sent once, to the shop-owner address, awaited like the other install
  emails. If the owner address can't be fetched, the existing sender
  already skips rather than guessing. New email copy goes through i18n
  tokens in all six locales, with the same wording as the screen below.

### 4. Gate (`app/(embedded)/app/layout.tsx`)

- Layout resolves the shop from the existing `shopify_shop_id` cookie. If
  `orders_verified_at` is null: run `hasAnyOrders` (cached ~10 min per shop so
  a refresh storm doesn't hammer Shopify).
  - has orders: stamp `orders_verified_at`, render normally.
  - none: render ONLY the no-orders screen. No nav (`AppNavSidebar` skipped),
    no children, so no page content or routes are reachable by browsing.
  - unknown (`null`): render normally (fail open).
- Superadmin impersonation bypasses the gate (the existing
  `IMPERSONATION_MODE_HEADER` check), so you can still inspect these shops.
- API routes and webhooks are untouched. Webhooks must keep working so that
  when the first order or dispute arrives, the shop is healthy and unlocks.
  The lock is a UI gate, not a deactivation.

### 5. The screen

Polaris page, i18n via tokens (no English literals in `lib/`):

> **Your store has no orders yet**
> DisputeDesk helps defend chargebacks on orders you've already sold, so
> unfortunately there's nothing we can do for this store right now. You're
> very welcome back once you have a working store with orders, and we'll be
> glad to help you then.

Single link: support@disputedesk.app. New keys under `embedded.noOrders.*`,
translated in all six locales (en/de/es/fr/pt/sv) in the same change.

## Tests

- `hasAnyOrders`: count 0, count > 0, dispute present with 0 orders, GraphQL
  error → `null`, no session → `null`.
- `onNewShopCreated`: no-orders sends the new admin subject, non-no-orders
  keeps the existing email; `null` verdict does not block or relabel.
- Layout gate: gated render for null+no orders, passthrough when stamped,
  passthrough on `null`, passthrough under impersonation.
- Extend `adminInstallNotification.test.ts`; keep
  `newShopSideEffects.test.ts` green.
- `verify-i18n-parity` for the new keys.

## Docs (same commit)

`docs/technical.md` (new section: install order gate, fail-open rule,
60-day blind spot) and the embedded help article for the locked screen.

## Rollout

1. Branch off `origin/develop` in a separate worktree, PR to `develop`.
2. `npm run db:migrate:dev`, then canary on dev: a dev store with no orders
   (expect lock + admin email) and one with orders (expect no change).
3. Master PR only after your in-chat go (CLAUDE.md rule 9). The prod migration
   must be applied before the code reaches prod, or the layout query fails.

## Decisions I've assumed (tell me if any is wrong)

- Existing shops are grandfathered, including any current zero-order ones
  (including `vkqq7k-d1`, which is already installed and is not re-gated
  unless you want it; say so and I'll null its flag so it hits the gate).
- Gate is a UI lock only; the shop row, webhooks and billing are unchanged.
- Dormant stores with only >60-day-old orders and no disputes would be
  locked until they get a new order. Acceptable, with fail-open on errors.
- Not auto-uninstalling or deleting anything.
