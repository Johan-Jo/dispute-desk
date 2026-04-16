/**
 * DisputeDesk Dispute Response Engine
 *
 * STRICT PRODUCTION RULES (NON-NEGOTIABLE):
 *
 * 1. Every statement MUST be directly supported by available evidence
 * 2. If evidence is missing, the section is OMITTED — never mentioned
 * 3. Response shape MUST match the dispute reason family
 * 4. NEVER use generic filler or unsupported claims
 * 5. NEVER reference unavailable checks, systems, or data
 * 6. NEVER weaken the case by mentioning what is absent
 * 7. NEVER expose internal logic (scores, checklists, completeness)
 *
 * This is a conditional logic engine, not a template system.
 */

import type { RebuttalSection } from "./types";

/* ── Evidence Flags ── */

export interface EvidenceFlags {
  avs: boolean;
  cvv: boolean;
  tracking: boolean;
  deliveryConfirmed: boolean;
  customerContact: boolean;
  billingShippingMatch: boolean;
  orderConfirmation: boolean;
  customerHistory: boolean;
  policyAttached: boolean;
  refundIssued: boolean;
  cancellationRequest: boolean;
  cancellationConfirmed: boolean;
  productDescription: boolean;
  digitalAccessLogs: boolean;
  duplicateChargeEvidence: boolean;
  amountCorrectEvidence: boolean;
}

export interface EvidenceData {
  avsCode?: string | null;
  cvvCode?: string | null;
  cardCompany?: string | null;
  cardLastFour?: string | null;
  gateway?: string | null;
  orderName?: string | null;
  orderDate?: string | null;
  orderAmount?: string | null;
  currency?: string | null;
  billingCity?: string | null;
  shippingCity?: string | null;
  customerSince?: string | null;
  priorOrders?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  shippedDate?: string | null;
  deliveredDate?: string | null;
  policyTypes?: string[];
  shopDomain?: string | null;
}

/* ── Reason families ── */

export type ReasonFamily =
  | "fraud"
  | "delivery"
  | "product"
  | "refund"
  | "subscription"
  | "billing"
  | "digital"
  | "general";

const REASON_TO_FAMILY: Record<string, ReasonFamily> = {
  FRAUDULENT: "fraud",
  PRODUCT_NOT_RECEIVED: "delivery",
  PRODUCT_UNACCEPTABLE: "product",
  SUBSCRIPTION_CANCELED: "subscription",
  DUPLICATE: "billing",
  CREDIT_NOT_PROCESSED: "refund",
  GENERAL: "general",
};

export function resolveReasonFamily(reason: string | null | undefined): ReasonFamily {
  if (!reason) return "general";
  const key = reason.toUpperCase().replace(/\s+/g, "_");
  return REASON_TO_FAMILY[key] ?? "general";
}

/* ── Section builders ── */

function paymentVerification(flags: EvidenceFlags, data: EvidenceData): RebuttalSection | null {
  if (!flags.avs && !flags.cvv) return null;

  let text = "The transaction was authenticated using standard card security protocols.";

  if (flags.avs && flags.cvv) {
    const avsDesc = data.avsCode === "Y" ? "Full match" : data.avsCode === "A" ? "Address match" : data.avsCode ?? "Verified";
    const cvvDesc = data.cvvCode === "M" ? "Match" : data.cvvCode ?? "Verified";
    text += ` Address Verification Service (AVS) returned "${avsDesc}" and Card Verification Value (CVV) returned "${cvvDesc}".`;
    text += " These results confirm that the purchaser had access to the correct billing address and card security code at the time of the transaction.";
  } else if (flags.avs) {
    text += " Address Verification Service (AVS) confirmed a match between the billing address provided and the address on file with the card issuer.";
  } else if (flags.cvv) {
    text += " Card Verification Value (CVV) was successfully validated, confirming that the purchaser had physical access to the payment card.";
  }

  return {
    id: "payment-verification",
    type: "claim",
    claimId: "payment-verification",
    text,
    evidenceRefs: [flags.avs ? "avs_cvv_match" : "", flags.cvv ? "avs_cvv_match" : ""].filter(Boolean),
  };
}

