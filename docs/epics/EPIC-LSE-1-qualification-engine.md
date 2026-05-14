# EPIC LSE-1 — CE 3.0 Qualification Engine

> **Status:** In progress (2026-05-14)
> **Phase / week target:** Phase 1 of Liability-Shift Engine — Weeks 1–6
> **Dependencies:** EPIC LSE-0 (network reason codes), EPIC 1 (Dispute Sync), EPIC A1 (Automation Pipeline)
> **Track:** LSE (Liability-Shift Engine)
> **Source PRD:** [`docs/liability-shift-engine-prd.md`](../liability-shift-engine-prd.md) §0 (research findings), §4

## Goal

For every incoming Shopify dispute, decide whether it would qualify for **Visa Compelling Evidence 3.0** and explain why or why not. Surface a per-dispute qualification verdict and the underlying reasoning.

Six possible verdict states (expanded from the original 4 after 2026-05-14 research):

| Verdict | When | Confidence |
|---------|------|------------|
| `qualifies_network_prequalified` | Disputed transaction used Visa Secure (3DS2) or Visa Data Only — Visa auto-qualified it since Oct 17, 2025. Skip the 2-priors lookup; merchant just needs to submit strong rebuttal evidence. | high |
| `qualifies_via_initial_billing` | Recurring/MIT order where the **initial subscription billing transaction** carries the matching data. | high or medium depending on initial-billing data quality |
| `qualifies` | Standard CE 3.0: ≥2 priors in window + ≥2 matching data points incl. IP/device anchor. | high or low |
| `partial` | Close but missing one thing (e.g., 1 prior in window, or 2 matches but no anchor). | n/a — drives "missing evidence" UI |
| `does_not_qualify` | Cleanly fails one of the gates. | n/a |
| `not_applicable` | Wrong network, wrong reason code, or wrong order shape (e.g., refund-issued fatal-loss). | n/a |

No submission yet — that's LSE-2 and LSE-6.

This epic is buildable now: it needs only Shopify data we already have access to (orders, customers, dispute reason, IPs from `client_details`, 3DS state via the existing `threeDSecureSource.ts`), plus a new evaluation table. No partnership and no platform changes required.

## Non-goals (explicit)

- Generating evidence PDFs (LSE-2)
- Submitting evidence anywhere (LSE-2 best-effort, LSE-6 direct)
- FPT readiness scoring (LSE-3)
- Session/pixel capture (LSE-4)
- Ratio dashboards (LSE-5)

## Architecture

```
dispute synced (EPIC 1) ──▶ runAutomationPipeline (EPIC A1)
                                  │
                                  ▼
                     enrichDisputeWithNetworkReasonCode (LSE-0 — DONE)
                                  │
                                  ▼
                       evaluateQualification(dispute)
                       ├─ guard: visa + network_reason_code === "10.4"?
                       │   (LSE-3 handles Mastercard FPT separately)
                       │
                       ├─ branch 1: auto-qualified (Visa Secure / Data Only)
                       │    ├─ read 3DS state from existing threeDSecureSource
                       │    └─ verdict = qualifies_network_prequalified
                       │       (skips priors lookup entirely)
                       │
                       ├─ branch 2: recurring / MIT
                       │    ├─ detect via Order.lineItems[].sellingPlanAllocation
                       │    └─ qualify via initial_subscription_billing_transaction
                       │
                       ├─ branch 3: standard CE 3.0
                       │    ├─ fetch customer.orders 120–365d window
                       │    ├─ filter to undisputed, paid, non-refunded
                       │    ├─ require ≥2 priors
                       │    └─ require ≥2 matching points incl IP/device anchor
                       │
                       └─ writes row to dispute_qualifications

                                  │
                                  ▼
                       embedded dashboard + portal
                       show verdict + matching data + missing evidence
                       + April-2026-fee notice when prequalified
```

The qualification step runs from the automation pipeline after LSE-0's network-reason-code enrichment but before pack-build evidence assembly — so the build can read the verdict and tailor the package.

**Touchpoints:**
- New module: `lib/liabilityShift/qualifyCE30.ts` (orchestrator)
- New module: `lib/liabilityShift/matching.ts` (field-level match primitives)
- New module: `lib/liabilityShift/priors.ts` (Shopify customer-orders lookup)
- New module: `lib/liabilityShift/autoQualified.ts` (3DS detection branch)
- New module: `lib/liabilityShift/subscriptionBilling.ts` (initial-billing-transaction branch)
- Pipeline hook: `lib/automation/pipeline.ts` (add `evaluateQualification` step)
- New API: `GET /api/disputes/:id/qualification`

