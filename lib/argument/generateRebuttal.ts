/**
 * Generate a bank-optimized dispute response from an ArgumentMap.
 *
 * CRITICAL PRINCIPLES:
 * 1. NEVER mention missing, unavailable, or weak evidence
 * 2. NEVER use hedging language ("appears", "may", "limited", "possibly")
 * 3. ONLY present evidence that strengthens the case
 * 4. Use confident, professional, assertive language
 * 5. Adapt argument strategy to dispute type
 * 6. NEVER expose internal logic (scores, checklist, system state)
 */

import type { ArgumentMap, RebuttalDraft, RebuttalSection } from "./types";
import type { RebuttalReasonSelection } from "@/lib/types/evidenceItem";

/* ── Dispute-type-specific generators ── */

interface EvidenceContext {
  hasAvsCvv: boolean;
  avsCode: string | null;
  cvvCode: string | null;
  hasDelivery: boolean;
  hasTracking: boolean;
  hasCustomerHistory: boolean;
  hasCommunication: boolean;
  hasBillingMatch: boolean;
  hasOrderConfirmation: boolean;
  hasPolicies: boolean;
  hasProductDescription: boolean;
  supportingFields: string[];
}

function buildEvidenceContext(argumentMap: ArgumentMap): EvidenceContext {
  const allSupporting = new Set<string>();
  for (const claim of argumentMap.counterclaims) {
    for (const s of claim.supporting) allSupporting.add(s.field);
  }

  return {
    hasAvsCvv: allSupporting.has("avs_cvv_match"),
    avsCode: null, // filled from evidence data when available
    cvvCode: null,
    hasDelivery: allSupporting.has("delivery_proof"),
    hasTracking: allSupporting.has("shipping_tracking"),
    hasCustomerHistory: allSupporting.has("activity_log"),
    hasCommunication: allSupporting.has("customer_communication"),
    hasBillingMatch: allSupporting.has("billing_address_match"),
    hasOrderConfirmation: allSupporting.has("order_confirmation"),
    hasPolicies: allSupporting.has("refund_policy") || allSupporting.has("shipping_policy") || allSupporting.has("cancellation_policy"),
    hasProductDescription: allSupporting.has("product_description"),
    supportingFields: [...allSupporting],
  };
}

function generateFraudResponse(ctx: EvidenceContext): RebuttalSection[] {
  const sections: RebuttalSection[] = [];

  // Summary — always confident
  sections.push({
    id: "summary",
    type: "summary",
    text: "We respectfully dispute this claim. The transaction was successfully authorized and completed following all standard payment verification procedures. The evidence provided demonstrates that the cardholder actively participated in the transaction and that all security checks were passed.",
    evidenceRefs: [],
  });

  // Claim 1: Authorization
  if (ctx.hasAvsCvv || ctx.hasBillingMatch || ctx.hasOrderConfirmation) {
    let text = "The transaction was authenticated using standard card security protocols.";
    if (ctx.hasAvsCvv) {
      text += " Both Address Verification Service (AVS) and Card Verification Value (CVV) checks were successfully validated. These results confirm that the purchaser had access to the correct billing address and card security code at the time of the transaction. Such verification is only possible when the cardholder or an authorized user is in possession of the card details.";
    }
    if (ctx.hasBillingMatch) {
      text += " Billing and shipping information were consistent, further supporting authorized use.";
    }
    sections.push({
      id: "fraud-auth",
      type: "claim",
      claimId: "fraud-1",
      text,
      evidenceRefs: ctx.supportingFields.filter(f => ["avs_cvv_match", "billing_address_match"].includes(f)),
    });
  }

  // Claim 2: Order flow
  if (ctx.hasOrderConfirmation || ctx.hasCommunication) {
    let text = "The order was placed directly through the merchant's online store and followed a standard checkout process.";
    if (ctx.hasOrderConfirmation) {
      text += " Order confirmation was generated immediately after checkout. Payment was successfully authorized and captured without any errors.";
    }
    if (ctx.hasCommunication) {
      text += " A confirmation email was sent to the customer's registered email address.";
    }
    text += " This sequence reflects a typical and intentional customer purchase.";
    sections.push({
      id: "fraud-flow",
      type: "claim",
      claimId: "fraud-2",
      text,
      evidenceRefs: ctx.supportingFields.filter(f => ["order_confirmation", "customer_communication"].includes(f)),
    });
  }

  // Claim 3: Customer behavior
  if (ctx.hasCustomerHistory || ctx.hasBillingMatch) {
    let text = "The transaction aligns with expected customer behavior.";
    if (ctx.hasBillingMatch) {
      text += " Billing and shipping information were consistent.";
    }
    text += " No irregularities or failed verification attempts were detected. The payment was processed successfully on the first attempt. There are no indicators suggesting unauthorized use or third-party interference.";
    sections.push({
      id: "fraud-behavior",
      type: "claim",
      claimId: "fraud-3",
      text,
      evidenceRefs: ctx.supportingFields.filter(f => ["activity_log", "billing_address_match"].includes(f)),
    });
  }

  // Claim 4: Delivery (only if available — strengthens case)
  if (ctx.hasTracking || ctx.hasDelivery) {
    let text = "The order was fulfilled and shipped to the address provided by the customer.";
    if (ctx.hasTracking) {
      text += " Shipping tracking confirms that the order was dispatched and delivered.";
    }
    if (ctx.hasDelivery) {
      text += " Carrier delivery confirmation is on file.";
    }
    text += " The delivery to the provided address further supports that the transaction was conducted by the legitimate account holder.";
    sections.push({
      id: "fraud-delivery",
      type: "claim",
      claimId: "fraud-delivery",
      text,
      evidenceRefs: ctx.supportingFields.filter(f => ["shipping_tracking", "delivery_proof"].includes(f)),
    });
  }

  // Conclusion
  sections.push({
    id: "conclusion",
    type: "conclusion",
    text: "All available evidence supports that this transaction was completed by the legitimate cardholder using valid payment credentials. The successful verification checks and normal purchase flow confirm authorization. We respectfully request that this dispute be resolved in favor of the merchant.",
    evidenceRefs: [],
  });

  return sections;
}

