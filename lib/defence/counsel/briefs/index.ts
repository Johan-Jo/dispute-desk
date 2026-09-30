/**
 * Case briefs — what a dispute type contributes to a letter, as DATA ONLY
 * (docs/plans/defence-letter-structure.plan.md §2.3). A brief never carries
 * method, wording or instructions: the method lives once, in the
 * constitution (constitution.ts), for every type.
 *
 * Fields:
 *   claim       — the claim in plain words (the letter's first sentence restates it)
 *   question    — what the decider asks, per provider, from the network/provider guidance
 *   claims      — the ledger claims this type may use
 *   theories    — claim tuples in order of force; the first whose claims are all
 *                 in the ledger is the theory of the case
 *   sections    — the exhibits this type shows, the question each answers, the
 *                 claims it rests on; `exhibitOnly` prints the exhibit with no prose
 *   limits      — what may not be claimed (prohibitions only), sent to the writer
 *                 as data and, where a pattern is given, enforced by the checker
 */

import type { EvidenceSectionKey } from "../types";

export interface BriefSection {
  key: EvidenceSectionKey;
  title: string;
  exhibit: string;
  question: string;
  claimIds: string[];
  exhibitOnly?: boolean;
  /** The section is written only when this claim is in the ledger; without
   *  it the section's other claims have nothing to argue from (#93254: the
   *  return window had closed, "no return recorded" alone opened a Return
   *  Route section and the writer invented an open route). */
  requiresClaimId?: string;
}

/** Whether a brief section applies to this case's ledger. */
export function sectionApplies(s: BriefSection, inLedger: ReadonlySet<string>): boolean {
  if (s.requiresClaimId && !inLedger.has(s.requiresClaimId)) return false;
  return s.claimIds.some((id) => inLedger.has(id));
}

export interface BriefLimit {
  rule: string;
  pattern?: RegExp;
}

export interface Brief {
  type: string;
  claim: string;
  question: { card: string; paypal: string; klarna: string };
  claims: string[];
  theories: Array<{ name: string; claimIds: string[] }>;
  minimumClaims: string[];
  /** At least ONE of these must be in the ledger (in addition to every
   *  `minimumClaims`). Item-not-received argues from a single delivery, a
   *  set of parcels, or a shipment the carrier shows in transit. */
  minimumAnyOf?: string[];
  ceilingClaims: string[];
  sections: BriefSection[];
  limits: BriefLimit[];
  references: string[];
}

const SEQUENCE = ["order_placed", "shipped", "shipped_promptly", "carrier_delivered", "transit_days", "dispute_after_delivery", "delivered_after_dispute_opened", "dispute_opened"];

export const ITEM_NOT_RECEIVED_BRIEF: Brief = {
  type: "item_not_received",
  claim: "the order was not received",
  question: {
    card: "Was the order delivered, and was all of it delivered?",
    paypal: "Was the item delivered?",
    klarna: "Were the goods received?",
  },
  claims: [
    "claim_is_non_receipt", ...SEQUENCE, "signed_for", "carrier_is_third_party", "whole_order_in_shipment",
    "full_amount_covered", "within_shipping_policy", "delivery_notice_same_day", "later_order",
    "shipping_matches_billing", "billing_address_verified", "order_in_parcels", "all_parcels_delivered", "some_parcel_delivered",
    "shipment_in_transit",
  ],
  theories: [
    { name: "every_parcel_delivered", claimIds: ["all_parcels_delivered", "order_in_parcels"] },
    { name: "delivered_parcel_and_rest_shipped", claimIds: ["some_parcel_delivered", "order_in_parcels"] },
    { name: "delivered_then_reordered", claimIds: ["carrier_delivered", "later_order"] },
    { name: "delivered_and_notified", claimIds: ["carrier_delivered", "delivery_notice_same_day", "dispute_after_delivery"] },
    { name: "whole_order_one_parcel", claimIds: ["carrier_delivered", "whole_order_in_shipment"] },
    { name: "delivered_after_dispute_opened", claimIds: ["delivered_after_dispute_opened"] },
    { name: "shipped_in_transit", claimIds: ["shipment_in_transit"] },
    { name: "delivered", claimIds: ["carrier_delivered"] },
  ],
  minimumClaims: [],
  minimumAnyOf: ["carrier_delivered", "all_parcels_delivered", "some_parcel_delivered", "shipment_in_transit"],
  ceilingClaims: [],
  sections: [
    {
      key: "shipping",
      title: "Shipping & Delivery",
      exhibit: "the shipment card (carrier, tracking number, shipped and delivered dates) and the carrier's tracking link",
      question: "Does the carrier's own record show the delivery the customer denies?",
      claimIds: ["carrier_delivered", "signed_for", "carrier_is_third_party", "whole_order_in_shipment", "order_in_parcels", "all_parcels_delivered", "some_parcel_delivered", "shipment_in_transit"],
    },
  ],
  limits: [
    { rule: "No statement that the complete, entire or whole order was delivered unless whole_order_in_shipment or all_parcels_delivered is in the ledger." },
    { rule: "No statement that a parcel was delivered unless its own claim records the delivery." },
  ],
  references: ["Visa DMG 13.1", "Mastercard 4855", "PayPal INR", "Klarna: goods not received"],
};