## CE 3.0 qualification rules

See PRD §4 for the canonical pseudocode. The rules in one paragraph:

> Card network must be Visa **and** reason code must be 10.4. Customer must have at least **2 prior undisputed orders** in the **120–365 day window** before the disputed transaction. Across the disputed order **and** those priors, at least **2 matching data points** must hold from {IP, device fingerprint, shipping address, customer account ID}, with **at least one being IP or device** (the anchor requirement).

Implementation notes (updated 2026-05-14 with research findings):

- **Address normalization**: `123 Main St` ↔ `123 Main Street`. Acquirers enforce **tight matching** in practice — default to exact-string match, fall back to a libpostal-normalized comparison flagged in confidence reasons (`shipping_match:normalized_only`). Don't claim "match" on loose fuzzy hits.
- **IP comparison**: support both **exact-string** (stronger) and **ISP/subnet-level** (acceptable fallback per Visa guidance, weaker). Surface the confidence delta in the verdict (`ip_match:exact` vs `ip_match:subnet`). True-client-IP only — `Order.client_details.browser_ip` is what Shopify gives us; LSE-4 will improve this when it captures forwarded IP correctly.
- **Device fingerprint**: only available once LSE-4 ships AND when the merchant has the embed enabled. Until then, `device` match is always false, anchor is satisfied via IP. Fingerprints must be **deterministic** (per cside.com: "if the merchant cannot reproduce the fingerprinting logic on demand, the issuer may discount the match").
- **Refunded prior orders**: excluded (customer-friction signal).
- **Disputed prior orders**: excluded by rule (Visa specifies "undisputed").
- **Validation charges**: $0 / $1 verification charges excluded (Visa specifies "not validation charges").
- **Guest-checkout** (no `customer.id`): match on email + shipping + IP. Anchor still required. Verdict confidence capped at `low`.
- **Subscription orders**: NOT skipped (research-confirmed change). Detect via line items with `sellingPlanAllocation` non-null OR `customAttributes` indicating a subscription. Take the **initial subscription billing transaction** path: identify the first non-disputed billing for this subscription, use its data as the matching anchor against the disputed transaction.
- **B2B / commercial cards**: no special carve-out. Same code path. When buyer-account + shipping-address consistency is poor (common in B2B), add `b2b_data_quality_warning` to `confidence_reasons` and cap verdict at `qualifies-low`. CEDP (Visa Commercial Enhanced Data Program) is a separate program — not in scope here.
- **Digital goods** (no shipping address): anchor must be IP or device, account ID supports.
- **Visa Secure / Data Only auto-qualification**: short-circuit branch — see "Branch 1: auto-qualification" below.
- **Subscription / MIT**: separate branch using initial-billing-transaction — see "Branch 2: subscription / MIT" below.

## Branch 1: Visa Secure / Data Only auto-qualification (new 2026-05-14)

Effective **October 17, 2025**, Visa automatically pre-qualifies for CE 3.0 any transaction authenticated via Visa Secure (3DS2 with cardholder challenge) or Visa Data Only (frictionless 3DS data exchange). Effective **April 17, 2026**, Visa will charge a per-qualification fee on the acquirer side for successful auto-qualifications.

### Detection

The existing `lib/packs/sources/threeDSecureSource.ts` already reads `OrderTransaction.receiptJson.latest_charge.payment_method_details.card.three_d_secure.authenticated` for Shopify Payments orders. Re-use that signal:

```typescript
const tds = readThreeDSecureFromOrder(disputedOrder);
if (tds?.authenticated === true) {
  return autoQualified({
    via: tds.dataOnly ? "visa_data_only" : "visa_secure",
    feeAppliesFrom: "2026-04-17",
    confidence: "high",
  });
}
```

Auto-qualified verdict skips the 2-priors lookup entirely — Visa attaches the qualification metadata at the network level. DisputeDesk still generates strong evidence packaging (LSE-2) but the verdict short-circuits.

Edge cases:
- 3DS receipt parse failure → fall through to standard branch (do not short-circuit on missing signal)
- 3DS authenticated but card network is non-Visa → not applicable here (FPT path handles Mastercard separately in LSE-3)
- Merchant-confirmed 3DS (`tdsVerified === true` per CLAUDE.md, set via manual flow) → also counts as auto-qualified

The merchant UI surfaces the auto-qualification with the April 2026 fee note (translated key, all 6 locales).

