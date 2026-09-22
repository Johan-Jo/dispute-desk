# Insights & monthly digest: make them rail-aware

**Status:** plan only — nothing implemented.
**Date:** 2026-08-30
**Why now:** the `PaymentDetails` union fix (#621/#622) and the payment_method
repair (#624) mean we can finally tell PayPal from card. The Insights page, the
monthly digest and the onboarding digest were written when we could not, and all
three still assume every dispute is a card-network chargeback.

Every number below was measured on prod, not inferred.

---

## 1. Three defects, in order of how wrong they are

### 1.1 The ECM "chargebacks per month" figure is 49× too high — and it is not a rail bug

`page.tsx:963` passes `data.chargebackOrders90d` into `evaluateCheckpoints`.
Despite the name, that field is the **order** count — `route.ts:114-118` says so
in its own doc comment: *"Despite the legacy name this is the ORDER count."*
`checkpoints.ts:141` then does `count / 3` and renders it as
`{monthlyEstimate}` chargebacks per month.

Measured, Mein Maison, trailing 90d:

| | |
|---|---|
| Orders 90d | 14,635 |
| Chargebacks 90d | 300 |
| **Shown to merchant** | **~4,878 chargebacks/month** |
| **Correct** | **~100/month** |

A **49× overstatement**. And the correct value — 100 — sits exactly on
Mastercard's ECM count trigger, so this is the one number where precision
actually decides the verdict.

The route computes `chargebackCount` correctly (`:367`) and the plan recommender
uses it correctly (`:638`), but `:598` serializes `chargebackOrders` instead, so
**the client cannot pass the right value even if it wanted to.**

Fix: serialize `chargebackCount`; pass it; add a test that the ECM count input
is a dispute count, not an order count.

### 1.2 The headline rate mixes rails, then is compared to card thresholds

`route.ts:365` — `chargebackRatePct: rate(cbCount, cbOrders)` where both sides
come from `shop_daily_metrics`, which collapses rail at write time
(`snapshotShopDailyMetrics.ts:95-102`, no gateway/method filter).

| What Insights shows | True card-network rate |
|---|---|
| **2.53%** | **0.31%** |

An **8× overstatement** for a shop that is 92.3% PayPal. That number then feeds
`ruleChargebackRateVamp` (0.9%/1.5%) and `ruleChargebackRateEcm`, producing the
only red `breach` state in the product.

The `healthy` verdict is as wrong as `breach`: it tells a merchant with real
PayPal exposure they are fine because a threshold they are not measured against
was not crossed. The honest third state — *not applicable to your payment mix* —
does not exist today.

### 1.3 The monthly digest computes a different, worse number than the page

`monthly-digest/route.ts:109-127` counts **all** disputes (no `phase =
'chargeback'` filter) over all orders — so inquiries are in the numerator — and
reads from `disputes` directly rather than `shop_daily_metrics`. It also windows
on `created_at_shopify` where the page windows on `processed_at`.

Consequence: **the email and the page show different "90-day chargeback rates"
for the same merchant**, and the email's is inflated further by inquiries.

Worse, both call the same `evaluateCheckpoints`, but pass opposite things:
- page (`page.tsx:963`) passes the **order** count
- digest (`sendMonthlyChargebackDigest.ts:246`) passes the **dispute** count

So the ECM "per month" figure disagrees by orders of magnitude between the two
surfaces, for one merchant, in the same week.

---

## 2. Scope — rail mix is not uniform, so no global assumption works

| Shop | Disputes | PayPal | Card |
|---|---|---|---|
| `6a8848-dd` (Mein Maison) | 522 | **92.3%** | 7.3% |
| `blume-box` | 474 | **0%** | 78.9% |
| `surasvenne` | 48 | 12.5% | 43.8% |

Card framing is nearly always wrong for the first and broadly right for the
second. This must be per-shop and data-driven.

---

## 3. Structurally-absent signals scored as failures

Rail-level 3DS on Mein Maison, May–Aug:

| Method | Orders | 3DS true | 3DS null |
|---|---|---|---|
| paypal | 14,943 | 0 | **14,943** |
| card | 2,916 | 97 | 2,819 |
| apple_pay | 842 | 0 | 842 |

`three_ds_authenticated` is **never `false`** anywhere in the table — only `true`
or `null`. So absence is not evidence of non-authentication, and must never be
scored as a negative (2026-07 false-zero incident).

`ruleThreeDsAuth` (`checkpoints.ts:197-211`) fires amber `consider` at <10% with
**no minimum-sample gate** — one card order without 3DS produces "3-DS
authentication on 0% of eligible card orders" and can displace real findings via
`TOP_VISIBLE = 5`. The house pattern for exactly this problem already exists:
`signedForObservable` (`route.ts:299-303`, `page.tsx:857-864`) renders
"unobservable" rather than 0%. It simply was not applied here.

Same shape applies to `ruleProtectCoverage`, and to AVS/CVV/BIN coverage metrics
— all card-only signals, structurally absent on PayPal.

**Also a real bug:** the digest's 3DS numerator is not scoped to the same
predicate as its denominator (`monthly-digest/route.ts:278-282`). Denominator
filters `payment_method === "card"`; numerator counts 3DS across all orders
including wallets. Measured: **4.08% shipped vs 3.33% correct**, ~23% over.

---

## 4. What already exists and must be reused

`lib/disputes/paymentContext.ts` already solves classification:
- `NON_CARD_FAMILIES` (`:98-110`) already contains `paypal`, with a comment
  saying it "carries NO card network and no AVS/CVV/3DS signals — the card-scheme
  paths must treat it as not-applicable exactly like Klarna"
- `isNonCardPaymentFamily()` (`:116-120`) **accepts a plain string**, so it works
  directly on a `shopify_orders.payment_method` value read from the DB

Seven pipeline modules already branch on it. The established idiom is to emit
**nothing** rather than a zero:
```ts
if (isNonCardPaymentFamily(ctx.paymentContext.family)) return [];
```
(`lib/packs/sources/threeDSecureSource.ts:94`, `fraudRiskSource.ts:148`)

`lib/admin/shopRisk.ts:461-530` is a **working reference implementation** of the
exact dispute→order join Insights needs, including the three-way discipline that
matters most:
- `unmatched` — order not in `shopify_orders` (backfill gap)
- `unknown` — order present, `payment_method` NULL (coverage gap)
- `other` — a real method outside the charted set

*Only `other` is a payment method.* Folding the first two into it is precisely
the defect that caused the original misread.

**Insights imports none of this.** Verified: zero call sites for
`isNonCardPaymentFamily` under `app/api/dashboard`, `lib/insights`, `lib/email`,
or `lib/liabilityShift/ratios`. Do not write a second classifier.

---

## 5. Data availability — cheaper than expected on one side

**Order-side rail mix is free today.** `route.ts:480-497` already selects
`payment_method, payment_gateway` for the whole 90d window into `orderRowsForKpi`
— currently used only for the 3DS denominator. Computing
`cardOrders / nonCardOrders / unknownOrders` is a pure in-memory pass, **zero
extra queries**.

**Dispute-side rail needs work.** `disputes` has no `payment_method`, and both
rollup tables collapse rail at write time. Options: (a) the chunked-`IN()` join
from `shopRisk.ts`, (b) a rail-partitioned RPC, or (c) cleanest — rail-split
columns on `shop_daily_metrics` written by the snapshot job, which already joins
disputes to orders.

---

## 6. Prerequisite: the data is repaired on one shop only

| Shop | NULL `payment_method` | Total | NULL % |
|---|---|---|---|
| `surasvenne` | 4,708 | 6,321 | **74.5%** |
| `blume-box` | 106,767 | 361,327 | **29.5%** |
| `cay-collective` | 362 | 14,362 | 2.5% |
| `6a8848-dd` | 207 | 99,280 | 0.2% (repaired) |

Rail segmentation is only as good as this column. Running it on `surasvenne`
today would put 74.5% of orders in `unknown`.

Two cautions:
- `blume-box`'s NULLs are mostly **not** `shopify_payments`, so they are a
  different, older gap — diagnose before assuming the same repair applies.
- Migration `20260829210000_backfill_payment_method_from_gateway.sql` deny-lists
  `shopify_payments`, so it deliberately does **not** resolve the PayPal case.
  Do not assume that migration made the column complete.

---

## 7. Proposed shape

One shared module, `lib/insights/railSegmentation.ts`:

```
segmentByRail(shopId, window) -> {
  card:    { orders, disputes, ratePct },
  alt:     { orders, disputes, ratePct, families: {...} },
  unknown: { orders, disputes },    // never folded into either
  cardShare: number                 // gates whether card framing renders at all
}
```

Rules it must encode:
1. Classification from `paymentContext`, never from `payment_gateway`.
2. `unknown` is its own bucket, always.
3. VDMP/ECM attach to the card segment only.
4. No card volume → "not applicable", never `0%`. `safeRatio`
   (`liabilityShift/ratios/calculate.ts:135`) currently returns `0` for an empty
   denominator, which renders a confident green `0.00%` VAMP pill for a merchant
   with no card volume. It must return `null`.

Both the insights route and the digest consume it, so page and email cannot
drift — today they compute independently, which is how they ended up with
contradictory ECM figures.

---

## 8. Highest-leverage file

`lib/insights/checkpoints.ts` feeds **three** surfaces: the in-app page, the
monthly digest, and the onboarding digest (the first email a merchant ever
receives). Fixing the rules there fixes all three.

Blocked by `checkpoints.types.ts:24-45`, whose `CheckpointInput` has **no rail
field at all** — the rules physically cannot branch on rail today. That type is
the first change.

Note the plumbing asymmetry: the digests evaluate **server-side**, the page
evaluates **client-side** from the JSON response. Extending `CheckpointInput`
means threading rail through three different metric producers.

---

## 9. Suggested order

1. **§1.1** — the 49× ECM count bug. Small, self-contained, wrong for every
   merchant regardless of rail. Ship first.
2. **§3 (digest 3DS numerator)** — same character: a real arithmetic bug.
3. **§6** — repair `surasvenne` and `cay-collective`; diagnose `blume-box`.
4. **`checkpoints.types.ts`** + `railSegmentation.ts` + tests.
5. **§1.2 / §1.3** — rewire page and digest; unify the two divergent rate
   computations; add the "not applicable" verdict.
6. **§3** — minimum-sample gates and n/a states for card-only signals.
7. **Copy** — the card-network assertions are baked into six locale files
   (`messages/{en,de,es,fr,pt,sv}.json`). Structural i18n rules apply.

---

## 10. Verification

- Unit tests: PayPal-dominant, card-dominant, mixed, all-unknown shops. Assert
  `unknown` is never folded in, and that numerator ⊆ denominator for every rate.
- Render the digest against **both** Mein Maison (PayPal-dominant) and
  `blume-box` (card-dominant) on prod data and **read the output**, before
  shipping. The recurring failure mode in this area has been trusting a
  computation instead of looking at what the merchant receives
  (`[[project_evidence_needed_email_checklist_aware]]`).

---

## 11. One judgement call to make deliberately

`PlanRecommendationCard` sizes plans on all-rail dispute volume
(`route.ts:634-646`). That may be **correct** — we build defence packs for PayPal
disputes too, so billing on total volume is defensible. Decide it explicitly
rather than "fixing" it by reflex.

Separately: `PlanRecommendationCard` appears to have **no render site** — it is
imported by nothing. Confirm whether it is dead code before investing in it.
