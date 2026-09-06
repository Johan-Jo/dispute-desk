# Development-store gate — detect, starve, and (optionally) refuse

**Status:** PLAN ONLY (v1, 2026-08-27). Not started.
**Problem:** Tyre-kickers install DisputeDesk from the App Store on **partner development stores** to look around. They consume install-time provisioning (webhooks, pixel, two backfills, policy ingest), pollute the shop list and the install alerts, and see the whole product.
**Deliverable:** classify every install as dev-store or real, **allow-list the stores we own**, skip all provisioning and all recurring work for gated dev stores, show them a limited-mode screen, and keep a default-off env flag that upgrades the gate to a hard install refusal.
**Branch/PR:** `feat/dev-store-gate` → `develop`. Prod deploy needs separate per-change approval (CLAUDE.md #9).

---

## 0. What the live probe found (2026-08-27, prod tokens)

Ran `shop { name setupRequired plan { partnerDevelopment publicDisplayName shopifyPlus } }` against every
non-uninstalled prod shop using its stored offline token (`tmp/probe-shop-plans.mjs`, not committed):

| Shop | `partnerDevelopment` | `publicDisplayName` | orders | disputes |
|---|---|---|---|---|
| blume-box | **false** | Plus | 360 761 | 473 |
| cay-collective | **false** | Advanced | 14 215 | 74 |
| **surasvenne** | **true** | **Basic** | 6 321 | 48 |
| sharpdesk | **true** | Grow | 0 | 0 |
| maja-esgcxzxs | **true** | Basic | 0 | 0 |
| isj-153 | — | — (offline token 401s) | 4 | 0 |
| daniel-store-wh0b7w15 | — | — (offline token 401s) | 0 | 0 |

Three findings that change the design:

1. **`surasvenne` — our own store — is a partner development store.** Any gate keyed on
   `partnerDevelopment` alone takes our own production-data store offline. The allow-list is
   **load-bearing**, not a nicety, and must land in the same commit as the detection.
2. **`plan.publicDisplayName` cannot detect a dev store.** Dev stores report the plan they were
   set to — `Basic`, `Grow` — never `Development`. Only `partnerDevelopment` works.
   (`displayName` is deprecated; do not use it.) `setupRequired` was `false` everywhere, including
   the tyre-kickers — useless as a signal.
3. **Two live shops 401 on their offline token.** A classification call at install time can and
   will fail. The gate **must fail open** (unknown ⇒ treated as real) and re-check later.

Historical evidence for the review risk: `app-review-7d9b6af8-r37184-a0.myshopify.com` installed and
uninstalled on 2026-06-26 — Shopify's own App Store reviewer store, on exactly the store type we
would be gating.

---

## 1. The gate

```
gated  = detected_dev_store AND NOT allowed
allowed = shops.dev_store_allowed        -- per-shop override, admin-flippable
        OR domain ∈ DEV_STORE_ALLOWLIST   -- env, comma-separated, `*` suffix wildcard
        OR domain matches app-review-*    -- built-in, never removable
```

`detected_dev_store` is exactly `shop.plan.partnerDevelopment === true`. Unknown (call failed) is
**not** dev — fail open.

New module **`lib/shopify/shopPlan.ts`**:

- `fetchShopPlan(shopInternalId)` → `{ partnerDevelopment, publicDisplayName } | null` — one Admin
  GraphQL call, `null` on any failure (401 / network / schema drift), logged in the shape
  `shopDetails.ts:93-99` already uses so the next field deprecation is diagnosable.
- `classifyAndPersist(shopInternalId, shopDomain)` — fetches, writes `is_dev_store`,
  `plan_public_name`, `plan_checked_at`, returns the effective `{ gated }`.
- `isDevStoreGated(shopInternalId)` — pure DB read, no Shopify call. The single function every
  consumer calls.
- `isAllowlisted(shopDomain)` — env + built-in pattern, unit-tested.

Built-in allow-list note: anyone can register an `app-review-*` handle, so the pattern is a soft
bypass. Acceptable — the gate limits features, it does not protect data.

## 2. Schema

`supabase/migrations/20260827_dev_store_gate.sql`:

```sql
alter table shops add column if not exists is_dev_store boolean;              -- null = unknown
alter table shops add column if not exists plan_public_name text;
alter table shops add column if not exists plan_checked_at timestamptz;
alter table shops add column if not exists dev_store_allowed boolean not null default false;

-- Our own dev stores, allow-listed in the same statement that makes detection possible.
update shops set dev_store_allowed = true
 where shop_domain in ('surasvenne.myshopify.com');
```

Applied with `npm run db:migrate:dev` in the same session (CLAUDE.md #1); prod applies at prod deploy.

## 3. Install-path wiring

**`app/api/auth/shopify/callback/route.ts`** — offline phase, immediately after `storeSession`
(line 138), before the fan-out at lines 208–315:

- `await classifyAndPersist(...)` alongside the already-awaited `fetchShopDetails` (same 401-prone
  moment, already on the critical path for the install email — no new latency class).
- If gated, **skip**: `registerDisputeWebhooks` (208), `registerOrderWebhooks` (224),
  `persistShopCurrency` (241), `ingestShopifyPolicies` (253),
  `enqueueShopDailyMetricsBackfill` (265), `registerWebPixel` (278),
  `resetBackfillIfScopeUpgraded` + `enqueueShopOrdersBackfill` (308),
  `grantFreeLifetimeCredits` (170), and `seedDefaultStoreAutomation` (via `ensureShopSetup`,
  line 623 — a gated store must **not** get auto-pilot switched on).
- Install alert still sends, subject prefixed `[dev store]`
  (`lib/email/sendAdminNotification.ts`, new `isDevStore` option) — we want to know they came; we
  just want the inbox to stop calling them merchants.
- Welcome email (portal path) suppressed.
- Redirect unchanged: they land in the app and meet §6.

**`app/api/auth/shopify/token-exchange/route.ts`** — same treatment around `registerDisputeWebhooks`
(173) and `persistShopCurrency` (186); classification here is lazy (§4) so this path never adds a
blocking Shopify call.

## 4. Late classification and un-gating

Two reasons this cannot be install-time-only: the token 401s (§0.3), and a dev store that is
**transferred to a real merchant flips `partnerDevelopment` to false** — agencies legitimately build
on a dev store and hand it over. So:

- `GET /api/shop/dev-store-state` → `{ gated }`, re-running `classifyAndPersist` when
  `plan_checked_at` is null or older than 24 h. One Shopify call per shop per day, on an embedded
  load we were serving anyway.
- Un-gating is automatic: the same call clears `is_dev_store` when the flag flips, and every
  consumer reads the DB. The provisioning skipped at install is **re-enqueued at that moment**
  (webhooks, backfills, pixel) — otherwise a transferred store stays silently half-installed forever.

## 5. What a gated shop does not get

| Path | Anchor | Behaviour |
|---|---|---|
| Dispute sync | `lib/disputes/syncDisputes.ts:139` | early-return `{skipped:"dev_store"}` — no disputes ⇒ no packs ⇒ no LLM spend |
| Orders backfill | `lib/jobs/handlers/backfillOrdersJob.ts:50` | skip |
| Pack build | `lib/jobs/handlers/buildPackJob.ts:394`, `buildDefencePackageJob.ts:168` | refuse (belt-and-braces behind the sync gate) |
| Daily / fraud snapshots | `cron/snapshot-daily-metrics/route.ts:30`, `snapshot-fraud-daily-metrics/route.ts:30` | exclude from enumeration |
| Ratios, digests, reconciliation, plan recs | `calculate-ratios:34`, `monthly-digest:40`, `orders-reconciliation:57`, `plan-recommendations:43` | exclude from enumeration |

One shared predicate, not seven copies: `applyDevStoreFilter(query)` in `lib/shopify/shopPlan.ts`
appending `.or("is_dev_store.is.null,is_dev_store.eq.false,dev_store_allowed.eq.true")`, plus a
vitest that enumerates the shop-enumerating cron routes (mirroring the existing `cronEnvGate`
enumeration test) and fails on any that forgot it.

## 6. Limited mode in the embedded app

- `app/(embedded)/app/DevStoreBanner.tsx`, modelled on `DashboardScopeUpgradeBanner.tsx` — Polaris
  `Banner`, tone `info`, **not dismissible**, above the dashboard.
- Copy: DisputeDesk works on stores with live Shopify Payments disputes; this is a development
  store, so syncing and evidence building are off — plus "if this is your store and it's going live,
  contact support@disputedesk.app".
- Data sections render their existing empty states (they are already empty at 0 disputes), so no new
  layout work.
- i18n: new `devStore` namespace in all six locales (en/de/es/fr/pt/sv), no English in `lib/`
  (CLAUDE.md #5); `scripts/verify-i18n-parity.mjs` enforces parity.

## 7. Hard block (default off)

`BLOCK_DEV_STORES=1` upgrades §3 from starve to refuse: the callback stops before `storeSession`,
renders a branded "DisputeDesk isn't available on development stores" page, and never creates the
`shops` row. Default **off**, and it must stay off while an App Store submission is in flight —
Shopify's reviewer arrives on exactly the store type this refuses
([Pass app review](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review)), and the
built-in `app-review-*` allow-list is a guess about a naming convention, not a contract.
Recommended posture: ship §1–§6, leave §7 dark, and only consider flipping it between submissions.

## 8. Admin visibility

`app/admin/shops/page.tsx` — a `Dev store` badge column. `app/admin/shops/[id]/page.tsx` — an
"Allow this development store" toggle writing `shops.dev_store_allowed`, so allow-listing a partner
or a friendly test store never needs a deploy.

## 9. Backfill

One-off `scripts/sql/classify-existing-shops.sql` plus a short script run against the 12 existing
prod shops. Expected outcome: `surasvenne` allowed; `sharpdesk` and `maja-esgcxzxs` gated;
`blume-box` and `cay-collective` untouched; `isj-153` and `daniel-store-wh0b7w15` stay `null`
(dead tokens) and therefore ungated until they next open the app.

## 10. Tests

- `isAllowlisted` — env parsing, wildcard, `app-review-*`, case/whitespace.
- `classifyAndPersist` — dev-true, dev-false, fetch-failure-is-not-dev, transfer flips back and
  re-enqueues provisioning.
- Callback: a gated install asserts all eight fan-out calls **not** called; an ungated install is
  unchanged (guards the existing install regression tests).
- `surasvenne.myshopify.com` gets an explicit named test asserting it is never gated.
- Cron enumeration test (§5).
- `npm test`, `npx tsc --noEmit`, `npm run build`.

## 11. Out of scope

- Blocking the App Store install button — Shopify has no such setting; a public listing is public.
- Storefront password / "not published" detection — no Admin GraphQL field exists (the old REST
  `shop.password_enabled` has no GraphQL equivalent). `partnerDevelopment` is the only reliable
  signal.
- Deleting data already collected from gated stores.
