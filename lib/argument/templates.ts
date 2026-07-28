/**
 * Argument templates per dispute reason.
 *
 * Each template defines:
 * - disputeType: merchant-readable label
 * - toWin: what the merchant must prove
 * - strongestEvidence: most impactful evidence types
 *
 * Post-retirement (2026-05-16): the per-template `counterclaims` field
 * was dropped along with the legacy bank-rebuttal engine. The workspace
 * API reads only `disputeType` / `toWin` / `strongestEvidence` via
 * `caseTypeInfo`; nothing else consumes the templates now.
 */

import type { ArgumentTemplate } from "./types";
import { canonicalReasonCode } from "@/lib/rules/disputeReasons";

const TEMPLATES: Record<string, ArgumentTemplate> = {
  FRAUDULENT: {
    disputeType: "Fraud — Unauthorized transaction",
    toWin: [
      "Transaction verification checks passed",
      "Order was fulfilled and delivered",
      "Customer behavior is consistent with legitimate purchase",
    ],
    strongestEvidence: [
      "AVS/CVV match",
      "Delivery confirmation",
      "Customer purchase history",
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
  },

  SUBSCRIPTION_CANCELLED: {
    disputeType: "Subscription cancelled",
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
  },
};

/**
 * Look up argument template by dispute reason.
 * Returns GENERAL as fallback for unknown reasons.
 */
export function getArgumentTemplate(
  reason: string | null | undefined,
): ArgumentTemplate {
  const key = canonicalReasonCode(reason);
  if (!key) return TEMPLATES.GENERAL;
  return TEMPLATES[key] ?? TEMPLATES.GENERAL;
}

/** Issuer claim text per reason. */
const ISSUER_CLAIMS: Record<string, string> = {
  FRAUDULENT: "Customer claims the transaction was not authorized",
  PRODUCT_NOT_RECEIVED: "Customer claims the item was not received",
  PRODUCT_UNACCEPTABLE:
    "Customer claims the product was not as described or defective",
  SUBSCRIPTION_CANCELLED:
    "Customer claims the subscription was cancelled but still charged",
  DUPLICATE: "Customer claims they were charged more than once",
  GENERAL: "Customer disputes this transaction",
};

export function getIssuerClaimText(
  reason: string | null | undefined,
): string {
  const key = canonicalReasonCode(reason);
  if (!key) return ISSUER_CLAIMS.GENERAL;
  return ISSUER_CLAIMS[key] ?? ISSUER_CLAIMS.GENERAL;
}