export const NOT_AS_DESCRIBED_BRIEF: Brief = {
  type: "product_not_as_described",
  claim: "the item was not as described",
  question: {
    card: "Did the item differ from its description?",
    paypal: "Was the item significantly different from its description?",
    klarna: "Was the item faulty or not as described?",
  },
  claims: [
    "claim_is_not_as_described", ...SEQUENCE, "order_specified", "shipped_as_ordered", "listing_published",
    "return_route_open", "no_return_recorded", "merchant_confirmed_no_request", "later_order",
  ],
  theories: [
    { name: "specified_shipped_return_open", claimIds: ["order_specified", "shipped_as_ordered", "carrier_delivered", "return_route_open"] },
    { name: "specified_shipped_delivered", claimIds: ["order_specified", "shipped_as_ordered", "carrier_delivered"] },
    { name: "delivered_return_open", claimIds: ["carrier_delivered", "return_route_open"] },
    { name: "delivered_then_reordered", claimIds: ["carrier_delivered", "later_order"] },
    { name: "delivered_then_disputed", claimIds: ["carrier_delivered", "dispute_after_delivery"] },
    { name: "sale_on_record", claimIds: ["claim_is_not_as_described"] },
  ],
  minimumClaims: ["claim_is_not_as_described"],
  ceilingClaims: ["listing_at_order_time", "bank_claim_issue", "merchant_act"],
  sections: [
    {
      key: "lineItems",
      title: "What Was Ordered and Shipped",
      exhibit: "the line-items table (the item as described on the order) and, below it, the store's current listing with photographs and an English translation",
      question: "What exactly did the customer order, and what did the merchant ship?",
      claimIds: ["order_specified", "shipped_as_ordered"],
    },
    {
      key: "shipping",
      title: "Shipping & Delivery",
      exhibit: "the shipment card (carrier, tracking number, shipped and delivered dates)",
      question: "When did the goods reach the customer?",
      claimIds: ["carrier_delivered", "dispute_after_delivery", "no_return_recorded", "merchant_confirmed_no_request"],
    },
    {
      key: "policy",
      title: "Return Route",
      exhibit: "a one-line summary of the store's refund policy with a link to the published policy",
      question: "What remedy did the store offer, and was it open at the dispute?",
      claimIds: ["return_route_open", "no_return_recorded"],
      requiresClaimId: "return_route_open",
    },
  ],
  limits: [
    { rule: "No statement that the item matched, conformed to or was as described in any listing.", pattern: /\b(?:match(?:ed|es)?|conform(?:ed|s)?)\b|\bwas as (?:described|advertised|listed|pictured)\b/i },
    { rule: "No statement that the listing is what the customer saw at purchase or checkout.", pattern: /\bat (?:the time of )?(?:purchase|checkout|the time of (?:the )?order)\b/i },
    { rule: "No product detail beyond the order's own item description (order_specified), in English: no features taken from the listing, and never the store's product name." },
    {
      rule: "No argument from the listing: it was retrieved for this response, so it is shown, never relied on.",
      pattern: /\b(?:supported|shown|established|proved|confirmed)\b[^.]{0,40}\blisting\b|\blisting\b[^.]{0,30}\b(?:shows|establishes|proves|confirms|supports|is before)\b/i,
    },
    { rule: "No statement that the listing is reproduced in full or complete: the exhibit is an excerpt.", pattern: /\blisting\b[^.]{0,60}\b(?:in full|in its entirety)\b|\b(?:complete|entire|full) listing\b/i },
    { rule: "No argument that the goods arrived as if non-receipt were claimed." },
  ],
  references: ["Visa DMG 13.3 pp. 40-41", "Mastercard 4853", "PayPal SNAD", "Klarna: faulty or not as described"],
};

export const GENERAL_BRIEF: Brief = {
  type: "general",
  claim: "the transaction is disputed",
  question: {
    card: "What does the record show about this sale?",
    paypal: "What does the record show about this sale?",
    klarna: "What does the record show about this sale?",
  },
  claims: ["claim_stated", ...SEQUENCE, "later_order"],
  theories: [
    { name: "delivered_then_reordered", claimIds: ["carrier_delivered", "later_order"] },
    { name: "delivered_then_disputed", claimIds: ["carrier_delivered", "dispute_after_delivery"] },
    { name: "sale_on_record", claimIds: ["claim_stated"] },
  ],
  minimumClaims: ["claim_stated"],
  ceilingClaims: [],
  sections: [
    {
      key: "shipping",
      title: "Shipping & Delivery",
      exhibit: "the shipment card (carrier, tracking number, shipped and delivered dates)",
      question: "What does the carrier's record show?",
      claimIds: ["carrier_delivered"],
    },
  ],
  limits: [{ rule: "No payment-authentication statement (3-D Secure, AVS, CVV)." }],
  references: [],
};

/** The brief for a reason-code module; the general brief for any other. */
export function briefForModule(moduleKey: string): Brief {
  if (moduleKey === "inr_product_not_received") return ITEM_NOT_RECEIVED_BRIEF;
  if (moduleKey === "product_unacceptable") return NOT_AS_DESCRIBED_BRIEF;
  return GENERAL_BRIEF;
}