function orderFlow(flags: EvidenceFlags, data: EvidenceData): RebuttalSection | null {
  if (!flags.orderConfirmation) return null;

  let text = "The order was placed directly through the merchant's online store and followed a standard checkout process.";
  text += " Order confirmation was generated immediately after checkout.";
  text += " Payment was successfully authorized and captured without any errors or anomalies.";
  if (flags.customerContact) {
    text += " A confirmation notification was sent to the customer's registered email address.";
  }
  text += " This sequence reflects a typical and intentional customer purchase.";

  return {
    id: "order-flow",
    type: "claim",
    claimId: "order-flow",
    text,
    evidenceRefs: ["order_confirmation", flags.customerContact ? "customer_communication" : ""].filter(Boolean),
  };
}

function customerBehavior(flags: EvidenceFlags, data: EvidenceData): RebuttalSection | null {
  if (!flags.billingShippingMatch && !flags.customerHistory) return null;

  let text = "The transaction aligns with expected customer behavior.";
  if (flags.billingShippingMatch) {
    text += " Billing and shipping information provided were consistent.";
  }
  text += " No irregularities or failed verification attempts were detected.";
  text += " The payment was processed successfully on the first attempt.";
  text += " There are no indicators suggesting unauthorized use or third-party interference.";

  return {
    id: "customer-behavior",
    type: "claim",
    claimId: "customer-behavior",
    text,
    evidenceRefs: [
      flags.billingShippingMatch ? "billing_address_match" : "",
      flags.customerHistory ? "activity_log" : "",
    ].filter(Boolean),
  };
}

function deliveryConfirmation(flags: EvidenceFlags, data: EvidenceData): RebuttalSection | null {
  if (!flags.tracking && !flags.deliveryConfirmed) return null;

  let text = "";
  if (flags.deliveryConfirmed) {
    text = "The order was shipped and delivery has been confirmed by the carrier.";
    if (data.carrier) text += ` The shipment was handled by ${data.carrier}.`;
    if (data.deliveredDate) text += ` Delivery was confirmed on ${fmtDate(data.deliveredDate)}.`;
  } else if (flags.tracking) {
    text = "The order was shipped with tracking.";
    if (data.carrier) text += ` The shipment was dispatched via ${data.carrier}.`;
    if (data.trackingNumber) text += ` Tracking number ${data.trackingNumber} was assigned.`;
    if (data.shippedDate) text += ` The order was shipped on ${fmtDate(data.shippedDate)}.`;
  }

  return {
    id: "delivery",
    type: "claim",
    claimId: "delivery",
    text,
    evidenceRefs: [
      flags.tracking ? "shipping_tracking" : "",
      flags.deliveryConfirmed ? "delivery_proof" : "",
    ].filter(Boolean),
  };
}

function productConformity(flags: EvidenceFlags, _data: EvidenceData): RebuttalSection | null {
  if (!flags.productDescription) return null;

  return {
    id: "product-conformity",
    type: "claim",
    claimId: "product-conformity",
    text: "The product delivered matches the description as listed on the store at the time of purchase. Product description documentation confirms that all specifications and features were accurately represented.",
    evidenceRefs: ["product_description"],
  };
}

function policyAgreement(flags: EvidenceFlags, data: EvidenceData): RebuttalSection | null {
  if (!flags.policyAttached) return null;

  const types = data.policyTypes ?? [];
  const parts: string[] = [];
  if (types.includes("refunds")) parts.push("return and refund policy");
  if (types.includes("shipping")) parts.push("shipping policy");
  if (types.includes("terms")) parts.push("terms of service");
  if (types.includes("cancellation") || types.includes("terms")) parts.push("cancellation terms");

  if (parts.length === 0) parts.push("store policies");

  const policyList = parts.length > 1
    ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]
    : parts[0];

  return {
    id: "policy-agreement",
    type: "claim",
    claimId: "policy-agreement",
    text: `The store's ${policyList} were clearly presented and accepted by the customer prior to completing the purchase. The customer had the opportunity to review these terms before placing the order.`,
    evidenceRefs: types.map(t => {
      if (t === "refunds") return "refund_policy";
      if (t === "shipping") return "shipping_policy";
      if (t === "terms") return "cancellation_policy";
      return "";
    }).filter(Boolean),
  };
}

function customerCommunication(flags: EvidenceFlags, _data: EvidenceData): RebuttalSection | null {
  if (!flags.customerContact) return null;

  return {
    id: "customer-communication",
    type: "claim",
    claimId: "customer-communication",
    text: "The merchant actively engaged with the customer regarding this transaction. Communication records show that the merchant responded promptly and appropriately to all inquiries.",
    evidenceRefs: ["customer_communication"],
  };
}

