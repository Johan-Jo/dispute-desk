# Plan: Store seeding and why there are no chargebacks/disputes

## 1. What “seed the store” means

- **Store** = the **Shopify** store (merchant’s shop: orders, payments, fulfillments).
- **Store seed script:** `scripts/shopify/seed-teststore.mjs` (run via `npm run seed:shopify`).
- It uses the Shopify Admin API to create in the **store**:
  - **Orders** (REST `POST /orders.json`) — paid orders with line items, addresses, tags.
  - **Fulfillments** and **fulfillment tracking events** (GraphQL) — delivery scenarios (DELIVERED, IN_TRANSIT, NO_TRACKING, PARTIAL).

So “seed the store” = run that script so the **Shopify store** has orders and fulfillments (transactions). It does **not** touch our Supabase database.

---

## 2. Why there are no chargeback requests after store seed

- **Chargebacks** are created by the **cardholder’s bank** (or by Shopify in test mode when you use a special test card). They are **not** created by the Admin API.
- The store seed script **cannot** create chargebacks or disputes in Shopify; the API does not support it.
- So after store seed you have **orders/transactions** in the store, but **no chargebacks** → our app has nothing to sync from Shopify → **no disputes** in the app.

This is a **product/API limitation**, not a bug in the seed script.

---

## 3. How to get chargebacks and disputes

### Option A — Real test disputes in Shopify (manual, recommended for real flows)

1. Enable **Shopify Payments Test Mode** on the store.
2. Place one or more **checkout** orders using the **dispute test card**: `4000000000000259`.
3. Those transactions will appear as **disputed** in Shopify Admin.
4. In DisputeDesk: **Sync Now** (or wait for cron) so we pull those disputes from Shopify into our DB.
5. Result: real disputes in Shopify and in our app.

*(Already documented in `scripts/shopify/README.md` §5.)*

### Option B — Demo data in our app only (no real disputes in Shopify)

1. Seed the **store** (orders/fulfillments): `npm run seed:shopify`.
2. Ensure the **shop** exists in our DB (e.g. install the app on that store once, or run Supabase seed so `shops` has the dev store).
3. Seed **our database** with fake disputes for that shop:  
   `node scripts/seed-synthetic-disputes.mjs --shop dev-store.myshopify.com --count 20`
4. Result: the app shows disputes for the dev store; Shopify still has no real chargebacks.

Useful for UI/dev without touching Shopify Payments test mode.

---

## 4. Plan (what to do)

| # | Task | Owner / Notes |
|---|------|----------------|
| 1 | **Clarify in README** that “seed the store” = Shopify orders/fulfillments only; it does **not** create chargebacks. Point to this plan or to `scripts/shopify/README.md` for how to get disputes. | Doc update |
| 2 | **Ensure store seed is runnable:** Check `npm run seed:shopify` (env, auth, scopes, rate limits). Fix any script or env bugs so the store actually gets seeded. | Script + env |
| 3 | **Optional: one-command “store + disputes” for dev:** Add an npm script that (1) runs store seed, (2) runs dispute seed for the dev shop, so one command gives “store with orders + app with disputes” without manual test card. | Optional script |
| 4 | **Revert or isolate DB-only seed:** The earlier change that added disputes to `supabase/seed.sql` was for **our database** (Supabase), not the store. If we want “seed the store” to mean only Shopify, keep `seed.sql` minimal (e.g. shop row only) and treat dispute seeding as a separate, documented step (Option B above). | Config / seed.sql |

---

## 5. Summary

- **Store seed** = `scripts/shopify/seed-teststore.mjs` → Shopify gets orders and fulfillments. It **never** creates chargebacks.
- **Chargebacks** in Shopify come from real card networks or from test mode + dispute test card `4000000000000259`.
- To have **disputes** in the app: either create real test disputes in Shopify (Option A) or seed our DB with fake disputes for the dev shop (Option B). The plan above is to document this, fix store seed if needed, and optionally add a single command for “store + disputes” for dev.
