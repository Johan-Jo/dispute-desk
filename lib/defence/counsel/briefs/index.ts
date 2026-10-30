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
  /** The question when no delivery is on record. A section whose question
   *  presumes a delivery ("When did the goods reach the customer?") invited the
   *  writer to state one the ledger does not hold (#104457: parcel in transit,
   *  the letter said "the carrier recorded delivery"; the reviewer rejected it). */
  questionWithoutDelivery?: string;
}

/** The ledger claims that put a carrier delivery on record. */
export const DELIVERY_CLAIM_IDS = ["carrier_delivered", "all_parcels_delivered", "some_parcel_delivered"] as const;

export function deliveryOnRecord(inLedger: ReadonlySet<string>): boolean {
  return DELIVERY_CLAIM_IDS.some((id) => inLedger.has(id));
}

/** A section as the writer is shown it for THIS case: with no delivery on
 *  record, the exhibit names no delivered date and the question presumes no
 *  delivery. The same rule as the page context's shipment card (run.ts
 *  `shipmentCardContext`, #103370). */
export function sectionForRecord(s: BriefSection, inLedger: ReadonlySet<string>): BriefSection {
  if (deliveryOnRecord(inLedger)) return s;
  return {
    ...s,
    exhibit: s.exhibit.replace(/shipped and delivered dates/g, "shipped date"),
    question: s.questionWithoutDelivery ?? s.question,
  };
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
  /** How many sentences of the letter may state the recorded absence ("No
   *  return has been recorded…"). Default 1: for most types it is a side note.
   *  Credit not processed argues FROM it, so the summary and the conclusion
   *  may each state it (checks.ts, plan §4.1). */
  absenceMaxMentions?: number;
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
      questionWithoutDelivery: "What does the carrier's own record show about the shipment?",
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
      questionWithoutDelivery: "What does the shipping record show?",
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

/**
 * Credit not processed. Before this brief the type fell to the general brief,
 * which has no claim for returns, so a letter whose only strong fact is "no
 * return recorded in Shopify" argued delivery instead (cay-collective #17615,
 * 2026-10-30: the fact was cited by id in three sections and stated in none).
 * The argument is the module's own: no return is recorded, the refund policy is
 * published, so the claim that a refund is outstanding is not supported — never
 * that no refund was owed, and never what the customer did or asked.
 */
export const CREDIT_NOT_PROCESSED_BRIEF: Brief = {
  type: "credit_not_processed",
  claim: "a refund or credit owed to the customer was not processed",
  question: {
    card: "Is a refund or credit outstanding on this order?",
    paypal: "Is a refund outstanding on this order?",
    klarna: "Is a refund outstanding on this order?",
  },
  claims: [
    "claim_is_credit_not_processed", ...SEQUENCE, "no_return_recorded", "merchant_confirmed_no_request",
    "refund_policy_published", "later_order",
  ],
  theories: [
    { name: "no_return_policy_delivered", claimIds: ["no_return_recorded", "refund_policy_published", "carrier_delivered"] },
    { name: "no_return_delivered", claimIds: ["no_return_recorded", "carrier_delivered"] },
    { name: "no_return_policy", claimIds: ["no_return_recorded", "refund_policy_published"] },
    { name: "no_return", claimIds: ["no_return_recorded"] },
    { name: "delivered_then_disputed", claimIds: ["carrier_delivered", "dispute_after_delivery"] },
    { name: "sale_on_record", claimIds: ["claim_is_credit_not_processed"] },
  ],
  minimumClaims: ["claim_is_credit_not_processed"],
  // A letter with neither a recorded absence nor a delivery has nothing of its
  // own to argue; it falls to the general brief.
  minimumAnyOf: ["no_return_recorded", "carrier_delivered"],
  ceilingClaims: [],
  sections: [
    {
      key: "shipping",
      title: "Shipping & Delivery",
      exhibit: "the shipment card (carrier, tracking number, shipped and delivered dates)",
      question: "When did the goods reach the customer?",
      questionWithoutDelivery: "What does the shipping record show?",
      claimIds: ["carrier_delivered", "dispute_after_delivery"],
    },
  ],
  limits: [
    {
      rule: "No statement that no refund was owed, or that a refund could not be owed. Say only that the claim that a refund is outstanding is not supported by the record.",
      pattern: /\bno refund (?:was|is|had been) (?:ever )?(?:owed|due)\b|\b(?:refund|credit) (?:was|is) not (?:owed|due)\b|\bnothing (?:was|is) owed\b/i,
    },
    {
      rule: "No statement about what the customer did, asked or did not do about a return: only the recorded absence, in the claim's own words, in a sentence with no date or timing word.",
      pattern: /\b(?:customer|cardholder|buyer)\s+(?:did not|didn't|never|has not|hasn't|failed to)\b[^.]{0,40}\b(?:return|request|ask|initiate|attempt|try|contact)/i,
    },
    {
      rule: "Say only that the refund policy is published on the store: never what it requires, and never that the customer agreed to or accepted it.",
      pattern: /\b(?:agreed|accepted|consented|acknowledged)\b[^.]{0,40}\bpolic|\bpolic\w*\b[^.]{0,40}\b(?:requires?|required|states?|stipulates?|conditions?)\b/i,
    },
    { rule: "No statement that a refund was issued, is pending or is being processed." },
    { rule: "No argument that the goods arrived as if non-receipt were claimed: delivery dates the sequence." },
    { rule: "No payment-authentication statement (3-D Secure, AVS, CVV)." },
  ],
  references: ["Visa DMG 13.6", "Mastercard 4860"],
  absenceMaxMentions: 2,
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
  if (moduleKey === "credit_not_processed") return CREDIT_NOT_PROCESSED_BRIEF;
  return GENERAL_BRIEF;
}
