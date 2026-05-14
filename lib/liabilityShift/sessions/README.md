# LSE-4 Storefront Session Capture

## Backend status (this directory)

- `ingest.ts` — debounced session ingest (DNT/GPC honored, IP hashed + encrypted at rest)
- `expireSessions.ts` — 18-month TTL retention job
- `app/api/sessions/ingest/route.ts` — POST endpoint (fail-open)
- `app/api/sessions/forget/route.ts` — POST endpoint (LGPD/GDPR/CCPA subject-deletion)

Backend is **ready to receive data** as of LSE-4 v1. Storefront extensions
that send the data are scaffolded but not yet generated — see below.

## Storefront extensions — CLI commands to run (you)

The three storefront capture surfaces require `shopify app generate
extension` to be run from your machine. Each command emits scaffolding
under `extensions/<name>/`. Edit those scaffolds to call our ingest
endpoint with the v1 payload.

### 1. Theme app embed (primary install surface)

```bash
npx shopify app generate extension --type=theme_app_extension --name=dispute-desk-embed
```

In the generated `blocks/dispute-desk-embed.liquid`, load a small JS
file that, on `DOMContentLoaded`, debounces and POSTs to
`/api/sessions/ingest` with:

```js
{
  shop_id: "{{ shop.id }}",         // or pass via app proxy if cross-domain
  cart_token: "{{ cart.token }}",
  user_agent: navigator.userAgent,
  session_started_at: new Date().toISOString(),
  customer_id: "{{ customer.id | default: '' }}",
  customer_account_age_days: /* derive from customer.created_at */,
  customer_login_state_at_checkout: "{{ customer.id | size > 0 ? 'logged_in' : 'guest' }}",
  session_history: /* maintained client-side */,
  time_on_checkout_page_ms: /* derived */
}
```

Async load. 50ms hard timeout. Never block checkout.

### 2. Shopify Web Pixel

```bash
npx shopify app generate extension --type=web_pixel_extension --name=dispute-desk-pixel
```

Subscribe to:
- `page_viewed` → append to session_history
- `checkout_started` → bind cart_token, kick off ingest
- `checkout_completed` → final flush

Post via `fetch` to `/api/sessions/ingest`. Pixel sandbox limits direct
DOM access — we only need event metadata.

### 3. Checkout UI extension

```bash
npx shopify app generate extension --type=checkout_ui_extension --name=dispute-desk-checkout
```

Use the `useCustomer` and `useApi` hooks to read login state at the
exact checkout step. POST the final session ingest with
`customer_login_state_at_checkout` set authoritatively.

## After CLI generation

1. Wire each extension's JS to call `POST /api/sessions/ingest` with the
   payload shape in `ingest.ts`'s `SessionIngestPayload` interface.
2. Test the embed on a dev store: verify `checkout_sessions` rows are
   written, IP hash is non-empty, DNT/GPC headers cause `dropped: true`.
3. Validate match-back: on the next order from the same cart, the
   webhook handler in the existing orders/create flow should call
   `matchSessionToOrder` to fill `shopify_order_id`.

## Privacy compliance checklist

Before public LSE-4 rollout, complete:

- [ ] Add `lib/liabilityShift/sessions/matchSessionToOrder` call to the
      orders/create webhook handler
- [ ] Wire `expireCheckoutSessions` to a nightly cron slot
- [ ] LGPD / GDPR / CCPA legal-review doc at `docs/privacy/lse4-review.md`
- [ ] Merchant privacy-policy template translated to all 6 locales
- [ ] Subject-access export endpoint companion (`GET /api/sessions/export`)
- [ ] DPA template available in the merchant onboarding flow

## Why this is the right shape

Per EPIC-LSE-4 §Privacy:
- Privacy-safe v1 capture set only — no device fingerprinting yet.
- DNT / GPC honored at the server boundary, not just the client (defense
  against malicious or buggy storefront installs).
- IPs hashed for query performance; raw encrypted, decrypt-only at
  qualification time.
- 18-month TTL via DB column + nightly job — covers the 365-day CE 3.0
  prior window plus buffer.

See `docs/epics/EPIC-LSE-4-session-capture.md`.
