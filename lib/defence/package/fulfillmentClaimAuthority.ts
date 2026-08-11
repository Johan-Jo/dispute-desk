/**
 * F6 — who may assert fulfilment to an issuer.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────
 *
 * `composePdfBlocks` writes a deterministic fulfilment paragraph into the
 * bank-facing document whenever `orderContext.fulfillmentStatus === "FULFILLED"`.
 * That value is a RAW SCALAR lifted out of `pack_json.sections[type=order]` —
 * it is not a fact, it carries no validity state, no citation eligibility and
 * no plan authority, and nothing downstream re-checks it. So an order marked
 * fulfilled in Shopify is by itself sufficient to put "we fulfilled this" in
 * front of an issuer, on a case whose fulfilment evidence the plan may have
 * excluded as unverified, adverse or review-required.
 *
 * The existing claim guard covers the mirror case — asserting fulfilment while
 * the scalar says UNFULFILLED and no delivery fact exists — which is why this
 * one went unnoticed: the guard reads as though the scalar is being policed,
 * when in the FULFILLED direction it is the authority.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────
 *
 * On the canonical route the sentence needs authority from the ARGUMENT, in
 * one of exactly two forms:
 *
 *   1. An order fact the PLAN included (and therefore the classifier deemed
 *      bank-citable) whose own `fulfillmentStatus` is FULFILLED. The scalar
 *      may still be the underlying value — what changes is that it now arrives
 *      through a fact the plan authorised, rather than around it.
 *   2. A held `delivery_occurred` capability — carrier-confirmed delivery or a
 *      signature/POD on record, derived from the same approved facts.
 *
 * Absence of either is not a claim that the order was NOT fulfilled. It is the
 * narrower and correct statement that nothing in the argument authorises us to
 * say it was, so the deterministic paragraph does not render.
 *
 * Pure: same facts in, same answer out. The validator can therefore re-derive
 * it independently instead of trusting a flag handed along with the document.
 */

import { deriveClaimCapabilities } from "../claimCapabilities";
import type { EvidenceFact } from "../types";

/** Fact categories whose payload may carry an order's fulfilment status. */
const ORDER_FACT_CATEGORIES = new Set(["order_record", "order"]);

/**
 * Does the plan-approved, bank-included fact set authorise a fulfilment claim?
 *
 * `facts` MUST already be the plan's included ∩ bank-included list. Passing the
 * classifier's raw `approved` here would reinstate exactly the authority this
 * function removes — a fact the plan excluded would speak again.
 */
export function hasFulfillmentClaimAuthority(
  facts: readonly EvidenceFact[],
): boolean {
  if (deriveClaimCapabilities(facts).has("delivery_occurred")) return true;

  for (const fact of facts) {
    if (!ORDER_FACT_CATEGORIES.has(String(fact.category))) continue;
    const value = (fact.value ?? {}) as Record<string, unknown>;
    const status = value.fulfillmentStatus;
    if (typeof status === "string" && status.toUpperCase() === "FULFILLED") {
      return true;
    }
  }
  return false;
}