function generateNotReceivedResponse(ctx: EvidenceContext): RebuttalSection[] {
  const sections: RebuttalSection[] = [];

  sections.push({
    id: "summary",
    type: "summary",
    text: "We respectfully dispute this claim. The order was fulfilled and delivered as confirmed by carrier tracking records. All shipping commitments were met in accordance with the store's disclosed shipping policy.",
    evidenceRefs: [],
  });

  if (ctx.hasTracking || ctx.hasDelivery) {
    let text = "The order was shipped with full tracking and delivered to the customer's address.";
    if (ctx.hasTracking) {
      text += " Carrier tracking records confirm that the shipment was dispatched and successfully delivered.";
    }
    if (ctx.hasDelivery) {
      text += " Delivery confirmation from the carrier is on file, verifying that the package reached its destination.";
    }
    sections.push({
      id: "pnr-delivery",
      type: "claim",
      claimId: "pnr-1",
      text,
      evidenceRefs: ctx.supportingFields.filter(f => ["shipping_tracking", "delivery_proof"].includes(f)),
    });
  }

  if (ctx.hasCommunication || ctx.hasOrderConfirmation) {
    let text = "The customer was properly notified throughout the fulfillment process.";
    if (ctx.hasOrderConfirmation) {
      text += " An order confirmation was sent at the time of purchase.";
    }
    if (ctx.hasCommunication) {
      text += " Shipping notifications were delivered to the customer's registered email address.";
    }
    sections.push({
      id: "pnr-comms",
      type: "claim",
      claimId: "pnr-2",
      text,
      evidenceRefs: ctx.supportingFields.filter(f => ["customer_communication", "order_confirmation"].includes(f)),
    });
  }

  if (ctx.hasPolicies) {
    sections.push({
      id: "pnr-policy",
      type: "claim",
      claimId: "pnr-3",
      text: "The store's shipping policy was clearly disclosed and accepted by the customer at the time of purchase. The order was fulfilled within the stated delivery timeframe and in accordance with all published shipping terms.",
      evidenceRefs: ctx.supportingFields.filter(f => ["shipping_policy", "refund_policy"].includes(f)),
    });
  }

  sections.push({
    id: "conclusion",
    type: "conclusion",
    text: "The evidence confirms that the order was shipped, tracked, and delivered as promised. We respectfully request that this dispute be resolved in favor of the merchant.",
    evidenceRefs: [],
  });

  return sections;
}

function generateProductUnacceptableResponse(ctx: EvidenceContext): RebuttalSection[] {
  const sections: RebuttalSection[] = [];

  sections.push({
    id: "summary",
    type: "summary",
    text: "We respectfully dispute this claim. The product was accurately described and delivered as advertised. The store's return and refund policy was clearly disclosed at checkout.",
    evidenceRefs: [],
  });

  if (ctx.hasProductDescription || ctx.hasOrderConfirmation) {
    let text = "The product delivered matches the description as listed on the store at the time of purchase.";
    if (ctx.hasProductDescription) {
      text += " Product description documentation confirms that all specifications and features were accurately represented.";
    }
    sections.push({
      id: "pua-desc",
      type: "claim",
      claimId: "pua-1",
      text,
      evidenceRefs: ctx.supportingFields.filter(f => ["product_description", "order_confirmation"].includes(f)),
    });
  }

  if (ctx.hasPolicies) {
    sections.push({
      id: "pua-policy",
      type: "claim",
      claimId: "pua-2",
      text: "The store's return and refund policy was clearly presented and accepted by the customer prior to completing the purchase. The customer had the opportunity to review these terms before placing the order.",
      evidenceRefs: ctx.supportingFields.filter(f => ["refund_policy"].includes(f)),
    });
  }

  if (ctx.hasCommunication) {
    sections.push({
      id: "pua-comms",
      type: "claim",
      claimId: "pua-3",
      text: "The merchant actively engaged with the customer to resolve any concerns. Communication records show that the merchant responded promptly and offered resolution in accordance with the store's policies.",
      evidenceRefs: ["customer_communication"],
    });
  }

  sections.push({
    id: "conclusion",
    type: "conclusion",
    text: "The product was accurately described, properly delivered, and the store's policies were clearly disclosed. We respectfully request that this dispute be resolved in favor of the merchant.",
    evidenceRefs: [],
  });

  return sections;
}