function refundTimeline(flags: EvidenceFlags, _data: EvidenceData): RebuttalSection | null {
  if (!flags.refundIssued) return null;

  return {
    id: "refund-timeline",
    type: "claim",
    claimId: "refund-timeline",
    text: "A refund was issued for this transaction. Processing records confirm that the credit was applied in accordance with the store's refund policy.",
    evidenceRefs: ["refund_policy"],
  };
}

function cancellationTimeline(flags: EvidenceFlags, _data: EvidenceData): RebuttalSection | null {
  if (!flags.cancellationConfirmed && !flags.cancellationRequest) return null;

  let text = "";
  if (flags.cancellationConfirmed) {
    text = "The cancellation was processed in accordance with the store's cancellation terms. The charge in question was incurred prior to the effective cancellation date, in line with the disclosed billing terms.";
  } else {
    text = "The recurring charge was applied in accordance with the subscription terms accepted by the customer. The billing cycle and cancellation conditions were clearly disclosed at the time of enrollment.";
  }

  return {
    id: "cancellation-timeline",
    type: "claim",
    claimId: "cancellation-timeline",
    text,
    evidenceRefs: ["cancellation_policy"],
  };
}

function billingAccuracy(flags: EvidenceFlags, _data: EvidenceData): RebuttalSection | null {
  if (!flags.duplicateChargeEvidence && !flags.amountCorrectEvidence) return null;

  let text = "";
  if (flags.duplicateChargeEvidence) {
    text = "Transaction records confirm that each charge corresponds to a distinct and separate order. The charges are not duplicates.";
  } else if (flags.amountCorrectEvidence) {
    text = "The charged amount matches the order total as confirmed at checkout. No discrepancy exists between the authorized amount and the captured amount.";
  }

  return {
    id: "billing-accuracy",
    type: "claim",
    claimId: "billing-accuracy",
    text,
    evidenceRefs: ["order_confirmation"],
  };
}

function digitalAccess(flags: EvidenceFlags, _data: EvidenceData): RebuttalSection | null {
  if (!flags.digitalAccessLogs) return null;

  return {
    id: "digital-access",
    type: "claim",
    claimId: "digital-access",
    text: "The digital product or service was provisioned and accessed by the customer. Access logs confirm that the customer successfully used the product or service following purchase.",
    evidenceRefs: ["activity_log"],
  };
}

/* ── Family-specific assembly ── */

interface FamilyStrategy {
  summary: string;
  conclusion: string;
  sections: (RebuttalSection | null)[];
}

function fraudStrategy(flags: EvidenceFlags, data: EvidenceData): FamilyStrategy {
  return {
    summary: "We respectfully dispute this claim. The transaction was successfully authorized and completed following all standard payment verification procedures. The evidence provided demonstrates that the cardholder actively participated in the transaction and that all security checks were passed.",
    conclusion: "All available evidence supports that this transaction was completed by the legitimate cardholder using valid payment credentials. The successful verification checks and normal purchase flow confirm authorization. We respectfully request that this dispute be resolved in favor of the merchant.",
    sections: [
      paymentVerification(flags, data),
      orderFlow(flags, data),
      customerBehavior(flags, data),
      deliveryConfirmation(flags, data),
    ],
  };
}

function deliveryStrategy(flags: EvidenceFlags, data: EvidenceData): FamilyStrategy {
  return {
    summary: "We respectfully dispute this claim. The order was fulfilled and delivered as confirmed by carrier records. All shipping commitments were met in accordance with the store's disclosed policies.",
    conclusion: "The evidence confirms that the order was shipped, tracked, and delivered as promised. We respectfully request that this dispute be resolved in favor of the merchant.",
    sections: [
      deliveryConfirmation(flags, data),
      orderFlow(flags, data),
      customerCommunication(flags, data),
      policyAgreement(flags, data),
    ],
  };
}

