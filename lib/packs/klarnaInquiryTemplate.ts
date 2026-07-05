/**
 * Dynamic Klarna inquiry template resolution.
 *
 * The card/generic inquiry templates foreground card constructs (AVS/CVV)
 * that are meaningless for Klarna. When a dispute is BOTH Klarna (payment
 * family) AND in the inquiry phase, buildPack swaps to a Klarna-tuned light
 * template whose items key to what Klarna actually adjudicates on (Proof of
 * Delivery, refund record, resolution offered, delivery+identity, order
 * breakdown) — never card/fraud signals.
 *
 * This resolution is intentionally kept OUT of `reason_template_mappings`
 * (which is keyed on `(reason_code, dispute_phase)` with no payment-method
 * dimension — repointing it would wrongly catch card inquiries too). The
 * swap happens in buildPack, the only place that knows the payment method
 * for certain (from `derivePaymentContext(order)`).
 *
 * Template UUIDs are fixed by migration
 * `20260705140000_klarna_inquiry_template_variants.sql`.
 */

/** Fixed Klarna inquiry template IDs (see the migration). */
export const KLARNA_INQUIRY_TEMPLATE_IDS = {
  pnr: "a0000000-0000-0000-0000-000000000c01",
  refund: "a0000000-0000-0000-0000-000000000c02",
  not_as_described: "a0000000-0000-0000-0000-000000000c03",
  unauthorized: "a0000000-0000-0000-0000-000000000c04",
  duplicate: "a0000000-0000-0000-0000-000000000c05",
} as const;

/**
 * Shopify dispute `reason` enum → Klarna inquiry template id. Returns null
 * for reasons without a dedicated Klarna inquiry variant (the caller then
 * leaves the pre-stamped template — typically the card `general_inquiry` —
 * in place). Reason match is case-insensitive.
 */
export function resolveKlarnaInquiryTemplateId(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  switch (reason.toUpperCase()) {
    case "PRODUCT_NOT_RECEIVED":
      return KLARNA_INQUIRY_TEMPLATE_IDS.pnr;
    case "CREDIT_NOT_PROCESSED":
      return KLARNA_INQUIRY_TEMPLATE_IDS.refund;
    case "PRODUCT_UNACCEPTABLE":
      return KLARNA_INQUIRY_TEMPLATE_IDS.not_as_described;
    case "FRAUDULENT":
    case "UNRECOGNIZED":
    case "DEBIT_NOT_AUTHORIZED":
      return KLARNA_INQUIRY_TEMPLATE_IDS.unauthorized;
    case "DUPLICATE":
      return KLARNA_INQUIRY_TEMPLATE_IDS.duplicate;
    default:
      return null;
  }
}

/**
 * Should buildPack swap to a Klarna inquiry template for this dispute?
 * True only when the payment family is Klarna AND the dispute is in the
 * inquiry phase AND the reason maps to a Klarna inquiry variant. Returns
 * the target template id, or null to leave the existing template.
 */
export function klarnaInquiryTemplateOverride(args: {
  paymentFamily: string | null | undefined;
  phase: string | null | undefined;
  reason: string | null | undefined;
}): string | null {
  if (args.paymentFamily !== "klarna") return null;
  if ((args.phase ?? "").toLowerCase() !== "inquiry") return null;
  return resolveKlarnaInquiryTemplateId(args.reason);
}
