/**
 * Argument templates per dispute reason.
 *
 * Each template defines:
 * - disputeType: merchant-readable label
 * - toWin: what the merchant must prove
 * - strongestEvidence: most impactful evidence types
 * - counterclaims: structured claims with required/supporting evidence
 */

import type { ArgumentTemplate } from "./types";

const TEMPLATES: Record<string, ArgumentTemplate> = {
  FRAUDULENT: {
    disputeType: "Fraud \u2014 Unauthorized transaction",
    toWin: [
      "Cardholder authorized the transaction",
      "Identity matches buyer behavior",
      "Delivery was successful",
    ],
    strongestEvidence: [
      "AVS/CVV match",
      "Customer purchase history",
      "Delivery confirmation",
    ],
    counterclaims: [
      {
        id: "fraud-1",
        title: "Transaction was verified by payment processor",
        requiredEvidence: ["avs_cvv_match", "billing_address_match"],
        // 3DS is supporting only — we cannot auto-collect it
        supportingEvidence: ["threeds_authentication", "customer_ip", "risk_analysis"],
      },
      {
        id: "fraud-2",
        title: "Order was fulfilled to verified address",
        requiredEvidence: ["shipping_tracking", "delivery_proof"],
        supportingEvidence: ["billing_address_match"],
      },
      {
        id: "fraud-3",
        title: "Customer has legitimate purchase history",
        requiredEvidence: ["activity_log"],
        supportingEvidence: ["customer_communication"],
      },
    ],
  },

  PRODUCT_NOT_RECEIVED: {
    disputeType: "Item not received",
    toWin: [
      "Item was shipped with tracking",
      "Delivery was confirmed by carrier",
      "Shipping terms were disclosed",
    ],
    strongestEvidence: [
      "Tracking confirmation",
      "Delivery proof",
      "Shipping policy",
    ],
    counterclaims: [
      {
        id: "pnr-1",
        title: "Order was shipped and delivered",
        requiredEvidence: ["shipping_tracking", "delivery_proof"],
        supportingEvidence: [],
      },
      {
        id: "pnr-2",
        title: "Customer was notified of shipment",
        requiredEvidence: ["customer_communication"],
        supportingEvidence: [],
      },
      {
        id: "pnr-3",
        title: "Shipping terms were disclosed at checkout",
        requiredEvidence: ["shipping_policy"],
        supportingEvidence: [],
      },
    ],
  },

  PRODUCT_UNACCEPTABLE: {
    disputeType: "Product not as described",
    toWin: [
      "Product matched its description",
      "Return/refund policy was disclosed",
      "Customer was contacted for resolution",
    ],
    strongestEvidence: [
      "Product description",
      "Refund policy",
      "Customer communication",
    ],
    counterclaims: [
      {
        id: "pua-1",
        title: "Product matched advertised description",
        requiredEvidence: ["product_description"],
        supportingEvidence: ["supporting_documents"],
      },
      {
        id: "pua-2",
        title: "Return and refund policy was disclosed",
        requiredEvidence: ["refund_policy"],
        supportingEvidence: [],
      },
      {
        id: "pua-3",
        title: "Merchant attempted to resolve the issue",
        requiredEvidence: ["customer_communication"],
        supportingEvidence: [],
      },
    ],
  },

  SUBSCRIPTION_CANCELED: {
    disputeType: "Subscription canceled",
    toWin: [
      "Cancellation terms were disclosed",
      "Customer was notified of renewal",
      "Service was delivered during billing period",
    ],
    strongestEvidence: [
      "Cancellation policy",
      "Renewal notification",
      "Usage history",
    ],
    counterclaims: [
      {
        id: "sub-1",
        title: "Cancellation terms were disclosed before purchase",
        requiredEvidence: ["cancellation_policy"],
        supportingEvidence: [],
      },
      {
        id: "sub-2",
        title: "Customer was notified of upcoming renewal",
        requiredEvidence: ["customer_communication"],
        supportingEvidence: [],
      },
      {
        id: "sub-3",
        title: "Service was delivered during the billing period",
        requiredEvidence: ["activity_log"],
        supportingEvidence: ["supporting_documents"],
      },
    ],
  },

  DUPLICATE: {
    disputeType: "Duplicate charge",
    toWin: [
      "Each charge corresponds to a distinct order",
      "Order details confirm separate transactions",
    ],
    strongestEvidence: [
      "Order confirmation",
      "Duplicate explanation",
    ],
    counterclaims: [
      {
        id: "dup-1",
        title: "Each charge is for a separate order",
        requiredEvidence: ["order_confirmation", "duplicate_explanation"],
        supportingEvidence: ["supporting_documents"],
      },
    ],
  },

  GENERAL: {
    disputeType: "General dispute",
    toWin: [
      "Transaction was legitimate",
      "Order was fulfilled as described",
    ],
    strongestEvidence: [
      "Order confirmation",
      "Shipping tracking",
      "Customer communication",
    ],
    counterclaims: [
      {
        id: "gen-1",
        title: "Transaction was legitimate and fulfilled",
        requiredEvidence: ["order_confirmation"],
        supportingEvidence: [
          "shipping_tracking",
          "customer_communication",
          "refund_policy",
        ],
      },
    ],
  },
};

/**
 * Look up argument template by dispute reason.
 * Returns GENERAL as fallback for unknown reasons.
 */
export function getArgumentTemplate(
  reason: string | null | undefined,
): ArgumentTemplate {
  if (!reason) return TEMPLATES.GENERAL;
  const key = reason.toUpperCase().replace(/\s+/g, "_");
  return TEMPLATES[key] ?? TEMPLATES.GENERAL;
}

/** Issuer claim text per reason. */
const ISSUER_CLAIMS: Record<string, string> = {
  FRAUDULENT: "Customer claims the transaction was not authorized",
  PRODUCT_NOT_RECEIVED: "Customer claims the item was not received",
  PRODUCT_UNACCEPTABLE:
    "Customer claims the product was not as described or defective",
  SUBSCRIPTION_CANCELED:
    "Customer claims the subscription was canceled but still charged",
  DUPLICATE: "Customer claims they were charged more than once",
  GENERAL: "Customer disputes this transaction",
};

export function getIssuerClaimText(
  reason: string | null | undefined,
): string {
  if (!reason) return ISSUER_CLAIMS.GENERAL;
  const key = reason.toUpperCase().replace(/\s+/g, "_");
  return ISSUER_CLAIMS[key] ?? ISSUER_CLAIMS.GENERAL;
}
