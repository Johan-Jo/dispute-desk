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
      mustProve: "that the delivery the cardholder denies is recorded by the carrier itself, a third party, on a public record the issuer can open",
      includeWhen: ["carrier_delivered"],
    },
    {
      key: "lineItems",
      exhibit: "the order line-items table with its total",
      mustProve: "that everything the cardholder paid for was in that one delivered shipment, so no part of the claim is left",
      includeWhen: ["whole_order_in_shipment"],
    },
    {
      key: "chronology",
      exhibit: "the dated timeline of order events (order, payment, shipping, delivery notice, chargeback)",
      mustProve:
        "the story in time: prompt shipping, the carrier's delivery, the delivery notice that day, and what the customer did next (a further order) before claiming non-receipt",
      includeWhen: ["dispute_after_delivery", "later_order", "delivery_notice_same_day", "shipped_promptly"],
    },
  ],
  leaveOut: ["payment authentication (3-D Secure, AVS, CVV)", "IP address and device", "refund, return and cancellation policies"],
  never: [
    "Where the parcel was delivered, or that any address was verified or matched.",
    "That the cardholder personally received, signed for, has or used the goods.",
    "That the cardholder did not complain, contact the merchant or return anything.",
    "That the claim is late or out of time under network rules.",
    "Anything about the cardholder's honesty, motive or intent.",
  ],
};

export const PLAYBOOKS: Record<string, Playbook> = {
  item_not_received: ITEM_NOT_RECEIVED,
};
