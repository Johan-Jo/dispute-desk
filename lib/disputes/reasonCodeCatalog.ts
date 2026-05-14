/**
 * Canonical Visa + Mastercard chargeback reason-code catalog.
 *
 * The codes here drive:
 *  - LSE-1 CE 3.0 qualification (Visa 10.4 is the CE 3.0 anchor)
 *  - LSE-3 FPT readiness (Mastercard 4837 / 4863 are FPT-eligible)
 *  - Rebuttal-template selection (one template per network code, with
 *    family-level fallback for the long tail)
 *  - Evidence-checklist tailoring per code
 *
 * Confidence model: Shopify Admin GraphQL 2026-01 does NOT expose a
 * typed network reason code on `Dispute`. We infer from the coarse
 * `ShopifyPaymentsDisputeReason` enum + card network + order context.
 * See `lib/disputes/networkReasonCode.ts` for the resolver.
 *
 * Catalog is code-first (not a runtime DB table) so additions go
 * through code review. Track Visa Core Rules / Mastercard Chargeback
 * Guide updates and bump `CATALOG_VERSION` on each change.
 *
 * Catalog current as of: 2026-05 (Visa Core Rules Oct 2025 edition,
 * Mastercard Chargeback Guide Jun 2025 edition). Re-verify on each
 * networks-rule release.
 */

import type { AllDisputeReasonCode } from "@/lib/rules/disputeReasons";

export const CATALOG_VERSION = "2026-05-01";

export type CardNetwork = "visa" | "mastercard" | "amex" | "discover";

export type ReasonCodeFamily =
  | "fraud" // 10.x Visa / 48xx-fraud Mastercard
  | "authorization" // 11.x Visa / auth-related MC
  | "processing_error" // 12.x Visa / processing MC
  | "consumer_dispute" // 13.x Visa / consumer MC
  | "fpt_eligible" // Mastercard FPT-targeted subset (4837, 4863)
  | "ce30_eligible"; // Visa CE 3.0 anchor (10.4)

export interface ReasonCodeEntry {
  /** e.g. "10.4", "4837" — string because some networks use dotted notation. */
  code: string;
  network: CardNetwork;
  family: ReasonCodeFamily;
  /** Short human-readable name (English source; localized via i18n key). */
  shortName: string;
  /** Full network-defined description (English source). */
  description: string;
  /** i18n key under `reasonCodes.code.<network>.<code>.*` (kebab-encoded). */
  i18nKey: string;
  /**
   * i18n key for the rebuttal-template family. Resolved via the
   * `rebuttalReason.ts` engine; family-level fallback applies when the
   * specific code does not have its own template yet.
   */
  rebuttalTemplateKey: string;
  /**
   * Logical evidence-checklist key — consumed by the completeness
   * engine to pick the right required/recommended evidence fields.
   */
  evidenceChecklistKey: string;
  /**
   * Which Shopify enum values most commonly collapse into this code.
   * Used by the inference fallback in the resolver.
   */
  shopifyEnumFallbacks: AllDisputeReasonCode[];
  /** Format: YYYY-MM. */
  introducedDate: string;
  /** Format: YYYY-MM. Set when a code is retired by the network. */
  retiredDate?: string;
  notes?: string;
}

/* ── Visa codes ── */

