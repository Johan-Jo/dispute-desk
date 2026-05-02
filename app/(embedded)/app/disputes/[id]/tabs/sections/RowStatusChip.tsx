/**
 * RowStatusChip — explicit "Included as" destination indicator.
 *
 * Renders one of three deterministic destinations:
 *   - form_field    → "Form field"      (success tone)
 *   - rebuttal_text → "Rebuttal text"   (info tone)
 *   - not_included  → "Not included"    (attention tone)
 *
 * There is NO "Unknown" state. Every row in §2 of the EvidenceTab
 * resolves to a concrete destination via `deriveSubmissionDestination`
 * in useEvidenceSections.ts. Each chip carries a tooltip explaining
 * what the destination means so the merchant can map the chip to the
 * actual case structure.
 */

"use client";

import { Badge, Tooltip } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { EvidenceSubmissionDestination } from "../useEvidenceSections";

export function RowStatusChip({
  destination,
}: {
  destination: EvidenceSubmissionDestination;
}) {
  const t = useTranslations("disputes.evidenceTab.row");

  if (destination === "form_field") {
    return (
      <Tooltip
        content={t("includedAsFormFieldExplanation")}
        preferredPosition="above"
      >
        <Badge tone="success">{t("includedAsFormField")}</Badge>
      </Tooltip>
    );
  }

  if (destination === "rebuttal_text") {
    return (
      <Tooltip
        content={t("includedAsRebuttalTextExplanation")}
        preferredPosition="above"
      >
        <Badge tone="info">{t("includedAsRebuttalText")}</Badge>
      </Tooltip>
    );
  }

  // not_included
  return (
    <Tooltip
      content={t("includedAsNotIncludedExplanation")}
      preferredPosition="above"
    >
      <Badge tone="attention">{t("includedAsNotIncluded")}</Badge>
    </Tooltip>
  );
}
