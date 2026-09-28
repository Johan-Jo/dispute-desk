/**
 * Reason-code playbooks (plan 4 §4). A playbook owns the middle of the
 * letter: which evidence sections appear, in what order of force, and what
 * each proves for THIS claim. The frame (headline + summary first,
 * conclusion last) is the same for every claim.
 */

import type { Playbook } from "./types";

export const ITEM_NOT_RECEIVED: Playbook = {
  familyKey: "item_not_received",
  analystQuestion: "Was the order delivered, and was all of it delivered?",
  theories: [
    // Multi-parcel orders (claimLedger.ts `buildMultiParcelLedger`): their
    // ledgers carry these claims instead of `carrier_delivered`.
    {
      name: "every_parcel_delivered",
      requiresClaims: ["all_parcels_delivered", "order_in_parcels"],
      shape:
        "The order went out in several parcels and the carrier recorded every one of them as delivered. Lead with the carrier's deliveries against the claim.",
    },
    {
      name: "delivered_parcel_and_rest_shipped",
      requiresClaims: ["some_parcel_delivered", "order_in_parcels"],
      shape:
        "The order went out in several parcels. Lead with the parcel the carrier recorded as delivered and name what it contained; then say the merchant shipped the rest. Never say or imply the other parcels were delivered.",
    },
    {
      name: "delivered_and_came_back",
      requiresClaims: ["carrier_delivered", "later_order"],
      shape:
        "The carrier delivered the order; afterwards the same customer came back and bought again with the same payment method; only then was non-receipt claimed. Lead with the contrast between the claim and that sequence.",
    },
    {
      name: "delivered_and_notified",
      requiresClaims: ["carrier_delivered", "delivery_notice_same_day", "dispute_after_delivery"],
      shape:
        "The carrier delivered the order, a delivery notice went to the order's email that day, and the claim came weeks later. Lead with the carrier's delivery against the claim.",
    },
    {
      name: "whole_order_one_parcel",
      requiresClaims: ["carrier_delivered", "whole_order_in_shipment"],
      shape: "Everything bought travelled in one tracked parcel that the carrier delivered, so no part of the claim survives.",
    },
    {
      name: "delivered_after_dispute_opened",
      requiresClaims: ["delivered_after_dispute_opened"],
      shape: "The shipment was in the carrier's hands and has since been delivered; the claim is now answered.",
    },
  ],
  sections: [
    {
      key: "shipping",
      exhibit: "the shipment card above the section (carrier, tracking number, shipped and delivered dates); the tracking link is printed at the end of the section",
      mustProve:
        "that the delivery the cardholder denies is recorded by the carrier itself, a third party, on a public record the issuer can open",
      includeWhen: ["carrier_delivered"],
    },
    {
      key: "chronology",
      exhibit: "the dated timeline of order events (order, payment, shipping, delivery notice, chargeback)",
      mustProve:
        "only what the executive summary did not already say about the sequence (e.g. prompt shipping, the delivery notice sent the day of delivery). The timeline itself shows the later order and the chargeback; do not restate them",
      includeWhen: ["dispute_after_delivery", "later_order", "delivery_notice_same_day", "shipped_promptly"],
    },
  ],
  leaveOut: ["payment authentication (3-D Secure, AVS, CVV)", "IP address and device", "refund, return and cancellation policies"],
  never: [
    "Where the parcel was delivered, or that it reached, arrived at or was received at any address. Any address statement beyond what the ledger's address claims allow.",
    "That the cardholder personally received, signed for, has or used the goods.",
    "That the cardholder did not complain, contact the merchant or return anything.",
    "That the claim is late or out of time under network rules.",
    "Anything about the cardholder's honesty, motive or intent.",
  ],
};

/**
 * Not as described (docs/plans/defence-letter-structure.plan.md §5.2). The
 * listing shows what was sold; delivery and the dispute's opening date the
 * sequence; the store's record shows no return. Returns are code-written only:
 * the summary never mentions them.
 */
export const NOT_AS_DESCRIBED: Playbook = {
  familyKey: "product_not_as_described",
  analystQuestion: "Did the merchant deliver what it advertised, and is there any return?",
  theories: [
    {
      name: "delivered_then_reordered",
      requiresClaims: ["listing_published", "carrier_delivered", "later_order"],
      shape:
        "The item was sold under a published listing, the carrier recorded delivery, and afterwards the same customer ordered again; only then was the item disputed. Lead with that sequence against the claim.",
    },
    {
      name: "listing_then_delivery",
      requiresClaims: ["listing_published", "carrier_delivered", "dispute_after_delivery"],
      shape:
        "The item was sold under a published listing with photographs and a written description; the carrier recorded delivery; the dispute came days later. Lead with the published listing, then the delivery and the interval.",
    },
    {
      name: "listing_on_record",
      requiresClaims: ["listing_published"],
      shape: "The item was sold under a published listing, reproduced in the letter. Lead with the listing against the claim.",
    },
    {
      name: "sequence_on_record",
      requiresClaims: ["claim_is_not_as_described"],
      shape: "State the order's sequence from the record: sold, delivered, disputed.",
    },
  ],
  sections: [
    {
      key: "lineItems",
      exhibit: "the product listing below the line items: photographs, the written description and an English translation",
      mustProve: "what the merchant published for the item it sold",
      includeWhen: ["listing_published"],
    },
    {
      key: "shipping",
      exhibit: "the shipment card (carrier, tracking number, shipped and delivered dates)",
      mustProve: "that the carrier recorded delivery, and that Shopify records no return",
      includeWhen: ["carrier_delivered", "no_return_recorded"],
    },
    {
      key: "chronology",
      exhibit: "the dated timeline: order, payment, shipping, delivery, dispute opened",
      mustProve: "nothing in prose; the timeline shows the sequence",
      includeWhen: [],
    },
  ],
  leaveOut: ["payment authentication (3-D Secure, AVS, CVV)", "IP address and device", "shipping times and delivery promises"],
  never: [
    "That the item matched, conformed to or was as described in its listing; what the product is, does or measures.",
    "That the listing is what the customer saw at purchase or at checkout.",
    "The product's store name, or any words of the listing.",
    "Returns of any kind (code writes the one return sentence).",
    "That the customer received, kept, has or used the goods; where the parcel was delivered.",
    "Anything about the customer's honesty, motive, intent or state of mind.",
  ],
};

export const PLAYBOOKS: Record<string, Playbook> = {
  item_not_received: ITEM_NOT_RECEIVED,
  product_not_as_described: NOT_AS_DESCRIBED,
};

/** The counsel playbook for a reason-code module, or null (no letter). */
export function playbookForModule(moduleKey: string): Playbook | null {
  if (moduleKey === "inr_product_not_received") return ITEM_NOT_RECEIVED;
  if (moduleKey === "product_unacceptable") return NOT_AS_DESCRIBED;
  return null;
}
