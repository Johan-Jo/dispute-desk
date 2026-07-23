# Plan — "Not as Described" (PRODUCT_UNACCEPTABLE / 4853) scoring

**Status:** proposal — no code written. Needs sign-off before implementation.
**Date:** 2026-07-23. **Trigger:** prod dispute `8f90a8f0` (Blume, $80.44) shown as a flat *weak, 0-positive-arguments* case with a contradictory "add product listing" nag. The nag is fixed separately (`fix/no-nag-supporting-only-evidence`). This plan is about the *scoring*.

## The problem (verified)

1. **No `product` branch in the scorer.** `caseStrength.ts` has special branches for `fraud`, `delivery`, `refund` — each with a "one decisive signal → moderate" escape hatch. `product` falls to the strict default (needs 2 strong, or 1 strong + 1 moderate).
2. **The natural evidence is weight-0.** For "not as described", the on-point evidence is the product listing (`product_description`) and the order record (`order_confirmation`) — both `supportingOnly: true` in the canonical registry, so they contribute nothing. Result: every such case reads 0 strong / 0 moderate / **weak**, regardless of what the merchant does.
3. **The scorer and the defence engine disagree.** `lib/defence/reasonCodes/product_unacceptable.ts` marks `order_record` **critical** and the strategies argue from listing-as-purchased + policy + resolution attempts — the exact evidence the scorer values at zero. And on this dispute, `facts_json` carried a **strong** (`customer_account_info`) and a **moderate** (`no_return_initiated`) signal that never entered the scored `checklist_v2`. The narrative "knew" more than the score.

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

## Recommendation

**Option A, gated to not change auto-submit behavior for product until reviewed.** Concretely: add the `product` branch so the *label* and *recommendation* become honest (a case with policy-acceptance or a no-return signal reads "moderate" with a real reason), but keep product-family moderate cases routing to **review**, not auto-submit, until you explicitly opt in. That fixes the merchant-facing "this is unwinnable" misread without risking unattended submissions.

## Test plan (when approved)
- Unit: `product` family with 0/1/2 decisive signals → weak/moderate/strong; `product_description` alone stays weak (Option A).
- Regression: fraud/delivery/refund branches unchanged.
- Pipeline: a moderate product case in auto mode still parks (no new auto-submit) unless opted in.
- Re-score prod dispute `8f90a8f0` and confirm the new label + honest recommendation.

## Open questions for sign-off
1. Option A, B, or C?
2. For a moderate product case in **auto** mode: park for review (safe, recommended) or auto-submit like other moderates?
3. Does `no_return_initiated` (customer never returned the item) count as decisive for "not as described"? (I think yes — it directly undercuts the claim.)
