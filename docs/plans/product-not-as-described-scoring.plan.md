# Plan — "Not as Described" (PRODUCT_UNACCEPTABLE / 4853) scoring

**Status:** IMPLEMENTED (Option A, two-axis rule, product-Strong parked) on branch `feature/product-family-scoring`. Migration `20260723210000` applied to DEV. Original proposal below kept for the reasoning trail.
**Date:** 2026-07-23. **Trigger:** prod dispute `8f90a8f0` (Blume, $80.44) shown as a flat *weak, 0-positive-arguments* case with a contradictory "add product listing" nag. The nag is fixed separately (`fix/no-nag-supporting-only-evidence`). This plan is about the *scoring*.

## The problem (verified)

1. **No `product` branch in the scorer.** `caseStrength.ts` has special branches for `fraud`, `delivery`, `refund` — each with a "one decisive signal → moderate" escape hatch. `product` falls to the strict default (needs 2 strong, or 1 strong + 1 moderate).
2. **The natural evidence is weight-0.** For "not as described", the on-point evidence is the product listing (`product_description`) and the order record (`order_confirmation`) — both `supportingOnly: true` in the canonical registry, so they contribute nothing. Result: every such case reads 0 strong / 0 moderate / **weak**, regardless of what the merchant does.
3. **The scorer and the defence engine disagree.** `lib/defence/reasonCodes/product_unacceptable.ts` marks `order_record` **critical** and the strategies argue from listing-as-purchased + policy + resolution attempts — the exact evidence the scorer values at zero. And on this dispute, `facts_json` carried a **strong** (`customer_account_info`) and a **moderate** (`no_return_initiated`) signal that never entered the scored `checklist_v2`. The narrative "knew" more than the score.

## Competitive + card-network research (2026-07-23)

Surveyed Chargeflow, DisputeNinja, Chargebacks911, Chargeback Gurus, and the Visa/Mastercard rule language for how "not as described / defective" (Visa 13.3 · MC 4853) representment is actually built and ranked. Consistent findings:

- **Everyone models it as TWO parts that must BOTH be shown:** (1) the merchandise **matched the description** the customer bought (listing/spec + checkout/receipt), AND (2) the customer **agreed to / acknowledged** what they were getting (terms, quality acknowledgement, or accepted resolution). One without the other is treated as incomplete. This directly validates a two-part rubric.
- **Tier-1 / decisive (multiple sources agree):** product description-as-advertised, transaction/checkout receipt, **terms & conditions the customer agreed to**, and **customer communications**. DisputeNinja: "failing to provide any of these can significantly weaken your case, regardless of other evidence."
- **Tier-2 / supporting:** delivery confirmation, product images/video, usage data, reviews, expert/third-party assessment.
- **The Visa Oct 19 2024 rule change is decisive for our scoring.** A cardholder must now **return or attempt to return** the merchandise *before* they can file a 13.3. Consequence: **proof the customer never attempted to return/exchange/refuse the item is named compelling evidence** (Chargebacks911, Visa merchant guidelines). So `no_return_initiated` is NOT weak background for this dispute type — it attacks the dispute's *validity at the root*. This resolves the open "does no-return count?" question: **yes, strongly, for 13.3/4853 specifically.**
- **Refund/exchange already issued can end the dispute** (documentation of the credit + date). Treated as decisive-if-present.
- **Return policy itself has "no bearing"** on 13.3 (Visa, per Chargebacks911) — a merchant's posted return policy is NOT the lever here; the customer's *acknowledgement of the product/terms* is. This is a correction to my first draft, which leaned on `policy_refund`/`policy_shipping`. Policy acceptance still helps as terms-agreement, but posted policy alone is weak.
- **Auto-submit vs review:** the automation-first vendors (Chargeflow, Justt, Signifyd) auto-fire when confidence is high; the merchant-controlled ones (Midigator/Kount) template-assist and leave submission to the merchant. Nobody auto-submits a *low-confidence* merchandise-quality case. Consistent with our "Strong auto-submits, Moderate parks" gate.

**Net effect on the rubric:** two-axis model confirmed, but the axis contents shift — `no_return_initiated` and `refund_record` move UP (root-of-dispute + mootness), posted-policy moves DOWN, customer-acknowledgement/communication and listing-as-purchased stay central.

## What actually wins a 4853 (card-network reality)

A "not as described / defective" chargeback is rebutted by showing:
- **The item matched what was advertised** — the product listing / variant as published at purchase time (the customer agreed to *that* description).
- **The customer accepted the terms** — return/refund policy disclosed and accepted at checkout.
- **The merchant offered resolution** — correspondence showing a refund/replacement/exchange was offered (or that the customer never sought one, e.g. `no_return_initiated`).
- **Delivery to the right place** — supports "they got the thing they ordered".

Note these are *legitimately weaker* than a fraud AVS-match or a delivery signature — "not as described" is a subjective-claim dispute and genuinely harder to win. So the goal is **honest calibration**, not inflation: a well-evidenced product case should reach **moderate**, not automatically **strong**.

## Options

### Option A — add a `product` branch with a single-signal escape hatch (recommended)
Mirror the `refund`/`delivery` shape. A product case reaches **moderate** when it has ONE decisive product-family signal, e.g.:
- `customer_communication` strong (`customerConfirmsOrder` / resolution offered), OR
- a policy field strong (`acceptedAtCheckout` + timestamp), OR
- `refund` signal (`no_return_initiated` moderate / refund_record) — "customer never returned it" directly rebuts "it was unacceptable".

