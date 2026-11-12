# Admin section repair — ledger

Plan: `admin-section-repair.plan.md`. One row per defect: symptom → evidence → root cause → status.
Sources so far: static audit + read-only prod measurement (`db:query:prod --read-only`, guard re-confirmed per command). No live sweep yet (needs the owner's signed-in admin session).

## Batch 1 — Overview, Billing, billing data (this PR)

| # | Page / route | Symptom | Evidence | Root cause | Status |
|---|---|---|---|---|---|
| 1 | Overview, Billing, Shops list | MRR / "Active Subscriptions" counted plan labels, not payment | Prod 2026-11-12: 5 shops; label MRR $516 (4×Growth); only 2 have `first_paid_cycle_started_at` → $258. 1 Growth shop has no `plan_entitlements` row; 1 `active` with a subscription GID has never had a paid cycle | MRR = `PLANS[shops.plan].price` | fixed (`paidSubscriptions.ts`) |
| 2 | Billing | "Active Subscriptions" and ARPS used all installed shops (free included) | `billing/route.ts` + page: `totalShops` = every installed shop | wrong denominator | fixed (Paying Subscribers, ARPU over paying shops) |
| 3 | Overview | Packs/jobs/shops totals freeze at 1000 | `evidence_packs`, `jobs`, open `disputes`, `shops` selected un-ranged (PostgREST cap) | no pagination; docs claimed "no LIMIT" | fixed (`fetchAllRows`, per-status job counts) |
| 4 | Shops list | Per-shop dispute/pack counts wrong past 1000 rows | un-ranged `disputes` / `evidence_packs` selects in `shops/route.ts` | same cap | fixed |
| 5 | Overview | Metrics failure leaves "Loading dashboard..." forever or crashes | `.then(r => r.json())` with no `ok` check, `.catch(() => {})` | swallowed error | fixed (error state + Retry) |
| 6 | Billing | Same swallowed-error/infinite spinner | no `ok` check, no catch | — | fixed |
| 7 | Overview | Plan distribution percentages used all shops incl. uninstalled | `total={metrics.shops.total}` vs installed-only buckets | wrong total | fixed |
| 8 | Overview | Health bar did not wrap on narrow widths | `flex gap-3` | — | fixed |
| 9 | Operations leaderboard, Billing table | Merchant shown as raw myshopify alias | `shop.domain` printed directly | no shared renderer | fixed for these two (`AdminMerchant`); remaining pages tracked below |

## Open — merchant display (R2) still on raw `shop_domain`
`app/admin/disputes/page.tsx`, `gorgias/page.tsx`, `intelligence/page.tsx` (+ any route not yet returning `primary_domain`). Guard test lands with the last of these.

## Open — to confirm
- Prod entitlement row `active` + subscription GID + no `first_paid_cycle_started_at` (1 shop): genuinely never charged, or `sendFirstPaidCycleEmail` never fired? Currently shown as `unconfirmed`, not revenue. Needs owner's knowledge of that merchant.
- Prod shop on Growth label with no `plan_entitlements` row (1 shop): onboarding gap (cf. memory: token-exchange installs skipped entitlement grant).

## Pending batches
2 Operations, Disputes · 3 Shops (+detail) · 4 Jobs, Webhooks · 5 Fraud Intel, Intelligence, Outcome Analysis · 6 Templates, Reason Mapping, Template Health · 7 Defence Package · 8 Audit · 9 Resources · 10 Signal Radar, Gorgias, Leads, Help · 11 Team, Passkeys (last).
