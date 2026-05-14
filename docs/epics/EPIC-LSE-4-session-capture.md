# EPIC LSE-4 — Session Evidence Capture

> **Status:** Planned
> **Phase / week target:** Phase 4 of Liability-Shift Engine — Weeks 19–26
> **Dependencies:** EPIC LSE-1, EPIC LSE-2 (qualification + package consume the data)
> **Track:** LSE (Liability-Shift Engine)
> **Source PRD:** [`docs/liability-shift-engine-prd.md`](../liability-shift-engine-prd.md) §7

## Goal

Capture privacy-safe storefront session signals (IP, user agent, login state, page views, time on checkout) on the merchant's Shopify storefront, match those sessions to the resulting orders via `cart_token`, and store them so that LSE-1 / LSE-3 qualification has the data it needs to find IP and device anchors for CE 3.0 and to score the FPT Device + Identity categories.

This epic is forward-looking: it doesn't help disputes filed *before* install; it builds the evidence base for every dispute *after* install. Without it, the qualification rates from LSE-1 / LSE-3 stay artificially low because matching data is sparse.

## Non-goals (explicit)

- **v2 capture set** (device fingerprint composite, mouse/scroll entropy, ASN detail, cross-session cookie linkage) — explicitly deferred to a later epic gated on per-region legal review
- Bot detection / fraud scoring on its own (not what LSE is for)
- Capturing form input values — never
- Storing raw IPs unencrypted at rest

## Architecture

```
[Merchant storefront]
   │
   ├─ App Embed Block (theme app extension)   ←─ primary install surface
   │     loads dispute-desk.js, async, <50ms hard timeout, fail-open
   │
   ├─ Web Pixel (Shopify-sandboxed)           ←─ page-view + behavioral events
   │     emits page_viewed, checkout_started, cart_token bound
   │
   └─ Checkout UI Extension                    ←─ checkout-context capture
         binds session to cart_token at checkout
              │
              ▼
   POST /api/sessions/ingest  (debounced, on order intent only)
              │
              ▼
   checkout_sessions table (Postgres)
              │
              ▼
   orders/create webhook from Shopify
              │
              ▼
   matchSessionToOrder(cart_token) → fills shopify_order_id
              │
              ▼
   LSE-1 / LSE-3 qualification has session data available
```

**Touchpoints:**
- New theme extension: `shopify-extensions/theme/dispute-desk-embed/`
- New web pixel extension: `shopify-extensions/web-pixel/dispute-desk-pixel/`
- New checkout UI extension: `shopify-extensions/checkout/dispute-desk-checkout/`
- New module: `lib/liabilityShift/sessions/ingest.ts`
- New module: `lib/liabilityShift/sessions/matchToOrder.ts`
- New API: `POST /api/sessions/ingest` (high-volume, IP-hashed, debounced)
- Webhook handler extension: bind cart_token → session row in `orders/create` handler

## v1 capture set (privacy-safe defaults)

| Field | Source | Notes |
|-------|--------|-------|
| `cart_token` | App Bridge / pixel checkout-started event | Join key to order |
| `session_started_at` | Embed first load timestamp | |
| `user_agent` | Browser | |
| `ip_hash` | Server (sha256 of raw IP + per-shop salt) | At rest |
| `ip_raw` | Server | Encrypted via AES-256-GCM (existing `lib/security/`), 18-month TTL |
| `ip_geo` | MaxMind or Cloudflare header | Country + region only, no city |
| `customer_id` | App Bridge if logged in | |
| `customer_account_age_days` | Shopify customer fetch on session ingest | |
| `customer_login_state_at_checkout` | Checkout UI extension | |
| `session_history` | Pixel `page_viewed` events | Page paths, dwell time |
| `time_on_checkout_page` | Pixel checkout enter/exit | |
| `consent_signals` | DNT header, GPC header | |

**Never captured in v1:** form field values, canvas/WebGL fingerprint, audio fingerprint, font list, mouse position, scroll behavior, cross-storefront linkage.

## v2 capture set (out of scope here — future epic)

Composite device fingerprint, behavioral entropy, ASN/connection detail, cross-session cookie. Each requires region-specific legal review (LGPD, GDPR, CCPA) and merchant opt-in. Not in this epic.

## Database changes

Migration: `supabase/migrations/NNN_lse_session_capture.sql`

### New table: `checkout_sessions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `shop_id` | uuid FK | |
| `cart_token` | text | Indexed unique per shop |
| `session_started_at` | timestamptz | |
| `order_placed_at` | timestamptz nullable | Filled on match |
| `shopify_order_id` | text nullable | Filled on match |
| `ip_hash` | text | sha256(ip + shop-salt) |
| `ip_raw_encrypted` | bytea | AES-256-GCM ciphertext, TTL 18m |
| `ip_geo_country` | text nullable | |
| `ip_geo_region` | text nullable | |
| `user_agent` | text | |
| `customer_id` | text nullable | |
| `customer_account_age_days` | int nullable | |
| `customer_login_state_at_checkout` | text nullable | `logged_in`, `guest`, `unknown` |
| `session_history` | jsonb | Page paths + dwell ms |
| `time_on_checkout_page_ms` | int nullable | |
| `consent_signals` | jsonb | `{dnt: bool, gpc: bool}` |
| `retention_expires_at` | timestamptz | Default now() + 18 months |
| `created_at` | timestamptz | |

