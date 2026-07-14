# Migrate to Expiring Offline Tokens

**Status:** Implemented (2026-07-15) — all 3 stages shipped on branch
`feat/shopify-expiring-offline-tokens`. See `docs/technical.md` §
"Expiring Offline Tokens" for the shipped design. Live verification
(installed-base upgrade on a real embedded load) still pending — see
that section's "Verification" note.
**Created:** 2026-06-15
**Trigger:** Escalated from "parked" — Shopify is now **actively rejecting** Admin API calls made with legacy non-expiring offline tokens (`[API] Non-expiring access tokens are no longer accepted for the Admin API`). Observed on the dev shop `surasvenne` (blocks policy ingest *and every other background Admin call*).

## 1. Problem

Shopify deprecated non-expiring offline access tokens. They are no longer leading-edge-nudge — they **fail the request**. DisputeDesk currently mints and stores **non-expiring** offline tokens, so any shop whose token predates this cutover can no longer make background Admin API calls (dispute sync, pack build, policy ingest, webhooks re-registration, currency fetch — all of it).

Expiring offline tokens are: 1-hour `access_token` + 90-day `refresh_token`, refreshed server-side via `grant_type=refresh_token`. (Verified against Shopify docs 2026-06-15.)

## 2. Current state (verified against code)

- **Token-exchange route** ([app/api/auth/shopify/token-exchange/route.ts](../../app/api/auth/shopify/token-exchange/route.ts)) uses the correct `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, but the request body **omits `expiring=1`** → still mints non-expiring tokens. Stores with `expiresAt: null`, no refresh token.
- **Critical gap:** the route does `if (!existing) { exchange }` — when an offline session already exists, it **skips the exchange entirely**. So a shop with a legacy non-expiring token never re-exchanges, even though that token is now rejected. (This is why `surasvenne` is stuck despite reinstalls hitting this path.)
- **Code-grant flow** ([lib/shopify/auth.ts](../../lib/shopify/auth.ts) `exchangeCodeForToken`) POSTs `{client_id, client_secret, code}` with no `grant_type` — the deprecated classic flow — and also mints non-expiring tokens. Middleware falls back to `/api/auth/shopify` (code-grant) when no `id_token` is present.
- **Schema** ([001_core_shops_sessions.sql](../../supabase/migrations/001_core_shops_sessions.sql)): `shop_sessions(… access_token_encrypted, key_version, scopes, expires_at, …)`. Has `expires_at` but **no `refresh_token` / `refresh_token_expires_in` / token-variant flag**.
- **Background session loader** ([lib/shopify/sessions/getShopBackgroundSession.ts](../../lib/shopify/sessions/getShopBackgroundSession.ts)) → `loadSession` returns the decrypted `access_token` with no expiry awareness or refresh.

## 3. Shopify API contract (verified 2026-06-15)

- **Mint expiring (token-exchange):** add `expiring=1` to the existing exchange body. Response: `{ access_token, expires_in (3600), refresh_token, refresh_token_expires_in (7776000 = 90d) }`.
- **Refresh:** POST `/admin/oauth/access_token` with `grant_type=refresh_token` + the stored `refresh_token` → new access + refresh tokens.
- **Migrate a legacy token:** token-exchange with `subject_token_type=…offline-access-token` + `expiring=1`. **The old token is revoked on success — irreversible.** Requires a current `id_token` (i.e. happens on an embedded load).

## 4. Design — three independent stages

Each stage is shippable on its own; together they fully migrate the base.

### Stage 1 — Schema + storage (foundation)
New migration: add to `shop_sessions`
```sql
refresh_token_encrypted text,           -- AES-GCM, same as access token
refresh_token_expires_at timestamptz,   -- now + refresh_token_expires_in
token_expiring           boolean not null default false  -- true once on the new variant
```
- Extend `storeSession` / `loadSession` / `StoredSession` to carry `refreshToken`, `refreshTokenExpiresAt`, `tokenExpiring`. Encrypt the refresh token with the existing `lib/security/encryption` (key-version aware).
- `expires_at` already exists — start populating it (`now + expires_in`).

### Stage 2 — Mint + refresh (new tokens are expiring; auto-refresh on expiry)
- **Mint:** add `expiring: "1"` to the token-exchange body; persist `refresh_token`, both expiries, `token_expiring = true`.
- **Refresh helper:** `lib/shopify/sessions/refreshOfflineToken.ts` — POST `grant_type=refresh_token`, persist the rotated pair. Concurrency-safe (a per-shop in-process lock or a short DB advisory lock) so parallel jobs don't double-refresh.
- **Wire into the read path:** `getShopBackgroundSession` (and the interactive equivalent) checks `expires_at`; if expired/near-expiry **and** `token_expiring`, refresh before returning. Threaded through `makeAuthedRequest` so every Shopify call benefits without per-caller changes.
- **Belt-and-suspenders:** in `requestShopifyGraphQL`, detect the `ACCESS_DENIED`/"token expired" auth-error shape and trigger one refresh-and-retry (handles clock skew / early expiry).

### Stage 3 — Migrate the installed base off legacy tokens
- On embedded load (token-exchange route), if the stored session is **not** `token_expiring`, run token-exchange with `subject_token_type=offline-access-token` + `expiring=1` to upgrade it in place. **Remove the `if (!existing) skip`** so an existing-but-legacy session is upgraded instead of skipped. (This single change unblocks `surasvenne`.)
- Because the old token is revoked on exchange, gate on a current `id_token` (embedded load only) — never attempt from a pure background path that has no id_token.
- Code-grant fallback ([auth.ts](../../lib/shopify/auth.ts)): kill or make it also mint expiring tokens. Prefer routing all re-auth through token-exchange; keep code-grant only as a last resort and make it `expiring=1` too if retained.

## 5. Plan of work (commits)

1. Migration + storage layer (Stage 1) — run `npm run db:migrate:dev` (then prod). Tests for round-trip encrypt/decrypt of refresh token.
2. Mint expiring + refresh helper + read-path wiring (Stage 2) — unit tests: refresh request shape, expiry math, concurrency lock, refresh-on-401 retry.
3. Installed-base migration on embedded load + remove the `!existing` skip + code-grant cleanup (Stage 3).
4. Docs (`docs/technical.md` auth section) + update the parked memory.

## 6. Testing

- Unit: token-exchange body includes `expiring=1`; refresh persists rotated pair; `getShopBackgroundSession` refreshes when `expires_at` is past and `token_expiring`; never refreshes a legacy (`token_expiring=false`) session from a background path.
- **Live dev E2E (the real proof):** on `surasvenne`, open the embedded app → Stage 3 upgrades the token → query `shop_sessions` (DEV DB — confirm linked ref per the DB-target guard) to confirm `token_expiring=true` + a refresh token present → run policy ingest → policies pull. Then force-expire (set `expires_at` in the past on dev) and confirm the next call auto-refreshes.
- `npm run release:verify` green.

## 7. Risks / notes

- **Irreversible migration:** exchanging a legacy token revokes it. If the new token isn't persisted atomically, the shop is locked out → must `storeSession` the new pair **before** returning success, and never exchange twice concurrently.
- **Refresh races:** multiple background jobs for one shop can refresh simultaneously; the second refresh with a rotated-away refresh token fails. Needs the per-shop lock (Stage 2).
- **`expiring=1` is per-request, set at mint time** — there's no app-config toggle, so both the token-exchange route AND any retained code-grant path must set it, or some installs silently stay legacy.
- Scope rollout (`read_legal_policies`) and this are orthogonal but compound: a shop needs BOTH the new scope AND a working (expiring) token before policy ingest succeeds.
