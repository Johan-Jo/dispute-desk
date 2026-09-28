/**
 * Section order + titles — single source of truth for both renderers.
 *
 * Imported by:
 *   - `lib/defence/pdf/composePdfBlocks.ts`  (PDF render pipeline)
 *   - `lib/defence/pdf/DefencePackageDocument.tsx`  (PDF @react-pdf renderer)
 *   - `app/(embedded)/.../DefencePackageHtmlView.tsx`  (embedded HTML view)
 *
 * Before this module existed each renderer had its own copy of
 * SECTION_ORDER and the title map. They agreed by careful manual
 * sync; the duplication made re-ordering or renaming risky.
 *
 * Pure constants — zero runtime cost, safe to import from both server
 * (PDF build job) and client ("use client" HTML view) contexts.
 */

import type { EvidenceFact, NarrativeSectionKey } from "../types";

/**
 * Canonical section order. Both renderers MUST walk sections in this
 * order. Changing the order here changes the order on both the PDF
 * the bank receives AND the embedded HTML preview the merchant sees.
 */
export const SECTION_ORDER: NarrativeSectionKey[] = [
  "executiveSummary",
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
  "conclusion",
];

/**
 * Human-readable section headings. Used as the H3 / heading text in
 * both renderers. Changes here propagate to both surfaces — no
 * separate per-renderer copy.
 */
export const SECTION_TITLES: Record<NarrativeSectionKey, string> = {
  executiveSummary: "Executive Summary",
  transactionOverviewArgument: "Transaction Overview",
  chronologyArgument: "Chronology of Events",
  paymentAuthenticationArgument: "Payment Authentication",
  fulfillmentArgument: "Shipping & Delivery",
  communicationArgument: "Customer Communication",
  policyArgument: "Policy Disclosure",
  manualEvidenceArgument: "Supplementary Merchant Evidence",
  conclusion: "Conclusion",
};

/**
 * The heading for a section on THIS case. "Shipping & Delivery" for goods
 * (review of #352543: "Access" is noise on a parcel); "Delivery & Access"
 * when the case's evidence is a digital-access or service record.
 */
export function sectionTitleFor(key: NarrativeSectionKey, facts: readonly EvidenceFact[]): string {
  if (
    key === "fulfillmentArgument" &&
    facts.some((f) => f.category === "digital_access_log" || f.category === "service_access")
  ) {
    return "Delivery & Access";
  }
  return SECTION_TITLES[key];
}
