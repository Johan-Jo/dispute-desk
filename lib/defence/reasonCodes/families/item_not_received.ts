/**
 * Family: item not received (Visa 13.1, MC 4855).
 *
 * Bank-side claim: the cardholder never received the goods/service.
 * Cross-module strategy is to surface delivery confirmation (physical)
 * or access logs (digital), and frame around what tracking shows when
 * delivery confirmation is absent.
 *
 * `prohibitedBankPhrases` (v2, 2026-09-23 — docs/plans/non-receipt-delivery-
 * evidence.plan.md §4.1(c), §6.3). Hard-banned at every validator layer
 * (narrative, thesis, fallback, composed document) via `extraHardPhrases`:
 *
 *   1. ANY argument from the absence of a return. A cardholder who says the
 *      goods never arrived has nothing to return, so "no return was
 *      initiated" / "the absence of any return activity" reads as agreement
 *      that nothing arrived. Two live letters argued it (blume-box #360980,
 *      cay-collective #14784). `no_return_initiated` is also denied admission
 *      for this family (lib/defence/alwaysAdmissible.ts); this list is the
 *      second layer that catches the same reasoning arriving without the fact.
 *      Paraphrase-tolerant by construction: negation + return within a clause.
 *   2. Any assertion that no refund, reimbursement or compensation was
 *      requested. We can never verify that absence across every channel the
 *      cardholder could have used, and on this claim type the cardholder
 *      frequently HAS asked (Case A's stored message asks to be reimbursed).
 *   3. Collector and identity claims. A carrier's delivery or collection
 *      status records THAT a parcel was delivered or collected, never WHO took
 *      it; `collectedByCustomer` was retired for exactly that reason (PR-C1).
 *      The permitted form is the carrier's record ("PostNord records the
 *      shipment as collected at the pickup point on 18 September").
 */

import { REFUND_REQUEST_DENIAL_PATTERNS } from "../../internalConstraints";
import type { ReasonCodeFamily } from "../../types";

export const item_not_received: ReasonCodeFamily = {
  key: "item_not_received",
  displayName: "Item not received",
  moduleKeys: ["inr_product_not_received"],
  unmodeledCodes: [],
  fallbackModuleKey: "inr_product_not_received",
  overlayPromptBody: "",
  familyAvoid: [],
  prohibitedBankPhrases: [
    // 1. Absence-of-return arguments, any phrasing.
    /\b(?:no|not|never|without|nor)\b[^.;:]{0,60}?\breturn(?:s|ed|ing)?\b/i,
    /\babsence\s+of\s+(?:any\s+)?(?:a\s+)?return/i,
    /\breturn(?:s)?\s+(?:was|were|has|have|had)\s+(?:not|never)\b/i,
    /\bmerchandise\s+recovery\b/i,
    // 2. Denials that a refund / reimbursement / compensation was requested.
    //    The same list the internal constraint applies in every other family.
    ...REFUND_REQUEST_DENIAL_PATTERNS,
    // 3. Collector and identity claims.
    /\bcollected\s+by\s+the\s+(?:cardholder|customer|recipient|buyer|purchaser)\b/i,
    /\breceived\s+by\s+the\s+(?:cardholder|customer|recipient|buyer|purchaser)\b/i,
    /\b(?:cardholder|customer|buyer|purchaser)\s+(?:now\s+)?(?:has|have|holds?|possess(?:es)?)\s+the\s+(?:goods|parcel|package|order|item)/i,
    /\b(?:cardholder|customer|buyer|purchaser)\s+(?:personally\s+)?(?:collected|picked\s+up|signed\s+for|signed)\b/i,
    /\b(?:identity|identification|ID)\s+(?:was\s+|were\s+)?(?:verified|checked|confirmed|required)\b/i,
  ],
  // Carrier-possession claims, each checked against the shipment the sentence
  // names (plan §4.1(b)). `shipment_in_carrier_possession` holds only for a
  // bank-citable in-transit shipment with a named carrier and a parcel
  // identifier, so a printed label or a batch reference never licenses one.
  guardedBankPhrases: [
    { pattern: /\bin\s+transit\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    { pattern: /\bin\s+(?:the\s+)?(?:carrier'?s?\s+)?(?:possession|custody)\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    { pattern: /\b(?:handed|tendered)\s+(?:over\s+)?to\s+(?:the\s+)?(?:carrier|[A-Z][A-Za-z]+)\b/, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    { pattern: /\baccepted\s+by\s+the\s+carrier\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    { pattern: /\bout\s+for\s+delivery\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
  ],
  version: 2,
};
