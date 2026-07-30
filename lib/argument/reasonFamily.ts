/**
 * Reason-family classification — shared between the file-evidence
 * layer (`lib/shopify/decideFileAttachments.ts`) and the case-strength
 * engine (`lib/argument/caseStrength.ts`).
 *
 * Extracted from `responseEngine.ts` on 2026-05-16 as part of the
 * legacy bank-rebuttal retirement. The rest of `responseEngine.ts`
 * (rebuttal text generation, bank-grade middles, claim sections) was
 * deleted in the same change; this module is the only piece that
 * survived because non-rebuttal consumers still need the reason-code
 * → family mapping.
 *
 * Keys are canonical Shopify enum values only. Legacy spellings are folded in
 * by `canonicalReasonCode` — do NOT add a second key for the same reason.
 */

import { canonicalReasonCode } from "@/lib/rules/disputeReasons";

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
  UNRECOGNIZED: "fraud",
  PRODUCT_NOT_RECEIVED: "delivery",
  PRODUCT_UNACCEPTABLE: "product",
  SUBSCRIPTION_CANCELLED: "subscription",
  DUPLICATE: "billing",
  CREDIT_NOT_PROCESSED: "refund",
  GENERAL: "general",
};

export function resolveReasonFamily(reason: string | null | undefined): ReasonFamily {
  const key = canonicalReasonCode(reason);
  if (!key) return "general";
  return REASON_TO_FAMILY[key] ?? "general";
}