### Indexes
- `(shop_id, cart_token)` unique
- `(shop_id, shopify_order_id)` for lookup during qualification
- `(retention_expires_at)` for the nightly retention job

RLS: shop-scoped.

### Retention job

Nightly job `expire_checkout_sessions` deletes rows where `retention_expires_at < now()`. Audit-logged via existing audit framework.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions/ingest` | High-volume ingest from storefront. Auth via short-lived shop token issued by embed block. Hashes IP server-side. |
| POST | `/api/sessions/:id/forget` | LGPD/GDPR subject-deletion endpoint, callable by merchant for a specific cart_token or customer_id |
| GET | `/api/sessions/export?customer=…` | Subject-access export for a customer |

## Storefront install path

Per PRD §7:

1. **App embed block** (primary) — merchant toggles in theme editor; loads `dispute-desk.js` async with 50ms hard timeout and fail-open behavior so it never blocks checkout
2. **Shopify Web Pixel** — sandboxed event capture, no script-tag risk
3. **Checkout UI extension** — order-context capture at checkout step

We use all three layered because each captures something the others can't:
- Embed → IP + page-view dwell on storefront before checkout
- Pixel → checkout-flow events
- Checkout UI → cart_token binding + login state at the moment of order

## Privacy & compliance (non-negotiable)

| Requirement | Implementation |
|-------------|----------------|
| Disclosed in merchant privacy policy | Provide template language in onboarding |
| Honor DNT | Drop record server-side if DNT=1, regardless of merchant settings |
| Honor GPC | Drop record server-side if GPC=1 |
| 18-month TTL | `retention_expires_at` + nightly job |
| Hash IPs at rest | sha256 + per-shop salt; raw IP encrypted separately |
| Never capture form input values | Pixel allowlist; no DOM scraping |
| Subject access | `GET /api/sessions/export` |
| Subject deletion | `POST /api/sessions/:id/forget` |
| Brazil LGPD | Register as data processor; merchant is controller. Template DPA |

**Legal-review gate:** before merging the public release of this epic, the v1 capture set goes through one round of external privacy review (LGPD focus for the Brazil priority). Document outcomes in a new `docs/privacy/lse4-review.md` (will be created during the epic, not now).

## UI changes

### Onboarding
- New step: "Enable evidence capture"
  - Explains what is and isn't captured (plain-language list)
  - Toggles each install layer (embed / pixel / checkout extension) — default ON for all three
  - Shows merchant privacy-policy template to copy
- Surface DNT / GPC compliance state

### Settings → Privacy
- View current capture mode
- Download merchant DPA template (PDF)
- Manually trigger a subject-access export for a customer

### Dispute detail
- "Session evidence available" indicator under each prior order in the LSE-1 / LSE-3 panels
- Tooltip explaining where the data came from

## Performance & reliability budget

| Constraint | Target |
|-----------|--------|
| Embed script load impact on storefront | < 50ms hard timeout, async, fail-open |
| Ingest endpoint p95 latency | < 200ms |
| Ingest endpoint failure mode | drop silently; never break checkout |
| Pixel event volume | tolerate 100 events/min per shop without back-pressure |
| Match success rate | > 95% of orders should have a session row matched within 60s of order create |

## Acceptance criteria

- [ ] Migration applied via `npm run db:migrate` in the same session
- [ ] All three storefront extensions build and pass Shopify CLI validation
- [ ] Embed script loaded on a dev-store storefront fires `POST /api/sessions/ingest` with expected payload
- [ ] DNT / GPC headers cause server to drop the record (verified by integration test)
- [ ] `matchSessionToOrder` called from `orders/create` webhook fills `shopify_order_id` for 100% of test orders
- [ ] Nightly retention job deletes rows older than 18 months on a seeded test set
- [ ] Subject-access export endpoint returns a complete record for a given customer
- [ ] Subject-deletion endpoint deletes the matching rows
- [ ] LGPD/GDPR/CCPA privacy review document in `docs/privacy/lse4-review.md`
- [ ] Merchant privacy-policy template added under `messages/{locale}.json` (`privacyTemplate.*`) — translated to all 6 locales
- [ ] LSE-1 qualification uses `checkout_sessions.ip_raw` (decrypted) when matching IP across the disputed and prior orders; verified by an end-to-end test
- [ ] Embed performance verified with Shopify's Theme Inspector — script loads async with no impact on LCP
- [ ] `docs/technical.md` updated with §*Session Evidence Capture* (capture set, retention, privacy controls)
- [ ] Help article in `lib/help/` updated explaining what merchants are agreeing to when they enable capture
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run test:e2e` all green