Two such signals → **strong**. Everything below one → **weak** (honest: a bare listing with no policy acceptance and no correspondence really is weak).
- **Pro:** minimal, matches the existing per-family pattern, calibrated (moderate not strong).
- **Con:** still leaves `product_description`/`order_record` at weight 0 — the listing itself never counts, only the *surrounding* signals. May feel odd that "I proved the listing matched" doesn't move it.

### Option B — Option A + make listing/order conditionally upgradable
Also let `product_description` reach **moderate** when the payload shows the listing was the one purchased (e.g. a `listingMatchedAtPurchase` discriminator the collector can set from order line-items), and/or `order_confirmation` → moderate for this family only.
- **Pro:** the evidence the merchant most associates with this dispute finally counts.
- **Con:** bigger — needs a new payload discriminator from the collector, and a family-scoped exception to the "supportingOnly is absolute" rule (which is currently a hard invariant with a CI guard). Higher blast radius.

### Option C — reconcile scorer with the defence strategy layer (largest)
Make the canonical categories reason-family-aware so `order_record` is decisive for 4853 (as the defence module already claims) but stays supporting elsewhere. This is the "right" long-term fix but touches the core invariant that categories are family-independent, plus the CI guard, plus every consumer.

## Blast radius (why this needs sign-off)

Strength feeds the **auto-submit gate**. Today every product dispute is weak → in auto mode it's parked/blocked, never auto-submitted. Raising some to **moderate** means:
- In **review mode**: no behavior change (still parked for review), only the merchant-facing label improves (weak → moderate, honest recommendation).
- In **auto mode**: a moderate product case may now route differently (park vs submit) depending on the shop's rule for moderate. **This is the part to confirm** — we do not want to start auto-submitting thin "not as described" cases the merchant hasn't seen.

## RECOMMENDATION (research-calibrated) — Option A with a two-axis Strong rule

Add a `product` branch to `caseStrength.ts` scored on the two axes the whole industry uses. The signals below are what the canonical registry can already produce (no new collector work → this stays Option A, not B).

**Axis 1 — "it matched what they bought" (description/acknowledgement proof):**
- `customer_communication` strong (`customerConfirmsOrder` — customer acknowledged the order/receipt)
- `supporting_documents` strong (`signedContract` — signed spec/terms acknowledgement)
- *(bare `product_description` / `order_confirmation` stay supporting — listing alone shows what you advertised, not that the customer agreed it matched; matches DisputeNinja/Chargeflow ranking)*

**Axis 2 — "the dispute isn't valid / is moot" (root-of-dispute proof):**
- `no_return_initiated` — **promoted to decisive for this family.** Post-Oct-2024 Visa rule, a return is a *precondition* to filing 13.3, so "never attempted to return" is named compelling evidence.
- `refund_record` (`refundStatus: processed`) — refund already issued → dispute moot.

**Scoring rule:**
- **Moderate** = ≥1 decisive signal from **either** axis (honest happy path for a defensible product case).
- **Strong** = ≥1 from **Axis 1 AND** ≥1 from **Axis 2** (answered both halves the bank weighs).
- Two from the *same* axis → stays **Moderate** (e.g. no-return + refund-issued is a strong validity story but doesn't prove the item matched).
- 0 decisive → **weak** (a bare listing with no acknowledgement and no validity signal genuinely is weak — don't inflate).

**Posted policy (`refund_policy`/`shipping_policy`) is NOT elevated** — Visa says return policy "has no bearing" on 13.3. It stays supporting. (Correction from the first draft, which leaned on it.)

### Auto-mode — the important correction
`caseStrength`/pipeline **already** does `auto + moderate → park_for_review` and only `auto + strong → submit` (PRD §9, `pipeline.ts:502-508`). So:
- Making product cases reach **moderate** changes NOTHING about auto-submit — they already park. Pure merchant-facing win (honest label + recommendation).
- The only new auto-submit exposure is a **two-axis Strong** product case. Because Strong requires proof on *both* axes (item matched AND dispute-invalid), that is a genuinely defensible case — but "not as described" is subjective, so **recommend gating product-Strong to park-for-review for the first release** (a small `family === "product"` guard in the auto-strong branch), then relax to normal auto-submit once you've watched real product packs score Strong. Captures 100% of the UX benefit, 0% unattended-submit risk, reversible.

## Test plan (when approved)
- Unit: `product` family — 0 decisive → weak; 1 (either axis) → moderate; Axis1+Axis2 → strong; two-same-axis → moderate; `product_description` alone → weak.
- Regression: fraud/delivery/refund/default branches unchanged; `supportingOnly` CI invariant intact (no registry category change in Option A).
- Pipeline: product-Strong parks (if gated); product-moderate parks as today.
- Re-score prod dispute `8f90a8f0` (has `customer_account_info` strong + `no_return_initiated` — note these must first reach the scored `checklist_v2`, see caveat) and confirm the new honest label.

## Caveat surfaced during investigation (may need its own fix)
On dispute `8f90a8f0`, the decisive facts (`customer_account_info` strong, `no_return_initiated` moderate) existed in `facts_json` but **never entered the scored `checklist_v2`** — so even a perfect `product` branch wouldn't see them. There's a **checklist/facts sync gap** independent of the scoring rule. Worth confirming whether the collector adds `no_return_initiated`/`customer_account_info` to the checklist for product disputes; if not, the branch has nothing to score. Flag for the implementation phase.

## Decisions still needed from you
1. **Approach:** Option A (recommended — no collector work) / B (also make listing itself count, needs a new discriminator) / C (full family-aware categories).
2. **Product-Strong in auto mode:** park for review first release (recommended) or auto-submit like other Strong?
3. Confirm the two-axis Strong rule (vs simpler "any 2 decisive → strong").
(`no_return_initiated` decisive → **research says YES for 13.3**, so I've folded that in rather than leaving it open.)
