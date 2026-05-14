# LSE-4 Storefront Session Capture

## Architecture

Two zero-config storefront surfaces capture session signals, joined to
orders by `cart_token`:

| Surface | When it fires | Merchant install action |
|---------|---------------|-------------------------|
| **Web Pixel** (`extensions/dispute-desk-pixel/`) | Every storefront `page_viewed`, `checkout_started`, `checkout_completed` | Auto-installs with the app — no merchant action |
| **Checkout UI extension** (`extensions/dispute-desk-checkout/`) | Mounts at the checkout step; captures final login state + cart_token | Auto-installs; `network_access` approved at OAuth screen during app install |

No theme app embed. No merchant-pasted shop ID. The shop is identified
by `shop_domain` (foo.myshopify.com) which every Shopify surface exposes
at runtime; the server resolves it to the DisputeDesk shop_id via the
cached `resolveShopIdFromDomain` helper.

## Server-side modules

| File | Purpose |
|------|---------|
| [`ingest.ts`](./ingest.ts) | Validates payload, hashes/encrypts IP, persists `checkout_sessions` row, enriches customer tenure |
| [`enrichCustomerTenure.ts`](./enrichCustomerTenure.ts) | Looks up `customer.createdAt` via Shopify Admin GraphQL when caller doesn't supply tenure (cached 1h per shop+customer) |
| [`resolveShopFromDomain.ts`](./resolveShopFromDomain.ts) | Maps `foo.myshopify.com` → `shops.id` via Supabase (cached 60s) |
| [`expireSessions.ts`](./expireSessions.ts) | Nightly retention job — hard-deletes rows past `retention_expires_at` (default 18 months) |

## API endpoints

- `POST /api/sessions/ingest` — fail-open ingest, CORS-enabled for `*`, accepts `shop_domain` or `shop_id`
- `POST /api/sessions/forget` — LGPD/GDPR/CCPA subject-deletion by `customer_id` or `cart_token`

## Privacy controls (non-negotiable)

- DNT and GPC honored at the server boundary (request headers OR body payload)
- IP hashed at rest with per-shop salt; raw IP encrypted via AES-256-GCM, decryption only during qualification
- 18-month TTL via the nightly retention job
- Never captures form input values
- Subject-deletion endpoint for right-to-be-forgotten requests

## Privacy compliance follow-ups (before public launch)

- [ ] Add `matchSessionToOrder({ cartToken, shopifyOrderId })` call to the existing `orders/create` webhook handler
- [ ] Wire `expireCheckoutSessions` to a Vercel cron slot
- [ ] LGPD / GDPR / CCPA legal-review doc at `docs/privacy/lse4-review.md`
- [ ] Merchant privacy-policy template translated to all 6 locales
- [ ] Subject-access export endpoint companion (`GET /api/sessions/export`)
- [ ] DPA template available in the merchant onboarding flow

## Why two surfaces, not one

- The Web Pixel covers the breadth: every page-view, every checkout-flow milestone
- The Checkout UI extension is the **authoritative** source for `customer_login_state_at_checkout` because it runs in the checkout context after the customer-step decision is final
- Both upsert against the same `(shop_id, cart_token)` row — the latest write wins
