# Plan: Bulk Generate Test Chargebacks for DisputeDesk

## Context

Shopify does **not** provide a built-in or API-driven way to bulk create chargebacks in test environments. There is **no `shopifyPaymentsDisputeCreate` mutation** in the GraphQL Admin API. Disputes are created by card networks (and in test mode, by using a specific test card), not by merchants via API.

This plan outlines practical options for dev/testing with many disputes.

---

## Option 1: Bulk Seed Disputes in Supabase (Recommended for Dev)

**Goal:** Test DisputeDesk’s pipeline (pack build, completeness, auto-save gate, UI) with many disputes without touching Shopify.

**How it works:** Reuse the same pattern as `scripts/smoke-test.mjs`: insert dispute rows into `disputes` (and optionally `evidence_packs`) in Supabase. DisputeDesk then treats them like synced disputes. No Shopify API for dispute creation is used.

**Pros:**

- No new Shopify scopes or auth.
- Fast, scriptable, repeatable.
- Already validated by smoke test (single dispute).
- Can vary reason, amount, status, due dates for realistic testing.

**Cons:**

- Disputes are not in Shopify; sync-from-Shopify and “real” Shopify flows are not tested by this script.

**Implementation:**

| Step | Action |
|------|--------|
| 1 | Add a dedicated script (e.g. `scripts/seed-bulk-disputes.mjs`) that reads from `.env.local` (e.g. `SUPABASE_URL_POSTGRES`, shop id or domain). |
| 2 | Script inserts N rows into `disputes` for a test shop (e.g. `shop_id` from `shops` for a known dev shop). Use varied `reason`, `amount`, `currency_code`, `due_at`, `status` (e.g. `needs_response`). Reuse existing `dispute_gid` pattern (e.g. `gid://shopify/ShopifyPaymentsDispute/seed-{i}`) and respect unique constraint `(shop_id, dispute_gid)`. |
| 3 | Optional: script can also create `evidence_packs` for a subset of disputes to test list/detail and pack-building. |
| 4 | Document in README or `docs/technical.md`: when to use bulk seed vs smoke test, and that this does not create disputes in Shopify. |
| 5 | Add a small “cleanup” mode (e.g. `--cleanup`) that deletes seeded disputes (and related packs) by a sentinel like `dispute_gid LIKE 'gid://shopify/ShopifyPaymentsDispute/seed-%'`. |

**Files to add/touch:**

- `scripts/seed-bulk-disputes.mjs` (new).
- `docs/technical.md` or README: short “Testing with bulk disputes” section.

---

## Option 2: Real Disputes in Shopify via Test Card (For Sync / E2E)

**Goal:** Get real disputes in Shopify so DisputeDesk’s sync and “disputes from Shopify” behavior can be tested.

**Reality:**

- Shopify does **not** expose a “create dispute” API.
- In **Shopify Payments test mode**, the test card **`4000000000000259`** triggers a chargeback when used at checkout.
- So: create orders (e.g. via Draft Order or Checkout), complete payment with that card; each such order will produce a dispute in the dev store.

**Ways to get multiple test disputes:**

| Approach | Description | Effort |
|----------|-------------|--------|
| **A. Manual** | Enable test mode, place N checkouts with card `4000000000259`, wait for disputes to appear. | Low, tedious for large N. |
| **B. Draft orders + manual checkout** | Use Admin API to create many draft orders, then complete each via the draft’s checkout link using the test card. | Medium; script draft creation; checkout still manual (or semi-automated). |
| **C. orderCreate (GraphQL)** | Use `orderCreate` to create orders. Payment is not taken via API; orders may be created as “pending” or unpaid. So this does **not** by itself create a paid transaction and thus **not** a dispute. Not sufficient for dispute creation. | N/A for disputes. |
| **D. Checkout automation** | Use Playwright (or similar) to open each draft checkout and submit payment with the test card. | Higher; useful for a small number of E2E “real” disputes. |

**Recommended for “real” disputes:**

- **Document** in `docs/` (e.g. “Testing with real Shopify disputes”):
  - Enable Shopify Payments test mode.
  - Use card **4000000000000259** at checkout to trigger a chargeback.
  - Optionally: create draft orders via API, then complete payment with that card (manually or via browser automation).
- **Optional script:** Add `scripts/create-draft-orders-for-disputes.mjs` that:
  - Uses existing `requestShopifyGraphQL` + session (offline) to call `draftOrderCreate` N times (e.g. simple line item, test customer).
  - Requires `write_draft_orders` (and possibly `read_products`) and re-auth after scope change.
  - Outputs draft order checkout URLs so a human (or Playwright) can complete payment with `4000000000000259`.
