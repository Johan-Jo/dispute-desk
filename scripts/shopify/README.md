# Shopify test store seeding (DisputeDesk)

This folder contains scripts to seed the **test store** `disputedesk.myshopify.com` with realistic test data: orders, fulfillments, and fulfillment tracking events. Orders are tagged so the app can test evidence-pack generation.

The seed script uses the **REST Admin API** (`POST /orders.json`) to create orders directly, then **GraphQL** for fulfillments and tracking events. This avoids the DraftOrder protected-customer-data restriction.

Disputes/chargebacks cannot be created via the Admin API. The script seeds everything else; creating real disputes is done manually with Shopify Payments Test Mode (see below).

## 1. Authentication

The script tries credentials in this order:

1. **`SHOPIFY_ADMIN_TOKEN`** — Admin API access token (`shpat_...`). Used as-is.
2. **`SHOPIFY_CLIENT_ID`** + **`SHOPIFY_API_SECRET`** — Main DisputeDesk app (deployed via `shopify app deploy`). Uses client credentials grant.
3. **`SHOPIFY_SEED_CLIENT_ID`** + **`SHOPIFY_SEED_CLIENT_SECRET`** — Separate store custom app (if you prefer isolating seed credentials).

Set whichever pair you have in `.env.local`. If a direct token is set, it takes priority.

## 2. Required scopes and permissions

The app used for seeding needs these **Admin API scopes** on the target store:

| Scope | Purpose |
|-------|---------|
| `write_orders` | Create orders via REST API. |
| `write_fulfillments` | Create fulfillment tracking events. |
| One of: `write_assigned_fulfillment_orders` / `write_merchant_managed_fulfillment_orders` / `write_third_party_fulfillment_orders` | Create fulfillments. |

The app user must also have the **"Fulfill and ship orders"** permission.

### Protected customer data access (required)

Orders contain customer PII (email, address), so the app must have **Protected Customer Data** access declared. For Dev Dashboard apps:

1. Go to **Partner Dashboard** (partners.shopify.com) → Apps → find your app under "Dev Dashboard apps".
2. Click **API access requests** in the sidebar.
3. Under **Protected customer data access**, click **Request access**.
4. Select reasons (e.g. Order management, App functionality) and **Save**.
5. For development stores, no review is needed — access is immediate.

### Deploying scope changes

If using the main DisputeDesk app, scopes are managed in `shopify.app.toml`:

```bash
npx shopify app deploy --force
```

After deploying, **reinstall the app** on the target store to pick up the new scopes (uninstall + reinstall from the store admin).

## 3. How to run

1. Add credentials to `.env.local` (see env example below).

2. From the project root:

   ```bash
   npm run seed:shopify
   ```

   Or directly:

   ```bash
   node scripts/shopify/seed-teststore.mjs
   ```

3. The script prints each created order with Admin URL and scenario tags.

**Rate limiting:** Dev stores have a low order creation rate limit (~5/min). The script waits 15s between orders and retries on rate limit errors (up to 3 attempts with 60s backoff). A full 20-order run takes ~6 minutes.

## 4. What gets created

- **Orders**: Created via REST `POST /orders.json` with `financial_status: paid`. Two line items per order, Brazilian shipping/billing addresses.
- **Tags**: Every order gets `DD_SEED`, `DD_SEED_BATCH:v1`, and `DD_SCENARIO:{scenario}`.
- **Scenarios** (rotated by order index):
  - **DELIVERED**: Fulfillment + 3 tracking events: `IN_TRANSIT` → `OUT_FOR_DELIVERY` → `DELIVERED`.
  - **IN_TRANSIT**: Fulfillment + 1 event: `IN_TRANSIT`.
  - **NO_TRACKING**: Fulfillment created, no tracking events.
  - **PARTIAL**: Only the first line item of the first fulfillment order is fulfilled.

If fulfillment scopes are missing, the script still creates orders and prints a warning; it does not crash.

## 5. Creating real disputes (manual)

Disputes cannot be created via the Admin API. To generate real disputed transactions:

1. Enable **Shopify Payments Test Mode** for the store.
2. Place a real checkout order using the **dispute test card**: `4000000000000259`.
3. That transaction will appear as disputed in Shopify Admin and can be used for evidence-pack and dispute flows.

## 6. Env example

```bash
# scripts/shopify — add to .env.local

# Store (optional; defaults shown)
SHOPIFY_STORE_DOMAIN=disputedesk.myshopify.com
SHOPIFY_API_VERSION=2026-01

# Auth (pick one):
# Option A: Direct token from a store custom app
SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Option B: Main DisputeDesk app (deployed with write_orders scope)
# SHOPIFY_CLIENT_ID=your_client_id
# SHOPIFY_API_SECRET=your_client_secret

# Option C: Separate seed app credentials
# SHOPIFY_SEED_CLIENT_ID=your_seed_app_client_id
# SHOPIFY_SEED_CLIENT_SECRET=your_seed_app_secret

# Seed options (optional)
SEED_COUNT=20
SEED_CURRENCY=USD
```
