/**
 * RowStatusChip — explicit "Submitted to Shopify" indicator.
 *
 * Renders one of four states. Three of them are the row-level submission
 * tristate that the hook emits (`yes` / `no` / `unknown`); the fourth
 * (`internal_only`) is reserved for §4 on EvidenceTab where the chip
 * affirms the row is intentionally not transmitted.
 *
 * `unknown` is a first-class state — it appears whenever the
 * evidence-field-to-Shopify-field mapping is ambiguous and the hook
 * refuses to claim "Yes" without proof. The chip is wrapped in a
 * Polaris Tooltip with explanatory copy so the merchant always knows
 * WHY they're seeing "Unknown" instead of being left with unexplained
 * uncertainty.
 */

"use client";

import { Badge, Tooltip } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { RowSubmissionStatus } from "../useEvidenceSections";

export type RowStatus = RowSubmissionStatus | "internal_only";

export function RowStatusChip({ status }: { status: RowStatus }) {
  const t = useTranslations("disputes.evidenceTab.row");

  if (status === "yes") {
    return <Badge tone="success">{t("submittedYes")}</Badge>;
  }
  if (status === "no") {
    return <Badge tone="attention">{t("submittedNo")}</Badge>;
  }
  if (status === "unknown") {
    // Tooltip explains why we're not claiming Yes/No, instead of leaving
    // the merchant guessing. The Badge itself remains the visual anchor;
    // the tooltip surfaces on hover/focus (desktop + keyboard) and on
    // tap (touch — Shopify Admin embedded mobile).
    return (
      <Tooltip
        content={t("submittedUnknownExplanation")}
        preferredPosition="above"
      >
        <Badge tone="info">{t("submittedUnknown")}</Badge>
      </Tooltip>
    );
  }
  // internal_only — explicit, not a fallback. Distinct tone so the
  // merchant cannot confuse it with the submitted/not-submitted axis.
  return <Badge tone="info">{t("submittedNo")}</Badge>;
}