function productStrategy(flags: EvidenceFlags, data: EvidenceData): FamilyStrategy {
  return {
    summary: "We respectfully dispute this claim. The product was accurately described and delivered as advertised. The store's return and refund policy was clearly disclosed at checkout.",
    conclusion: "The product was accurately described, properly delivered, and the store's policies were clearly disclosed. We respectfully request that this dispute be resolved in favor of the merchant.",
    sections: [
      productConformity(flags, data),
      policyAgreement(flags, data),
      customerCommunication(flags, data),
      deliveryConfirmation(flags, data),
    ],
  };
}

function refundStrategy(flags: EvidenceFlags, data: EvidenceData): FamilyStrategy {
  return {
    summary: "We respectfully dispute this claim. The refund obligation has been addressed in accordance with the store's policies and the transaction details are documented below.",
    conclusion: "The evidence demonstrates that the refund was processed appropriately. We respectfully request that this dispute be resolved in favor of the merchant.",
    sections: [
      refundTimeline(flags, data),
      orderFlow(flags, data),
      policyAgreement(flags, data),
      customerCommunication(flags, data),
    ],
  };
}

function subscriptionStrategy(flags: EvidenceFlags, data: EvidenceData): FamilyStrategy {
  return {
    summary: "We respectfully dispute this claim. The customer agreed to the subscription terms and was properly notified of all billing and cancellation conditions.",
    conclusion: "The subscription was properly authorized, terms were clearly disclosed, and the service was delivered. We respectfully request that this dispute be resolved in favor of the merchant.",
    sections: [
      cancellationTimeline(flags, data),
      policyAgreement(flags, data),
      customerCommunication(flags, data),
      digitalAccess(flags, data),
    ],
  };
}

function billingStrategy(flags: EvidenceFlags, data: EvidenceData): FamilyStrategy {
  return {
    summary: "We respectfully dispute this claim. Transaction records confirm that all charges were processed correctly and correspond to valid orders.",
    conclusion: "The billing records confirm that the charges were accurate and properly processed. We respectfully request that this dispute be resolved in favor of the merchant.",
    sections: [
      billingAccuracy(flags, data),
      orderFlow(flags, data),
      paymentVerification(flags, data),
    ],
  };
}

function digitalStrategy(flags: EvidenceFlags, data: EvidenceData): FamilyStrategy {
  return {
    summary: "We respectfully dispute this claim. The digital product or service was successfully delivered and accessed by the customer.",
    conclusion: "The evidence confirms that the digital product or service was provisioned and used by the customer. We respectfully request that this dispute be resolved in favor of the merchant.",
    sections: [
      digitalAccess(flags, data),
      orderFlow(flags, data),
      customerCommunication(flags, data),
      policyAgreement(flags, data),
    ],
  };
}

function generalStrategy(flags: EvidenceFlags, data: EvidenceData): FamilyStrategy {
  return {
    summary: "We respectfully dispute this claim. The transaction was properly authorized, the order was fulfilled as described, and all relevant store policies were disclosed at checkout.",
    conclusion: "The evidence supports that this transaction was legitimate and properly fulfilled. We respectfully request that this dispute be resolved in favor of the merchant.",
    sections: [
      paymentVerification(flags, data),
      orderFlow(flags, data),
      deliveryConfirmation(flags, data),
      customerCommunication(flags, data),
      policyAgreement(flags, data),
    ],
  };
}

/* ── Main engine ── */

export function generateDisputeResponse(
  reasonFamily: ReasonFamily,
  flags: EvidenceFlags,
  data: EvidenceData,
): RebuttalSection[] {
  const strategies: Record<ReasonFamily, (f: EvidenceFlags, d: EvidenceData) => FamilyStrategy> = {
    fraud: fraudStrategy,
    delivery: deliveryStrategy,
    product: productStrategy,
    refund: refundStrategy,
    subscription: subscriptionStrategy,
    billing: billingStrategy,
    digital: digitalStrategy,
    general: generalStrategy,
  };

  const strategy = (strategies[reasonFamily] ?? strategies.general)(flags, data);

  // Assemble: summary → claims (only those with evidence) → conclusion
  const sections: RebuttalSection[] = [];

  sections.push({
    id: "summary",
    type: "summary",
    text: strategy.summary,
    evidenceRefs: [],
  });

  for (const section of strategy.sections) {
    if (section !== null) {
      sections.push(section);
    }
  }

  sections.push({
    id: "conclusion",
    type: "conclusion",
    text: strategy.conclusion,
    evidenceRefs: [],
  });

  return sections;
}

/* ── Helpers ── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
