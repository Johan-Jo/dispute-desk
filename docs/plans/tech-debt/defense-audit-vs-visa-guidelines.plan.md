# Audit — DisputeDesk defenses vs Visa Dispute Management Guidelines

**Status:** findings report. Ranked backlog for sign-off; nothing here is built except where noted.
**Date:** 2026-07-23. **Source:** Visa merchant Dispute Management Guidelines (June 2024) + Compelling Evidence 3.0 material — see [[reference_visa_dispute_management_guidelines]]. Requested by user to find gaps/errors in our per-reason-code logic.
**Caveat:** the official Visa PDF is image-only (not text-extractable), so exact 13.1 billing-address wording, the 13.6-vs-13.7 split, and 12.6 sub-code definitions should be re-verified against a text copy of the Visa Core Rules before implementing S2/S3 items.

## Already addressed (this session, `feature/product-family-scoring`)
- **13.3 product scoring** — added the two-axis `product` branch to `caseStrength.ts`, closed the checklist sync gap (added `no_return_initiated`/`refund_record`/`customer_account_info` to the product template in both `completeness.ts` + a DB migration), gated product-Strong to park-for-review. The audit's S2#5 (surface the return precondition in scoring) is partially covered — `no_return_initiated` is now Axis-2 decisive in the *scorer*. Remaining product items below (defence-module prompt still lists policy; still doesn't argue the return precondition in prose) are NOT yet done.

## Ranked findings (from the audit)

### S1 — Critical (category can't win as designed)
1. **Duplicate (12.6): all defence-critical signals are un-scoreable.** `order_record` + `duplicate_explanation` are `supportingOnly` in the registry but are `criticalCategories`/`prioritize` in `duplicate_processing.ts`. A duplicate dispute is score-capped at weak no matter the evidence. → same class as Option C ([[scorer-defence-category-reconciliation]]).
2. **13.3 product: `order_record` critical-in-defence, excluded-in-scorer.** Confirmed contradiction (also in the Option C doc). The scoring side is now handled by the two-axis branch; the *defence module* still marks order_record critical — reconcile.
3. **13.2 subscription: decisive signals don't exist in the model.** `subscription_terms` + `service_access` are defence-critical but are NOT canonical fields, NOT scored (no subscription branch — falls to default count), NOT in the checklist. A canceled-recurring case can never reach Strong on its decisive signals.
4. **10.4 fraud: no Compelling Evidence 3.0 pathway.** The primary modern Visa 10.4 remedy (≥2 prior undisputed txns, 120–365 days pre-dispute, ≥2 matching data elements incl. IP or device ID) is unmodeled. Worse, `customer_account_info` scores **Strong on a single prior order** — a false CE3.0 proxy that would be rejected. Gate/relabel it.

### S2 — High (Visa-relevance errors / precondition misses)
5. **13.3 return precondition not argued in defence prose.** Scorer now uses `no_return_initiated` (Axis 2), but `product_unacceptable.ts` doesn't list it in `prioritize`/`allowedFactCategories` and the promptBody never argues "no return was initiated → dispute is procedurally defective (Oct-2024 rule)". Registry also caps it at `moderate` (could be Strong on the 13.3 path).
6. **13.3 policy is irrelevant but prioritized.** `product_unacceptable.prioritize` lists `policy_refund`/`policy_shipping`, but return/refund policy "has no bearing" on not-as-described. Drop from prioritize + add a promptBody caution.
7. **13.7 (canceled merchandise/services) unmodeled** — routes to `generic_fallback`.

### S3 — Medium
8. **13.1 delivery verified against shipping/customer address, not card billing address** as Visa specifies (`deliveredToVerifiedAddress`). If shipping ≠ billing, Visa may reject. Add a billing cross-check on the INR Strong gate.
9. **13.6 `mustNotClaim: "no refund was ever owed"`** collides with the module's own return-conditional argument — narrow to forbid only unqualified "never owed".
10. **Digital-INR + 12.6.2 "paid by other means"** have no canonical fields / code-template rows.

### S4 — Low
11. **DUPLICATE → `billing` family** has no scorer branch (default path only).

## Recommended sequencing (proposal, needs sign-off)
- **Highest leverage / lowest risk first:** S2#6 (drop policy from 13.3 defence — copy-only), S2#5 (wire return-precondition prose + `no_return_initiated` into the product defence module), S3#9 (narrow 13.6 mustNotClaim).
- **Medium project:** S1#3 subscription (new canonical fields + scorer branch + checklist rows + defence reconcile) — self-contained, high value.
- **Larger:** S1#4 CE3.0 fraud remedy (new `prior_transaction_footprint` signal w/ time-window + data-element matching) — biggest win for fraud, biggest build.
- **Architectural:** S1#1/#2 order_record reconciliation = the [[scorer-defence-category-reconciliation]] Option C project.
- **Coverage gaps:** S2#7 (13.7), S3#8 (13.1 billing), S3#10 (digital INR, 12.6.2).

Each of these should be its own scoped PR with sign-off — do NOT batch. The product work in flight already covers the scoring half of #2 and #5.
