# Fraud-risk incorporation plan

**Date:** 2026-05-15
**Status:** Approved for build (Phase 1 → 2 → 3 as separate PRs)

## Global invariant — no negative bank leakage

**Negative or neutral risk signals must NEVER appear in:**
- Bank-rebuttal text
- Evidence PDF
- Any Shopify `disputeEvidence.*` field

They are merchant-facing review signals only. Leakage into bank-facing output would be self-incriminating (Shopify's own ML flagged the order → confession of weakness).

This applies to every phase and every collector. A regression test enforces it (see *Validation* per phase).

## Premise

We already capture Shopify's per-order fraud analysis (`Order.risk.recommendation` + `risk.assessments[]` with `riskLevel`, `provider`, and human-readable `facts[]`) during the orders backfill and persist it to `shopify_orders.risk_*_initial` (snapshot) and `shopify_order_risk_assessments` (full facts). See `lib/shopify/queries/ordersForBackfill.ts:116-138` and `supabase/migrations/20260510150000_fraud_intelligence_orders.sql`.

The ingestion is done. The data is unused downstream. This plan covers three incorporations, ordered by leverage and independence.

---

## Phase 1 — Strengthen fraud-rebuttal packs (highest leverage)

### What

For fraud-reason disputes, pull positive risk signals from `shopify_order_risk_assessments` and surface them as an evidence section that feeds:

1. The bank-rebuttal text (citation of Shopify's own ML clearing the order at checkout — independent of AVS/CVV from the transaction receipt).
2. The merchant-facing pack preview ("Pre-auth fraud screening: passed").

### Eligibility (strict)

A risk assessment is **citable** only when ALL of:

- `dispute.reason` ∈ fraud-family reason codes (`FRAUDULENT`, `CREDIT_NOT_PROCESSED`-not-applicable; see `lib/disputes/networkReasonCode.ts` for the canonical set — fraud only)
- `risk_level_initial` = `LOW`
- `risk_recommendation_initial` ∈ {`ACCEPT`, `NONE`}
- At least one assessment row has provider matching the platform's default (`shopify`) — third-party app scores are not cited; their wording is unpredictable and may not be defensible
- At least one fact with `sentiment = "POSITIVE"` exists

If any condition fails, the collector emits nothing. **Absence is never a negative signal** (same rule as 3-D Secure).

### Classification

**Moderate**, never Strong. Rationale: Shopify's risk facts are descriptive, not contractual. A "Billing country matches IP country" line is meaningful but not a network-level assertion the way an AVS=Y match on the gateway receipt is. The transaction receipt already carries AVS/CVV at Strong; this is a complementary, lower-weight signal.

### Bank-rebuttal text shape

One sentence, appended to the AVS/CVV paragraph in fraud rebuttals (not a new section):

> "Shopify's pre-authorization fraud analysis classified the order as low-risk at checkout, with positive indicators including [up to 3 fact descriptions, comma-joined]."

Word choices that matter:

- **"pre-authorization"** and **"at checkout"** — emphasise this is contemporaneous, not post-dispute synthesis.
- Avoid "cleared the order" / "approved" in internal descriptions and code comments — "classified as low-risk" or "did not flag for rejection" is the correct floor.
- Never expose negative or neutral facts.
- Never cite `provider.title` ("Shopify" implicit; third-party not cited per eligibility).

### Implementation

- New collector: `lib/packs/sources/fraudRiskSource.ts`
- Reads from `shopify_order_risk_assessments` joined on the order, filtered by sentiment.
- Pipeline integration: registered in the pack builder alongside `threeDSecureSource`, gated on `ctx.dispute.reason` being fraud-family.
- Completeness engine: adds `fraud_risk_screening` to the moderate-evidence list for fraud disputes only.
- Bank-rebuttal: extend `lib/argument/canonicalEvidence.ts` (or wherever the fraud-reason paragraph is composed — verify before coding) to optionally inject the sentence.

### Files touched (estimate)

- `lib/packs/sources/fraudRiskSource.ts` (new, ~120 LOC)
- `lib/packs/index.ts` or equivalent registry (1 line)
- `lib/automation/completenessEngine.ts` (add reason-gated moderate signal)
- `lib/argument/canonicalEvidence.ts` (compose the sentence)
- `lib/packs/types.ts` (new section type)
- Tests: unit for collector eligibility matrix; snapshot for rebuttal text inclusion

No migration needed — data already in Supabase.

### Risk / non-goals

- We do **not** elevate `overall` strength to Strong on this alone.
- We do **not** cite for non-fraud reasons (no PRODUCT_NOT_RECEIVED, no DUPLICATE) — risk screening is irrelevant to those defenses.
- We do **not** re-fetch risk data; the initial snapshot is sufficient. (Shopify may rescore after late signals; tracking that is Phase 2's problem if at all.)

---

## Phase 2 — High-risk fulfillment weakness flag (degrade signal)

### What

When `risk_level_initial = HIGH` and `risk_recommendation_initial ∈ {INVESTIGATE, REJECT}` and the merchant fulfilled anyway, the dispute pack is structurally weaker — Shopify warned the merchant before fulfillment. Bank arguments aside, the merchant should know before auto-submitting.

### Behavior

- **Auto-mode:** does **not** block. Caps `overall` to at most `moderate` (whatever it would have been, capped). Reason for the cap surfaced in the merchant-facing card.
- **Review-mode:** parks the pack as usual, with a "High-risk fulfillment warning" banner in the embedded UI.
- **Bank-rebuttal text:** **NEVER** cites the high-risk flag (covered by the global invariant).

### Cap escape hatch (deferred to v2)

A blanket cap-to-moderate could understate a genuinely strong defense. Specifically: a pack with **3-D Secure liability-shift evidence** (`tdsVerified === true`, merchant-confirmed via the manual flow) is structurally Strong regardless of pre-auth risk score — the network has explicitly transferred liability.

**v1 behavior:** still cap to moderate. Simple, predictable, never wrong in the dangerous direction (over-stating strength).

**v1 code marker:** in `lib/automation/riskWeakness.ts`, leave a `// TODO: v2 — allow override when ctx.threeDSecure?.tdsVerified === true` next to the cap. Do not implement the override in v1. Capturing the intent in code is enough; revisit after we see real shop data.

The escape hatch is **not** AVS/CVV + signed delivery — those are evidentiary strength, not liability-shifting. Only 3DS liability shift (and arguably tokenised wallet authentication, future scope) qualifies.

### Why a cap, not a block

Coverage already blocks. Fatal-loss already blocks/degrades on specific structural triggers. A HIGH-risk order with proof of delivery, AVS match, and 3DS authentication is still defensible — Shopify's risk score is one signal among many. Auto-blocking would over-trigger.

### Why not Strong-negative ("merchant ignored warning")

Tempting, but: the merchant may have called the customer, captured manually after review, or had legitimate reasons. We don't know, and bank arguments don't get to know either. Surface it as a merchant-side awareness signal only.

### Implementation

- Extend `lib/automation/fatalLoss.ts` (or add a sibling `riskWeakness.ts`) to compute the cap.
- New `heroVariant`? Probably not — reuse existing `proceed_with_caution` or extend the existing strength-reason copy. **Verify the current heroVariant enum before adding one.**
- Pipeline integration: applied AFTER coverage gate, AFTER fatal-loss gate, BEFORE quality gate.
- Embedded UI: new banner component or extension of existing strength card. **Read the embedded dispute page first to decide where it fits.**

### Files touched (estimate)

- `lib/automation/riskWeakness.ts` (new, ~80 LOC) — or extension of `fatalLoss.ts`
- `lib/automation/pipeline.ts` (insert gate)
- `lib/packs/types.ts` (extend reason enum)
- Embedded UI: `pages/shopify/shopify-disputes-detail.tsx` (or current path — verify)
- Tests: unit for the gate; snapshot for the UI banner

### Open question

Does HIGH + fulfilled also apply to non-fraud disputes? Argument for yes: a high-risk order that became a "product not received" dispute is suspicious regardless of network reason code. Argument for no: scope creep, and the negative-signal-only-when-relevant rule is cleaner. **Recommend gating to fraud-family reasons in v1.**

---

## Phase 3 — Order-risk history (cluster intelligence)

> **Naming note:** never use "repeat offender" in product copy, table names, view names, column names, code comments, or commit messages. Use `order_risk_history`, `customer_risk_history`, or `risk_pattern_history`. The signal is statistical, not accusatory; "offender" prejudices the merchant against the customer in a way the data does not justify.

### What

`facts_json` contains fingerprint-ish signals: card-reuse counts, email-reuse counts, multiple-cards-tried, billing-IP mismatches. Aggregated across a shop's order history, these feed the intelligence surface that already exists for recurring-pattern synthesis.

### Why this is a bigger build

- Requires cross-order joins (not per-dispute).
- Needs a stable identity model — `email` is a weak join key; `customer_id` better; device/IP not stored.
- Requires UI design for the intelligence surface (not just data plumbing).
- Adversarial concerns: if we expose "this buyer has 3 prior HIGH-risk orders" to the merchant, it's actionable. If we expose it in bank-rebuttal text, it's potentially defamatory and not network-evidence-shaped.

### v1 scope (proposal)

**Read-only Supabase view, no UI yet.** Build the join model first, validate the data quality, then design the UI off real shop data.

- New view: `order_risk_history` aggregating `shopify_order_risk_assessments` by `(shop_id, customer_email)` and `(shop_id, customer_id)` — exposing prior-order counts at LOW / MEDIUM / HIGH.
- Script: `scripts/sql/order-risk-history-spotcheck.sql` for the canonical `supabase db query --linked` path.
- No collector, no pipeline integration, no UI. Just the data layer.

v2 (separate plan, after v1 validation): feed an "Order risk history" panel in the embedded dispute view with a count badge ("This customer: 2 prior HIGH-risk orders"). v3: synthesis on the intelligence page. Neither v2 nor v3 in this plan.

### Files touched (estimate, v1 only)

- `supabase/migrations/<date>_order_risk_history_view.sql` (new view + RLS)
- `scripts/sql/order-risk-history-spotcheck.sql` (new)
- No code changes.

### Why a view, not a materialized table

Shopify rescores. Order risk data drifts. A view stays correct without a refresh job. If query cost becomes a problem, materialize later.

---

## Sequencing

1. **Phase 1 first.** Self-contained, no migration, immediate pack quality lift, fraud-family only (well-defined blast radius).
2. **Phase 2 second.** Needs product alignment on the cap-vs-block question and the UI surface. ~1 week after Phase 1 lands.
3. **Phase 3 third.** Data layer only in v1. Treat as research, not a feature.

Each phase ships as one PR. No bundling — Phase 2 depends on Phase 1's reason-gating helper being extracted; Phase 3 stands alone.

## Out of scope

- Re-fetching risk data on dispute open (the snapshot suffices for v1; revisit if we see drift in production).
- `Order.fraudProtect` (Shopify's separate Fraud Protect offering) — distinct field, distinct semantics; separate plan.
- Surfacing third-party app risk scores (NoFraud, Signifyd, etc.) — their facts are not in a stable contract.
- Auto-submitting nothing changes — DisputeDesk remains evidence-pack-only.

## Validation before declaring done (per phase)

**Universal (every phase, even Phase 3 when its UI lands):**

- `npm test` + `npx tsc --noEmit` + `npm run build` (per CLAUDE.md non-negotiables).
- `npm run release:verify` before push.

**Global invariant test (added in Phase 1, extended each phase):**

```
Given a HIGH-risk Shopify assessment exists on the order,
when the pack is generated,
then merchant-facing UI may surface a warning,
but bank-rebuttal text, evidence PDF, and Shopify disputeEvidence.* fields
contain no reference to high-risk facts, riskLevel, recommendation,
or any negative sentiment string from facts_json.
```

Implementation: a snapshot test that builds a pack from a HIGH-risk fixture, then asserts the bank-facing artifacts (rebuttal text, PDF source-of-truth blob, Shopify mutation payload from `formatEvidenceForShopify`) match strings that do not contain `HIGH`, `INVESTIGATE`, `REJECT`, or any `negative` / `neutral` fact description.

**Phase-specific:**

- Phase 1: dogfood on Surasvenne synthetic fraud disputes — confirm pack preview shows the new section and bank-rebuttal text reads cleanly with the "pre-authorization" wording.
- Phase 2: simulate HIGH + fulfilled in test fixtures; verify cap is applied, merchant warning surfaces, AND the global invariant test passes for the same fixture.
- Phase 3: run the spotcheck SQL against the linked Supabase and eyeball row counts.

## Decisions (locked, 2026-05-15)

1. Phase 1 classification = **Moderate**, never Strong. ✓
2. Phase 2 = **cap-to-moderate**, not auto-block. v1 has no escape hatch; v2 may override when 3DS liability shift is verified. ✓
3. Phase 2 = **fraud-family reasons only** in v1. ✓
4. Phase 3 = **data layer only**, no UI, no synthesis. ✓
5. Global invariant: **no negative bank leakage** — enforced by snapshot test from Phase 1 onward. ✓
6. Naming: never "repeat offender" — use `order_risk_history` / `customer_risk_history`. ✓
7. Bank-rebuttal wording: "pre-authorization fraud analysis … at checkout … positive indicators". Avoid "cleared" / "approved". ✓