- **Scope:** Current app scopes do not include `write_draft_orders`; add only if you adopt this script and document the scope change.

**Implementation (minimal):**

| Step | Action |
|------|--------|
| 1 | Add a short doc section (e.g. in `docs/technical.md` or new `docs/testing-disputes.md`) describing test mode + card `4000000000259` and that there is no API to create disputes. |
| 2 | If desired: implement draft-order script, add scope `write_draft_orders`, document re-install/re-auth and rate limits (e.g. 5 orders/min on dev stores). |
| 3 | Optionally: add a small Playwright flow that completes one draft checkout with the test card for E2E “real dispute” tests. |

---

## Option 3: If Shopify Ever Adds “Create Test Dispute”

If Shopify later introduces something like `shopifyPaymentsDisputeCreate` (or a test-only equivalent):

- Add a new module under `lib/shopify/mutations/` (e.g. `disputeCreate.ts`) that calls the mutation with a known test order id and test reason/amount.
- Use `requestShopifyGraphQL` and the same session pattern as `disputeEvidenceUpdate`.
- Script could then loop over N test orders and create N disputes (respecting throttle).
- No implementation now; just a note for the future.

---

## Summary Table

| Option | Creates disputes in Shopify? | Use case | New scopes? |
|--------|------------------------------|----------|-------------|
| **1. Bulk seed (Supabase)** | No | Pipeline, UI, automation logic with many disputes | No |
| **2. Test card + drafts** | Yes | Real sync, E2E with Shopify disputes | Optional `write_draft_orders` |
| **3. Future API** | Yes (if/when available) | Scripted bulk disputes in Shopify | Depends on API |

---

## Recommended Order of Work

1. **Implement Option 1** (bulk seed script + cleanup + doc). Delivers immediate value for dev and QA without scope or Shopify changes.
2. **Document Option 2** (test mode + card + optional draft-order script) so the team can create a few real disputes when needed.
3. **Defer Option 3** until Shopify exposes a create-test-dispute API.

---

## Webhooks for dispute events

DisputeDesk currently keeps disputes in sync via:

1. **Cron** — `GET /api/cron/sync-disputes` runs every 5 minutes and enqueues a `sync_disputes` job per installed shop.
2. **Manual sync** — "Sync Now" on the Disputes page triggers a sync for the current shop.

There is **no dispute webhook handler yet**. The app has a TODO in `app/api/webhooks/shop-update/route.ts` to register `disputes/create` or `disputes/update` when available for the pinned API version. The help copy mentions "webhooks when disputes are created or updated" but the backend does not yet subscribe to or handle those events.

**If you add dispute webhooks:**

- **Register** the webhook topic(s) with Shopify (e.g. `disputes/create`, `disputes/update`) via the [WebhookSubscription](https://shopify.dev/docs/api/admin-graphql/latest/mutations/webhooksubscriptioncreate) GraphQL API (or Partner Dashboard). Registration typically needs to happen after install or on shop/update so each store gets the subscription.
- **Create a handler** — e.g. `POST /api/webhooks/disputes-create` (and optionally `disputes-update`) that:
  1. Verifies the request with `verifyShopifyWebhook(rawBody, x-shopify-hmac-sha256)` (reuse `lib/webhooks/verify.ts`).
  2. Parses the payload for shop domain and dispute id (or admin_graphql_api_id).
  3. Enqueues a `sync_disputes` job for that shop (or runs a single-dispute fetch and upsert) so the new/updated dispute is reflected without waiting for the next cron run.

That gives real-time dispute ingestion when Shopify sends the webhook, and fits the existing sync pipeline (same `syncDisputes` logic, just triggered by webhook instead of only cron/manual).

---

## References

- Current dispute queries: `lib/shopify/queries/disputes.ts` (read-only; no create mutation).
- Smoke test (single dispute seed): `scripts/smoke-test.mjs`.
- Shopify Payments testing: [Testing Shopify Payments](https://help.shopify.com/en/manual/payments/shopify-payments/testing-shopify-payments) (test card `4000000000000259` for chargeback).
- **Shopify Dev Docs (GraphQL Admin API):**
  - [Admin GraphQL API overview](https://shopify.dev/docs/api/admin-graphql)
  - [ShopifyPaymentsDispute](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsDispute) — dispute data; read/update evidence only; no create mutation.
  - [DraftOrder](https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder) — create draft orders.
  - Mutations: `draftOrderCreate`, `draftOrderComplete` for order creation; dispute queries via `shopifyPaymentsAccount.disputes`.
- Order creation: `orderCreate` / `draftOrderCreate` (Shopify Admin API); payment with test card is done at checkout, not via mutation.