const VISA_CODES: ReasonCodeEntry[] = [
  {
    code: "10.1",
    network: "visa",
    family: "fraud",
    shortName: "EMV Liability Shift Counterfeit Fraud",
    description:
      "Counterfeit fraud where the issuer holds liability because the merchant did not accept a chip card on a chip-capable terminal.",
    i18nKey: "code.visa.10-1",
    rebuttalTemplateKey: "rebuttal.family.fraud",
    evidenceChecklistKey: "checklist.fraud.cardpresent",
    shopifyEnumFallbacks: ["FRAUDULENT", "UNRECOGNIZED"],
    introducedDate: "2015-10",
    notes: "Card-present focused; rare for Shopify CNP merchants.",
  },
  {
    code: "10.2",
    network: "visa",
    family: "fraud",
    shortName: "EMV Liability Shift Non-Counterfeit Fraud",
    description:
      "Lost/stolen card used in a card-present transaction with magstripe fallback.",
    i18nKey: "code.visa.10-2",
    rebuttalTemplateKey: "rebuttal.family.fraud",
    evidenceChecklistKey: "checklist.fraud.cardpresent",
    shopifyEnumFallbacks: ["FRAUDULENT", "UNRECOGNIZED"],
    introducedDate: "2015-10",
  },
  {
    code: "10.3",
    network: "visa",
    family: "fraud",
    shortName: "Other Fraud — Card Present",
    description: "Cardholder claims a card-present transaction was fraudulent.",
    i18nKey: "code.visa.10-3",
    rebuttalTemplateKey: "rebuttal.family.fraud",
    evidenceChecklistKey: "checklist.fraud.cardpresent",
    shopifyEnumFallbacks: ["FRAUDULENT", "UNRECOGNIZED"],
    introducedDate: "2018-04",
  },
  {
    code: "10.4",
    network: "visa",
    family: "ce30_eligible",
    shortName: "Other Fraud — Card-Absent Environment",
    description:
      "Cardholder claims a card-absent (CNP) transaction was fraudulent. Eligible for Visa Compelling Evidence 3.0 with 2 prior undisputed transactions in the 120–365 day window + 2 matching data points (IP/device anchor required).",
    i18nKey: "code.visa.10-4",
    rebuttalTemplateKey: "rebuttal.visa.10-4.ce30",
    evidenceChecklistKey: "checklist.ce30",
    shopifyEnumFallbacks: ["FRAUDULENT", "UNRECOGNIZED"],
    introducedDate: "2018-04",
    notes:
      "CE 3.0 anchor — see lib/liabilityShift/qualifyCE30.ts (LSE-1) and docs/epics/EPIC-LSE-1-qualification-engine.md.",
  },
  {
    code: "10.5",
    network: "visa",
    family: "fraud",
    shortName: "Visa Fraud Monitoring Program",
    description:
      "Merchant was identified in the Visa Fraud Monitoring Program; representment options are constrained.",
    i18nKey: "code.visa.10-5",
    rebuttalTemplateKey: "rebuttal.family.fraud",
    evidenceChecklistKey: "checklist.fraud.programmed",
    shopifyEnumFallbacks: ["FRAUDULENT"],
    introducedDate: "2018-04",
  },
  {
    code: "11.1",
    network: "visa",
    family: "authorization",
    shortName: "Card Recovery Bulletin",
    description:
      "Authorization was obtained but the card was listed on the Card Recovery Bulletin.",
    i18nKey: "code.visa.11-1",
    rebuttalTemplateKey: "rebuttal.family.authorization",
    evidenceChecklistKey: "checklist.authorization",
    shopifyEnumFallbacks: ["BANK_CANNOT_PROCESS", "GENERAL"],
    introducedDate: "2018-04",
  },
  {
    code: "11.2",
    network: "visa",
    family: "authorization",
    shortName: "Declined Authorization",
    description:
      "Merchant submitted the transaction after receiving a decline response.",
    i18nKey: "code.visa.11-2",
    rebuttalTemplateKey: "rebuttal.family.authorization",
    evidenceChecklistKey: "checklist.authorization",
    shopifyEnumFallbacks: ["BANK_CANNOT_PROCESS", "DEBIT_NOT_AUTHORIZED"],
    introducedDate: "2018-04",
  },
  {
    code: "11.3",
    network: "visa",
    family: "authorization",
    shortName: "No Authorization",
    description: "Transaction was not authorized.",
    i18nKey: "code.visa.11-3",
    rebuttalTemplateKey: "rebuttal.family.authorization",
    evidenceChecklistKey: "checklist.authorization",
    shopifyEnumFallbacks: ["BANK_CANNOT_PROCESS", "DEBIT_NOT_AUTHORIZED"],
    introducedDate: "2018-04",
  },
  {
    code: "12.1",
    network: "visa",
    family: "processing_error",
    shortName: "Late Presentment",
    description:
      "Transaction was presented to the issuer after the allowable timeframe.",
    i18nKey: "code.visa.12-1",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["BANK_CANNOT_PROCESS", "GENERAL"],
    introducedDate: "2018-04",
  },
  {
    code: "12.2",
    network: "visa",
    family: "processing_error",
    shortName: "Incorrect Transaction Code",
    description: "Transaction code was incorrect.",
    i18nKey: "code.visa.12-2",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["INCORRECT_ACCOUNT_DETAILS", "GENERAL"],
    introducedDate: "2018-04",
  },
  {
    code: "12.3",
    network: "visa",
    family: "processing_error",
    shortName: "Incorrect Currency",
    description: "Transaction was processed in the wrong currency.",
    i18nKey: "code.visa.12-3",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["GENERAL"],
    introducedDate: "2018-04",
  },
  {
    code: "12.4",
    network: "visa",
    family: "processing_error",
    shortName: "Incorrect Account Number",
    description: "Transaction was processed against the wrong account number.",
    i18nKey: "code.visa.12-4",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["INCORRECT_ACCOUNT_DETAILS"],
    introducedDate: "2018-04",
  },
  {
    code: "12.5",
    network: "visa",
    family: "processing_error",
    shortName: "Incorrect Amount",
    description:
      "Transaction amount differs from the amount on the cardholder's receipt.",
    i18nKey: "code.visa.12-5",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["GENERAL", "DUPLICATE"],
    introducedDate: "2018-04",
  },
  {
    code: "12.6",
    network: "visa",
    family: "processing_error",
    shortName: "Duplicate Processing or Paid by Other Means",
    description:
      "Same transaction was processed more than once, or cardholder paid by other means.",
    i18nKey: "code.visa.12-6",
    rebuttalTemplateKey: "rebuttal.visa.12-6.duplicate",
    evidenceChecklistKey: "checklist.duplicate",
    shopifyEnumFallbacks: ["DUPLICATE", "CREDIT_NOT_PROCESSED"],
    introducedDate: "2018-04",
  },
  {
    code: "12.7",
    network: "visa",
    family: "processing_error",
    shortName: "Invalid Data",
    description: "Transaction contained invalid or incorrect data.",
    i18nKey: "code.visa.12-7",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["GENERAL", "NONCOMPLIANT"],
    introducedDate: "2018-04",
  },
  {
    code: "13.1",
    network: "visa",
    family: "consumer_dispute",
    shortName: "Merchandise/Services Not Received",
    description:
      "Cardholder claims merchandise or services were not received by the expected date or location.",
    i18nKey: "code.visa.13-1",
    rebuttalTemplateKey: "rebuttal.visa.13-1.not-received",
    evidenceChecklistKey: "checklist.product-not-received",
    shopifyEnumFallbacks: ["PRODUCT_NOT_RECEIVED"],
    introducedDate: "2018-04",
  },
  {
    code: "13.2",
    network: "visa",
    family: "consumer_dispute",
    shortName: "Cancelled Recurring",
    description:
      "Cardholder claims a recurring transaction was processed after cancellation.",
    i18nKey: "code.visa.13-2",
    rebuttalTemplateKey: "rebuttal.visa.13-2.cancelled-recurring",
    evidenceChecklistKey: "checklist.subscription",
    shopifyEnumFallbacks: ["SUBSCRIPTION_CANCELED"],
    introducedDate: "2018-04",
  },
  {
    code: "13.3",
    network: "visa",
    family: "consumer_dispute",
    shortName: "Not as Described or Defective Merchandise/Services",
    description:
      "Cardholder claims the merchandise or service was not as described, was defective, or was damaged.",
    i18nKey: "code.visa.13-3",
    rebuttalTemplateKey: "rebuttal.visa.13-3.not-as-described",
    evidenceChecklistKey: "checklist.not-as-described",
    shopifyEnumFallbacks: ["PRODUCT_UNACCEPTABLE"],
    introducedDate: "2018-04",
  },
  {
    code: "13.4",
    network: "visa",
    family: "consumer_dispute",
    shortName: "Counterfeit Merchandise",
    description: "Cardholder claims merchandise was counterfeit.",
    i18nKey: "code.visa.13-4",
    rebuttalTemplateKey: "rebuttal.visa.13-4.counterfeit",
    evidenceChecklistKey: "checklist.counterfeit",
    shopifyEnumFallbacks: ["PRODUCT_UNACCEPTABLE"],
    introducedDate: "2018-04",
  },
  {
    code: "13.5",
    network: "visa",
    family: "consumer_dispute",
    shortName: "Misrepresentation",
    description: "Cardholder claims the merchandise or service was misrepresented.",
    i18nKey: "code.visa.13-5",
    rebuttalTemplateKey: "rebuttal.visa.13-5.misrepresentation",
    evidenceChecklistKey: "checklist.not-as-described",
    shopifyEnumFallbacks: ["PRODUCT_UNACCEPTABLE", "GENERAL"],
    introducedDate: "2018-04",
  },
  {
    code: "13.6",
    network: "visa",
    family: "consumer_dispute",
    shortName: "Credit Not Processed",
    description:
      "Cardholder claims a credit/refund was promised but not processed.",
    i18nKey: "code.visa.13-6",
    rebuttalTemplateKey: "rebuttal.visa.13-6.credit-not-processed",
    evidenceChecklistKey: "checklist.refund",
    shopifyEnumFallbacks: ["CREDIT_NOT_PROCESSED"],
    introducedDate: "2018-04",
  },
  {
    code: "13.7",
    network: "visa",
    family: "consumer_dispute",
    shortName: "Cancelled Merchandise/Services",
    description:
      "Cardholder claims cancellation but was charged or merchandise was shipped after cancellation.",
    i18nKey: "code.visa.13-7",
    rebuttalTemplateKey: "rebuttal.visa.13-7.cancelled",
    evidenceChecklistKey: "checklist.cancellation",
    shopifyEnumFallbacks: ["SUBSCRIPTION_CANCELED", "CREDIT_NOT_PROCESSED"],
    introducedDate: "2018-04",
  },
  {
    code: "13.8",
    network: "visa",
    family: "consumer_dispute",
    shortName: "Original Credit Transaction Not Accepted",
    description:
      "Recipient did not receive an Original Credit Transaction (OCT) — push payment dispute.",
    i18nKey: "code.visa.13-8",
    rebuttalTemplateKey: "rebuttal.family.consumer",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["GENERAL"],
    introducedDate: "2019-04",
  },
  {
    code: "13.9",
    network: "visa",
    family: "consumer_dispute",
    shortName: "Non-Receipt of Cash or Load Transaction Value",
    description:
      "Cardholder did not receive cash at ATM or stored-value load did not credit.",
    i18nKey: "code.visa.13-9",
    rebuttalTemplateKey: "rebuttal.family.consumer",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["GENERAL"],
    introducedDate: "2019-04",
    notes: "Rare for Shopify CNP merchants.",
  },
];

