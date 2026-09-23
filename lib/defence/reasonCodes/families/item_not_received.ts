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
 *   4. (v3) Statements of what a record LACKS — no delivery scan, no
 *      signature, "not yet delivered", "the merchant does not assert
 *      otherwise". Each is true and each hands the cardholder their argument
 *      (blume-box #360980, 2026-09-23). The letter says what the records show.
 *
 * `overlayPromptBody` (v3): every shipment on the order is accounted for, each
 * only by what its own record shows (blume-box #360980 had two products in two
 * parcels and the letter named one).
 */

import { REFUND_REQUEST_DENIAL_PATTERNS } from "../../internalConstraints";
import type { ReasonCodeFamily } from "../../types";

export const item_not_received: ReasonCodeFamily = {
  key: "item_not_received",
  displayName: "Item not received",
  moduleKeys: ["inr_product_not_received"],
  unmodeledCodes: [],
  fallbackModuleKey: "inr_product_not_received",
  overlayPromptBody: [
    "ITEM NOT RECEIVED — how the shipments are described:",
    "MULTIPLE SHIPMENTS. When a delivery fact carries `shipments`, the order left in more than one parcel. Account for EVERY entry: in fulfillmentArgument describe each one, and in executiveSummary state that the order was fulfilled in that many shipments. For each entry give the products it contained (items), the carrier, and the date the merchant fulfilled it (fulfilledAt), e.g. 'the merchant fulfilled The Back to School Bundle on 15 September 2026'. Then state only what THAT entry supports:",
    "- referenceIsTrackingNumber true: cite reference as the tracking number, with trackingUrl when present.",
    "- referenceIsTrackingNumber false: call reference the shipping reference, never a tracking number, and give no link.",
    "- proofType delivered_confirmed or signature_confirmed: the carrier's record confirms delivery on deliveredAt.",
    "- proofType in_transit with inTransitSince: the carrier's tracking record shows the shipment in transit since inTransitSince.",
    "- proofType in_transit without inTransitSince: the carrier's record shows the shipment in transit (status as retrieved on carrierStatusObservedAt).",
    "- any other proofType: the carrier has NO record for this parcel. Write it in exactly this shape and nothing more: 'The merchant fulfilled <items> on <fulfilledAt> (<carrier> shipping reference <reference>).' For this parcel never use tendered, handed, accepted, dispatched, shipped, sent, collected, picked up, in transit, delivered, or left the merchant's possession, and never include it in a sentence that says what a carrier did or holds.",
    "- A sentence covering the whole order ('both items', 'each item', 'the order') may only say the merchant fulfilled them. Carrier handling, and any mention of a carrier record, belongs only in a sentence about the parcel whose own entry records it.",
    "Never write a proofType value itself; use plain words.",
    "AFFIRMATIVE ONLY. Describe what the records show. Never describe what a record lacks (a scan, a signature, a confirmation, an event), and never describe the merchant's position by what it declines to claim.",
    "TIMING. disputeOpenedAt is when the dispute was opened. You may state that the merchant fulfilled a shipment on fulfilledAt and that this was before the dispute was opened, giving both dates. For a shipment whose inTransitSince is earlier than disputeOpenedAt you may also state that its tracking record showed it in transit before the dispute was opened, giving both dates. Never relate any other carrier status, or a shipment without inTransitSince, to when the dispute was opened or filed.",
  ].join("\n"),
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
    // 4. What a record lacks.
    /\bno\s+(?:delivery|signature|proof\s+of\s+delivery)\b[^.;]{0,60}\b(?:recorded|received|registered|available|exists?|obtained|captured|scan|event|confirmation)\b/i,
    /\b(?:without|absent|lacking|lacks)\s+(?:a\s+|any\s+)?(?:delivery|signature)\s+(?:scan|event|confirmation|record)/i,
    /\b(?:has|have|had|was|were|is|are)\s+not\s+(?:yet\s+)?(?:been\s+)?delivered\b/i,
    /\bnot\s+yet\s+(?:been\s+)?delivered\b/i,
    /\bundelivered\b/i,
    /\bmerchant\s+(?:does|did)\s+not\s+(?:assert|claim|contend|allege|suggest)\b/i,
  ],
  // Carrier-possession claims, each checked against the shipment the sentence
  // names (plan §4.1(b)). `shipment_in_carrier_possession` holds only for a
  // bank-citable in-transit shipment with a named carrier and a parcel
  // identifier, so a printed label or a batch reference never licenses one.
  guardedBankPhrases: [
    { pattern: /\bin\s+transit\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    { pattern: /\bin\s+(?:the\s+)?(?:carrier'?s?\s+)?(?:possession|custody)\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    { pattern: /\b(?:hand(?:ed|ing)|tender(?:ed|ing))\s+(?:over\s+)?(?:(?:it|them|each|both|each\s+item|the\s+(?:parcel|shipment|package|order|goods|items?))\s+)?(?:over\s+)?to\s+(?:the\s+|its\s+|their\s+)?(?:respective\s+)?(?:carriers?|[A-Z][A-Za-z]+)\b/, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    { pattern: /\baccepted\s+by\s+the\s+carrier\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    // v4: "both items left the merchant's possession" — custody transfer for
    // every parcel, including one no carrier recorded (blume-box #360980).
    { pattern: /\bleft\s+the\s+merchant'?s?\s+(?:possession|custody|premises|warehouse|control)\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    // v5: "two separate shipments, each with its own carrier record" — a
    // carrier record claimed for every parcel, one of which has none
    // (blume-box #360980, v9 draft).
    { pattern: /\b(?:each|both|every|all)\b[^.;]{0,50}\bcarrier\s+(?:record|tracking|scan|event)s?\b|\bcarrier\s+(?:record|tracking)s?\s+(?:for|of|on)\s+(?:each|both|every|all)\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
    { pattern: /\bout\s+for\s+delivery\b/i, requires: "shipment_in_carrier_possession", shipmentScoped: true },
  ],
  version: 5,
};