## Branch 2: subscription / MIT (initial billing transaction) (new 2026-05-14)

When the disputed order is a recurring billing where IP and device legitimately differ between bills, Visa permits using the **initial subscription billing transaction** as the matching anchor instead of arbitrary priors in the 120–365d window.

### Detection

A Shopify order is treated as recurring billing when **any** of these hold:

- Any `lineItems[].node.sellingPlanAllocation` is non-null (Shopify Subscriptions API marker)
- `customAttributes` carries a subscription identifier key like `subscription_id`, `recharge_id`, `bold_subscription_id`, `loop_subscription_id` (covers the top Shopify subscription apps)
- `Order.tags` includes `recurring` / `subscription` (merchant convention)

### Qualification logic

```typescript
const subscription = detectSubscription(disputedOrder);
if (subscription) {
  const initialBilling = await fetchInitialSubscriptionBilling({
    customerId, subscriptionMarker: subscription.marker,
  });
  if (!initialBilling) return notQualifying("subscription_no_initial_billing_found");
  const matches = matchPoints(disputedOrder, [initialBilling]);
  const hasAnchor = matches.includes("ip") || matches.includes("device");
  if (matches.length < 2 || !hasAnchor) {
    return partial({ branch: "initial_billing", ... });
  }
  return qualifying({
    branch: "qualifies_via_initial_billing",
    initialBillingOrderId: initialBilling.id,
    matchPoints: matches,
  });
}
```

Edge cases:
- First-bill dispute (customer disputed the signup transaction itself) → no prior initial billing → fall through to standard branch
- Subscription identifier missing → fall through to standard branch
- Initial billing was itself refunded or disputed → exclude, fall through to standard branch

## B2B / commercial cards

Per primary-source research (2026-05-14), Visa does not carve B2B out of CE 3.0. We treat commercial cards the same as consumer cards. When the order's `paymentDetails.company` is `"American Express"` we drop to `not_applicable` (Amex isn't in CE 3.0 scope); for Visa commercial cards we add `b2b_data_quality_warning` to `confidence_reasons` when shipping-address consistency across priors is weak. No qualification gate — just a confidence signal.

Visa CEDP (Commercial Enhanced Data Program) is a separate B2B data-quality program and is **not** in scope for LSE.

## Database changes

New migration: `supabase/migrations/20260514130000_dispute_qualifications.sql`

### New table: `dispute_qualifications`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `shop_id` | uuid FK → shops | |
| `dispute_id` | uuid FK → disputes nullable | join key with DisputeDesk's internal dispute row |
| `shopify_dispute_id` | text | |
| `shopify_order_id` | text | |
| `card_network` | text | `visa`, `mastercard`, `amex`, `discover`, `other`, `unknown` |
| `reason_code` | text | resolved network reason code, e.g. `10.4` |
| `program_evaluated` | text | `ce_30`, `fpt`, `both`, `none` (LSE-1 sets `ce_30` or `none`) |
| `ce30_status` | text | `qualifies`, `qualifies_network_prequalified`, `qualifies_via_initial_billing`, `partial`, `does_not_qualify`, `not_applicable` |
| `ce30_branch` | text | which branch fired: `auto_qualified`, `initial_billing`, `standard`, `none` |
| `ce30_match_points` | text[] | subset of `{ip, device, shipping, account}` |
| `ce30_has_anchor` | boolean | |
| `ce30_qualifying_priors` | text[] | up to 2 prior shopify_order_ids (or just the initial-billing order id when branch = initial_billing) |
| `ce30_auto_qualification_via` | text nullable | `visa_secure`, `visa_data_only`, `merchant_confirmed` when branch = auto_qualified |
| `auto_qualification_fee_applies` | boolean | true when verdict is auto-qualified AND the disputed transaction date is on or after 2026-04-17 |
| `confidence` | text | `high`, `medium`, `low` |
| `confidence_reasons` | text[] | machine codes (`guest_checkout`, `single_anchor`, `b2b_data_quality_warning`, `ip_match:subnet_only`, `shipping_match:normalized_only`, …) |
| `missing_evidence` | text[] | for partial states |
| `evaluated_at` | timestamptz | |
| `evidence_package_id` | uuid FK → evidence_packs nullable | filled by LSE-2 |

### Indexes
- `(shop_id, shopify_dispute_id)` unique
- `(shop_id, ce30_status)` for queue views
- `(shop_id, evaluated_at desc)` for time-bound dashboards

RLS: same shop-scoped policies as `disputes` table.

## Job / pipeline integration

