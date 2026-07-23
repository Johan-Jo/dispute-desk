# Tech debt — reconcile scorer categories with the defence engine (a.k.a. "Option C")

**Status:** DEFERRED. Not scheduled. Revisit only when justified by the trigger below.
**Logged:** 2026-07-23, during the "not as described" scoring work (`feature/product-family-scoring`, Option A). This is the Option C we chose NOT to build now.

## The problem

Two subsystems disagree about which evidence is *decisive*, and they were never reconciled:

- **The defence engine** (`lib/defence/reasonCodes/*.ts`) declares, per dispute reason code, which categories are `criticalCategories` — the evidence it builds the bank-facing narrative around.
- **The case-strength scorer** (`lib/argument/canonicalEvidence.ts`) assigns each field a category weight that is **the same regardless of dispute type**. Some fields the defence engine calls *critical* are hard-coded `supportingOnly: true` (weight 0) in the scorer.

So the narrative argues a case is built on decisive evidence while the strength pill calls the same case weak.

## Concrete contradictions (verified 2026-07-23)

1. **Duplicate-processing dispute.** `duplicate_processing.ts` → `criticalCategories: ["order_record"]`. But `order_confirmation` (signalId `order_record`) is `supportingOnly: true` in the registry. A duplicate dispute with a clean order record — the decisive evidence per the defence module — scores 0 strong / weak.
2. **"Not as described" dispute.** `product_unacceptable.ts` → `criticalCategories: ["order_record"]`, `prioritize` leads with `order_record` + `delivery_proof`. `order_record` is weight-0. (This is the dispute that triggered the whole investigation — dispute 8f90a8f0.)
3. **`duplicate_explanation`.** Prioritised winning category for a duplicate dispute in the defence engine; `supportingOnly: true`, weight 0, in the scorer. The merchant's actual "why it wasn't a duplicate" argument contributes nothing to the strength they see.

Pattern: the contradiction fires wherever a defence module marks as `critical` a category the registry hard-codes `supportingOnly` — currently `order_record` (critical for duplicate AND product) and `duplicate_explanation`.

## Why it was deferred (not "won't fix")

The correct fix is **family-aware categories**: `order_record` decisive for duplicate + product families, but still supporting for fraud (a bare order record proves nothing about cardholder identity). That rewrites the core invariant "a category's weight is dispute-type-independent," which is assumed by:
- `canonicalEvidence.ts` (`categorizeEvidenceField` takes only fieldKey + payload — no family)
- the persisted `PersistedCategory` cache + `categoryVersion` bump machinery
- the CI grep guard that enforces "no code outside canonicalEvidence.ts assigns a category"
- every consumer of `categoryFor` / `affectsStrength`

That's a load-bearing-wall change, and it touches **fraud** scoring (where a wrong `order_record` weight could make a case auto-submit that shouldn't). Doing it to fix contradictions on duplicate + product disputes — before knowing they cause real merchant pain — is backwards.

**Option A (shipped separately) does NOT close these** — it elevates acknowledgement/no-return signals for the product family but leaves `order_record`/`duplicate_explanation` at weight 0. So contradiction #1 (duplicate) and #3 survive Option A. Only this work closes them.

## Trigger to revisit

Pick this up when there is EVIDENCE of real impact, e.g.:
- Merchant complaints that duplicate / not-as-described cases read "weak" despite having the order record the defence letter is built on.
- A measurable gap between narrative-claimed strength and the scored strength on duplicate/product families in prod.
- Any new dispute family added whose decisive evidence is a currently-`supportingOnly` category.

Until then: Option A handles the product family; the duplicate-family contradiction is latent.

## Rough shape of the eventual fix (not a commitment)

- Make `categorizeEvidenceField` (and `categoryFor`) family-aware: accept `ReasonFamily`, apply per-family category overrides on top of the base spec.
- Drive the overrides from the SAME source the defence engine uses (`criticalCategories`) so the two can't drift again — single source of truth.
- Bump `CANONICAL_EVIDENCE_VERSION` (invalidates persisted category cache → recompute on read).
- Extend the CI category-assignment guard to allow the family-override layer.
- Regression-test fraud scoring hardest (the family where a wrong elevation is dangerous).