function generateSubscriptionResponse(ctx: EvidenceContext): RebuttalSection[] {
  const sections: RebuttalSection[] = [];

  sections.push({
    id: "summary",
    type: "summary",
    text: "We respectfully dispute this claim. The customer agreed to the subscription terms and was properly notified of all billing and cancellation conditions prior to enrollment.",
    evidenceRefs: [],
  });

  if (ctx.hasPolicies) {
    sections.push({
      id: "sub-terms",
      type: "claim",
      claimId: "sub-1",
      text: "The cancellation and billing terms were clearly presented to the customer before the subscription was activated. The customer explicitly agreed to these terms at the time of enrollment.",
      evidenceRefs: ctx.supportingFields.filter(f => ["cancellation_policy"].includes(f)),
    });
  }

  if (ctx.hasCommunication) {
    sections.push({
      id: "sub-notify",
      type: "claim",
      claimId: "sub-2",
      text: "The customer was notified of upcoming billing cycles in accordance with the subscription terms. All renewal notifications were sent to the customer's registered email address.",
      evidenceRefs: ["customer_communication"],
    });
  }

  if (ctx.hasCustomerHistory) {
    sections.push({
      id: "sub-usage",
      type: "claim",
      claimId: "sub-3",
      text: "Account activity records confirm that the service was actively used during the billing period in question. The customer accessed and utilized the service as intended.",
      evidenceRefs: ["activity_log"],
    });
  }

  sections.push({
    id: "conclusion",
    type: "conclusion",
    text: "The subscription was properly authorized, terms were clearly disclosed, and the service was delivered. We respectfully request that this dispute be resolved in favor of the merchant.",
    evidenceRefs: [],
  });

  return sections;
}

function generateGenericResponse(ctx: EvidenceContext): RebuttalSection[] {
  const sections: RebuttalSection[] = [];

  sections.push({
    id: "summary",
    type: "summary",
    text: "We respectfully dispute this claim. The transaction was properly authorized, the order was fulfilled as described, and all relevant store policies were disclosed at checkout.",
    evidenceRefs: [],
  });

  if (ctx.hasOrderConfirmation || ctx.hasAvsCvv) {
    let text = "The transaction was processed through normal channels and completed successfully.";
    if (ctx.hasAvsCvv) text += " Payment verification checks confirmed the legitimacy of the transaction.";
    if (ctx.hasOrderConfirmation) text += " Order confirmation was provided to the customer immediately.";
    sections.push({
      id: "gen-order",
      type: "claim",
      claimId: "gen-1",
      text,
      evidenceRefs: ctx.supportingFields.filter(f => ["order_confirmation", "avs_cvv_match"].includes(f)),
    });
  }

  if (ctx.hasTracking || ctx.hasDelivery) {
    let text = "The order was fulfilled and shipped.";
    if (ctx.hasTracking) text += " Tracking confirmation is on file.";
    if (ctx.hasDelivery) text += " Delivery has been confirmed by the carrier.";
    sections.push({
      id: "gen-delivery",
      type: "claim",
      claimId: "gen-2",
      text,
      evidenceRefs: ctx.supportingFields.filter(f => ["shipping_tracking", "delivery_proof"].includes(f)),
    });
  }

  sections.push({
    id: "conclusion",
    type: "conclusion",
    text: "The evidence supports that this transaction was legitimate and properly fulfilled. We respectfully request that this dispute be resolved in favor of the merchant.",
    evidenceRefs: [],
  });

  return sections;
}

/* ── Main generator ── */

export function generateRebuttalDraft(
  argumentMap: ArgumentMap,
  rebuttalReason?: RebuttalReasonSelection,
): RebuttalDraft {
  const ctx = buildEvidenceContext(argumentMap);
  const reason = argumentMap.issuerClaim.reasonCode;

  let sections: RebuttalSection[];

  switch (reason) {
    case "FRAUDULENT":
      sections = generateFraudResponse(ctx);
      break;
    case "PRODUCT_NOT_RECEIVED":
      sections = generateNotReceivedResponse(ctx);
      break;
    case "PRODUCT_UNACCEPTABLE":
      sections = generateProductUnacceptableResponse(ctx);
      break;
    case "SUBSCRIPTION_CANCELED":
      sections = generateSubscriptionResponse(ctx);
      break;
    default:
      sections = generateGenericResponse(ctx);
      break;
  }

  // Filter out claims with no evidence refs (except summary/conclusion)
  sections = sections.filter(s =>
    s.type === "summary" || s.type === "conclusion" || s.evidenceRefs.length > 0,
  );

  return { sections, source: "generated" };
}