Pipeline order inside `runAutomationPipeline`:
1. Existing idempotency check
2. **New:** `evaluateQualification(dispute)` → writes `dispute_qualifications` row
3. Existing: enqueue `build_pack` (which will eventually consume the qualification verdict in LSE-2)

The qualification step is synchronous (target <2s) so the verdict is available the moment the pipeline returns. Webhook handler budget is 5s.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/disputes/:disputeId/qualification` | Read CE 3.0 verdict, match points, missing evidence, confidence reasons |
| POST | `/api/disputes/:disputeId/qualification/recompute` | Re-run qualification (e.g., after a manual order-data fix) |

Internal-only for v1; merchant UI reads via server components.

## UI changes (Embedded + Portal)

### Dispute detail page
Add a **Liability-Shift** panel above the existing pack panel:
- Verdict badge: `Qualifies (high)` / `Qualifies (low)` / `Partial` / `Does not qualify` / `Not applicable`
- For `qualifies-*`: list of matching data points, the 2 qualifying prior orders, confidence reasons
- For `partial`: missing evidence checklist (`needs IP or device match`, `needs 2nd prior order in window`, etc.)
- For `does_not_qualify`: short reason machine code → translated explanation
- For `not_applicable`: muted "Not eligible for CE 3.0 (Visa 10.4 only)" hint

### Dashboard
- New KPI card: **CE 3.0 eligible disputes (this period)**
- Filter chip on dispute list: `Liability-shift status = …`

Copy guidance (per `feedback_bank_optimized_rebuttal` memory): the merchant-facing verdict is informational, never expose weakness narrative.

## i18n keys

New namespace `liabilityShift.qualification.*`. Add keys for: verdict labels (4), confidence reasons (8–10), missing-evidence codes (6–8), explainer copy. **Translate across all 6 locales in the same session** (per `feedback_translate_on_add`).

## Acceptance criteria

- [ ] Migration applied via `npm run db:migrate` in the same session
- [ ] `lib/liabilityShift/qualifyCE30.ts` exports `qualifyCE30(input): CE30Result` with unit tests covering:
  - Visa + 10.4 + 3DS authenticated → `qualifies_network_prequalified` (auto-qualified branch wins, skips priors)
  - Visa + 10.4 + Data Only authentication → `qualifies_network_prequalified` via `visa_data_only`
  - Visa + 10.4 + 3 priors + IP match + shipping match → `qualifies`
  - Visa + 10.4 + 3 priors + 2 match points but no anchor → `does_not_qualify` (`no_ip_or_device_anchor`)
  - Visa + 10.4 + 1 prior → `partial` (`fewer_than_two_priors`)
  - Mastercard 10.4 → `not_applicable` (wrong network — handled by LSE-3)
  - Visa + 10.4 + priors outside 120–365 day window → `does_not_qualify`
  - Visa + 10.4 + subscription order with initial billing match → `qualifies_via_initial_billing`
  - Visa + 10.4 + subscription order with no initial billing found → falls through to standard branch
  - Visa + 10.4 + B2B commercial card with weak data → `qualifies` with `b2b_data_quality_warning` confidence reason
  - Guest checkout path → verdict capped at `qualifies-low`
  - 3DS authenticated but on Mastercard → not auto-qualified (CE 3.0 is Visa only); falls through to `not_applicable`
  - Disputed transaction on or after 2026-04-17 with auto-qualification → `auto_qualification_fee_applies = true`
  - Refunded prior excluded; validation charges ($0 / $1) excluded
- [ ] Pipeline writes a `dispute_qualifications` row for every synced Visa dispute
- [ ] Dispute detail page renders the verdict panel in both embedded and portal surfaces
- [ ] `npm test` and `npx tsc --noEmit` green; `npm run build` green
- [ ] `docs/technical.md` updated with §*CE 3.0 Qualification Engine* (per `feedback_docs_update`)
- [ ] Embedded help article added under `lib/help/` for merchants asking "What is liability shift?"

## Open questions to revisit during phase

(From PRD §11 — drive Phase 1 partnership conversations in parallel.)

1. Does Shopify Payments backend route any evidence as CE 3.0 today, even without structured fields? (Ask Shopify Partners.)
2. Does Stripe support CE 3.0 routing for direct merchants? (Documentation read.)
3. What does Shopify's December 2025 "AI-powered defense" feature actually do? (Test on dev store.)
4. Verifi VROL access path for a third-party app. (Direct outreach.)
5. Ethoca data partner enrollment for a third-party app. (Direct outreach.)