/* ── Mastercard codes ── */

const MASTERCARD_CODES: ReasonCodeEntry[] = [
  {
    code: "4807",
    network: "mastercard",
    family: "authorization",
    shortName: "Warning Bulletin File",
    description:
      "Authorization not requested for a transaction on a card listed in the Warning Bulletin.",
    i18nKey: "code.mc.4807",
    rebuttalTemplateKey: "rebuttal.family.authorization",
    evidenceChecklistKey: "checklist.authorization",
    shopifyEnumFallbacks: ["BANK_CANNOT_PROCESS", "GENERAL"],
    introducedDate: "2016-10",
  },
  {
    code: "4808",
    network: "mastercard",
    family: "authorization",
    shortName: "Authorization-Related Chargeback",
    description:
      "Transaction was not properly authorized — covers several authorization-failure subtypes.",
    i18nKey: "code.mc.4808",
    rebuttalTemplateKey: "rebuttal.family.authorization",
    evidenceChecklistKey: "checklist.authorization",
    shopifyEnumFallbacks: ["BANK_CANNOT_PROCESS", "DEBIT_NOT_AUTHORIZED"],
    introducedDate: "2016-10",
  },
  {
    code: "4812",
    network: "mastercard",
    family: "authorization",
    shortName: "Account Number Not on File",
    description: "Card number is not on file with the issuer.",
    i18nKey: "code.mc.4812",
    rebuttalTemplateKey: "rebuttal.family.authorization",
    evidenceChecklistKey: "checklist.authorization",
    shopifyEnumFallbacks: ["INCORRECT_ACCOUNT_DETAILS", "GENERAL"],
    introducedDate: "2016-10",
  },
  {
    code: "4831",
    network: "mastercard",
    family: "consumer_dispute",
    shortName: "Disputed Amount",
    description:
      "Cardholder disputes the transaction amount as different from the amount they agreed to.",
    i18nKey: "code.mc.4831",
    rebuttalTemplateKey: "rebuttal.mc.4831.disputed-amount",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["GENERAL", "DUPLICATE"],
    introducedDate: "2016-10",
  },
  {
    code: "4834",
    network: "mastercard",
    family: "processing_error",
    shortName: "Point-of-Interaction Error",
    description:
      "Various point-of-interaction processing errors — duplicate processing, late presentment, ATM disputes.",
    i18nKey: "code.mc.4834",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["DUPLICATE", "GENERAL"],
    introducedDate: "2016-10",
  },
  {
    code: "4837",
    network: "mastercard",
    family: "fpt_eligible",
    shortName: "No Cardholder Authorization",
    description:
      "Cardholder claims they did not authorize the transaction. Eligible for Mastercard First-Party Trust submission with evidence across Device, Delivery, and Identity categories.",
    i18nKey: "code.mc.4837",
    rebuttalTemplateKey: "rebuttal.mc.4837.fpt",
    evidenceChecklistKey: "checklist.fpt",
    shopifyEnumFallbacks: ["FRAUDULENT", "UNRECOGNIZED"],
    introducedDate: "2016-10",
    notes:
      "FPT-eligible — see lib/liabilityShift/qualifyFPT.ts (LSE-3) and docs/epics/EPIC-LSE-3-fpt-readiness.md.",
  },
  {
    code: "4841",
    network: "mastercard",
    family: "consumer_dispute",
    shortName: "Cancelled Recurring or Digital Goods Transactions",
    description:
      "Cardholder claims a recurring or digital-goods transaction was processed after cancellation.",
    i18nKey: "code.mc.4841",
    rebuttalTemplateKey: "rebuttal.mc.4841.cancelled-recurring",
    evidenceChecklistKey: "checklist.subscription",
    shopifyEnumFallbacks: ["SUBSCRIPTION_CANCELED"],
    introducedDate: "2016-10",
  },
  {
    code: "4842",
    network: "mastercard",
    family: "processing_error",
    shortName: "Late Presentment",
    description:
      "Transaction was presented to the issuer after the allowable timeframe.",
    i18nKey: "code.mc.4842",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["BANK_CANNOT_PROCESS", "GENERAL"],
    introducedDate: "2016-10",
  },
  {
    code: "4846",
    network: "mastercard",
    family: "processing_error",
    shortName: "Currency Errors",
    description: "Transaction was processed in the wrong currency.",
    i18nKey: "code.mc.4846",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["GENERAL"],
    introducedDate: "2016-10",
  },
  {
    code: "4849",
    network: "mastercard",
    family: "processing_error",
    shortName: "Questionable Merchant Activity",
    description:
      "Merchant identified in Mastercard's Questionable Merchant Audit Program.",
    i18nKey: "code.mc.4849",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["NONCOMPLIANT"],
    introducedDate: "2016-10",
  },
  {
    code: "4853",
    network: "mastercard",
    family: "consumer_dispute",
    shortName: "Cardholder Dispute — Defective/Not as Described",
    description:
      "Cardholder claims the merchandise or service was defective, damaged, or not as described.",
    i18nKey: "code.mc.4853",
    rebuttalTemplateKey: "rebuttal.mc.4853.not-as-described",
    evidenceChecklistKey: "checklist.not-as-described",
    shopifyEnumFallbacks: ["PRODUCT_UNACCEPTABLE", "PRODUCT_NOT_RECEIVED"],
    introducedDate: "2016-10",
    notes:
      "Broad MC reason — also used for not-received scenarios with consumer-dispute framing.",
  },
  {
    code: "4854",
    network: "mastercard",
    family: "consumer_dispute",
    shortName: "Cardholder Dispute — Not Elsewhere Classified",
    description:
      "Consumer dispute that doesn't fit the more specific 48xx categories (US-domestic only).",
    i18nKey: "code.mc.4854",
    rebuttalTemplateKey: "rebuttal.family.consumer",
    evidenceChecklistKey: "checklist.product-not-received",
    shopifyEnumFallbacks: ["GENERAL"],
    introducedDate: "2016-10",
  },
  {
    code: "4855",
    network: "mastercard",
    family: "consumer_dispute",
    shortName: "Goods or Services Not Provided",
    description: "Cardholder claims goods or services were not provided.",
    i18nKey: "code.mc.4855",
    rebuttalTemplateKey: "rebuttal.mc.4855.not-provided",
    evidenceChecklistKey: "checklist.product-not-received",
    shopifyEnumFallbacks: ["PRODUCT_NOT_RECEIVED"],
    introducedDate: "2016-10",
  },
  {
    code: "4859",
    network: "mastercard",
    family: "consumer_dispute",
    shortName: "Services Not Rendered — ATM Disputes",
    description: "ATM-related cardholder service disputes.",
    i18nKey: "code.mc.4859",
    rebuttalTemplateKey: "rebuttal.family.consumer",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["GENERAL"],
    introducedDate: "2016-10",
    notes: "Rare for Shopify CNP merchants.",
  },
  {
    code: "4860",
    network: "mastercard",
    family: "consumer_dispute",
    shortName: "Credit Not Processed",
    description: "Cardholder was promised a credit/refund that was not processed.",
    i18nKey: "code.mc.4860",
    rebuttalTemplateKey: "rebuttal.mc.4860.credit-not-processed",
    evidenceChecklistKey: "checklist.refund",
    shopifyEnumFallbacks: ["CREDIT_NOT_PROCESSED"],
    introducedDate: "2016-10",
  },
  {
    code: "4863",
    network: "mastercard",
    family: "fpt_eligible",
    shortName: "Cardholder Does Not Recognize — Potential Fraud",
    description:
      "Cardholder does not recognize the transaction but does not claim it is fraudulent (first-party fraud territory). Eligible for Mastercard First-Party Trust submission with extra emphasis on Identity evidence.",
    i18nKey: "code.mc.4863",
    rebuttalTemplateKey: "rebuttal.mc.4863.fpt",
    evidenceChecklistKey: "checklist.fpt",
    shopifyEnumFallbacks: ["FRAUDULENT", "UNRECOGNIZED"],
    introducedDate: "2016-10",
    notes:
      "FPT-eligible — see lib/liabilityShift/qualifyFPT.ts (LSE-3). Differs from 4837 in cardholder intent: 4837 is explicit denial, 4863 is 'I don't recognize this'.",
  },
  {
    code: "4870",
    network: "mastercard",
    family: "fraud",
    shortName: "Chip Liability Shift",
    description:
      "Counterfeit fraud where the issuer holds liability because the merchant did not accept a chip card on a chip-capable terminal.",
    i18nKey: "code.mc.4870",
    rebuttalTemplateKey: "rebuttal.family.fraud",
    evidenceChecklistKey: "checklist.fraud.cardpresent",
    shopifyEnumFallbacks: ["FRAUDULENT"],
    introducedDate: "2016-10",
    notes: "Card-present focused; rare for Shopify CNP merchants.",
  },
  {
    code: "4871",
    network: "mastercard",
    family: "fraud",
    shortName: "Chip Liability Shift — Lost/Stolen/Never Received",
    description:
      "Lost, stolen, or never-received-issue card used in a chip-eligible transaction without chip read.",
    i18nKey: "code.mc.4871",
    rebuttalTemplateKey: "rebuttal.family.fraud",
    evidenceChecklistKey: "checklist.fraud.cardpresent",
    shopifyEnumFallbacks: ["FRAUDULENT"],
    introducedDate: "2016-10",
  },
  {
    code: "4999",
    network: "mastercard",
    family: "processing_error",
    shortName: "Domestic Chargeback Dispute (Europe only)",
    description: "Region-specific domestic chargeback dispute code.",
    i18nKey: "code.mc.4999",
    rebuttalTemplateKey: "rebuttal.family.processing",
    evidenceChecklistKey: "checklist.processing",
    shopifyEnumFallbacks: ["GENERAL"],
    introducedDate: "2016-10",
    notes: "Europe domestic only.",
  },
];

/* ── Public catalog ── */

export const REASON_CODE_CATALOG: ReasonCodeEntry[] = [
  ...VISA_CODES,
  ...MASTERCARD_CODES,
];

const BY_KEY: Map<string, ReasonCodeEntry> = new Map(
  REASON_CODE_CATALOG.map((entry) => [
    `${entry.network}:${entry.code}`,
    entry,
  ]),
);

const BY_FAMILY: Map<ReasonCodeFamily, ReasonCodeEntry[]> = new Map();
for (const entry of REASON_CODE_CATALOG) {
  const existing = BY_FAMILY.get(entry.family) ?? [];
  existing.push(entry);
  BY_FAMILY.set(entry.family, existing);
}

/** Resolve a catalog entry by network + code. Returns null if unknown. */
export function getReasonCode(
  network: CardNetwork,
  code: string,
): ReasonCodeEntry | null {
  return BY_KEY.get(`${network}:${code}`) ?? null;
}

/** All entries for a given family. */
export function getReasonCodesByFamily(
  family: ReasonCodeFamily,
): ReasonCodeEntry[] {
  return [...(BY_FAMILY.get(family) ?? [])];
}

/** True when the code is the Visa CE 3.0 anchor (10.4). */
export function isCE30AnchorCode(
  network: CardNetwork,
  code: string,
): boolean {
  return network === "visa" && code === "10.4";
}

/** True when the code is on the Mastercard FPT-eligible list. */
export function isFPTEligibleCode(
  network: CardNetwork,
  code: string,
): boolean {
  const entry = getReasonCode(network, code);
  return !!entry && entry.family === "fpt_eligible";
}
