/**
 * EvidenceRow — per-item row used by EvidenceUsedSection.
 *
 * Layout:
 *   [title + attachment badge] [Strength · Package status · Bank argument status]
 *   <one-line reason>
 *   <"Why this matters" descriptor>
 *
 * The three structured status indicators are gated on EvidenceLineItem
 * booleans, NOT on the legacy `strength` field:
 *
 *   1. Strength contribution (Strong / Moderate / Supporting / Internal only / None)
 *   2. Package status — gated on `includedInDefencePackage`
 *   3. Bank argument status — gated on `usedAsPositiveBankEvidence` /
 *      `includedInBankArgument` / `includedInDefencePackage`
 *
 * When `lineItem` is undefined (transient render window before the
 * workspace API returns), the row falls back to the legacy single-badge
 * layout via `whyThisMatters`.
 */

"use client";

import { BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type {
  EvidenceRowViewModel,
  EvidenceSource,
} from "../useEvidenceSections";
import type { EvidenceLineItem } from "@/lib/argument/evidenceLineItem";

function sourceLabel(
  source: EvidenceSource,
  t: ReturnType<typeof useTranslations>,
): string {
  if (source === "shopify") return t("sourceShopify");
  if (source === "merchant") return t("sourceMerchant");
  return t("sourceDerived");
}

const TARGET_FIELD_LABEL: Record<string, string> = {
  shippingDocumentationFile: "Shipping documentation",
  customerCommunicationFile: "Customer communication",
  serviceDocumentationFile: "Proof of service",
  refundPolicyFile: "Refund policy",
  cancellationPolicyFile: "Cancellation policy",
  uncategorizedFile: "Other evidence",
};

/** Strength badge tone map. */
function strengthBadgeTone(
  strength: EvidenceLineItem["strengthContribution"],
): { tone?: "success" | "warning" | "attention"; label: string } {
  switch (strength) {
    case "strong":
      return { tone: "success", label: "Strong" };
    case "moderate":
      return { tone: "warning", label: "Moderate" };
    case "supporting":
      return { label: "Supporting" };
    case "internal_only":
      return { tone: "attention", label: "Internal only" };
    default:
      return { label: "None" };
  }
}

/** Package status label key — gates on the boolean, falls back to the
 *  submissionMethod-specific reason when not in the package. */
function packageStatusKey(li: EvidenceLineItem): string {
  if (li.includedInDefencePackage) return "included";
  // Surface the WHY when the row is NOT in the package.
  switch (li.submissionMethod) {
    case "internal_only":
      return "internal_only";
    case "excluded":
      return "excluded";
    case "waived":
      return "waived";
    case "failed_upload":
      return "failed_upload";
    case "not_supported":
      return "not_supported";
    default:
      return "not_included";
  }
}

/** Bank argument status label key. */
function bankArgumentStatusKey(li: EvidenceLineItem): string {
  if (li.usedAsPositiveBankEvidence) return "used";
  // Row is in the package but not a positive argument → context only.
  if (li.includedInDefencePackage) return "context_only";
  return "not_used";
}

export function EvidenceRow({
  item,
  lineItem,
}: {
  item: EvidenceRowViewModel;
  lineItem?: EvidenceLineItem;
}) {
  const t = useTranslations("disputes.evidenceTab.row");

  const strength = lineItem
    ? strengthBadgeTone(lineItem.strengthContribution)
    : strengthBadgeTone(
        // Legacy fallback when the workspace API hasn't yet returned
        // evidenceLineItems. Map the legacy ItemStrength → contribution
        // values so the badge is still informative.
        item.strength === "supporting"
          ? "supporting"
          : item.strength === "moderate"
            ? "moderate"
            : "strong",
      );
  const packageKey = lineItem ? packageStatusKey(lineItem) : null;
  const bankKey = lineItem ? bankArgumentStatusKey(lineItem) : null;

  // Map package-status key to a Polaris badge tone. `included` is the
  // success state; everything else is neutral except `failed_upload`
  // which is critical and `internal_only` which is informational.
  const packageTone: "success" | "attention" | "critical" | undefined = (() => {
    if (packageKey === "included") return "success";
    if (packageKey === "failed_upload") return "critical";
    if (packageKey === "internal_only") return "attention";
    return undefined;
  })();

  return (
    <BlockStack gap="100">
      <InlineStack
        align="space-between"
        blockAlign="start"
        gap="300"
        wrap
      >
        <InlineStack gap="200" blockAlign="center" wrap>
          <Text as="h4" variant="headingSm">
            {item.title}
          </Text>
          {item.nativeAttachment ? (
            <Badge tone="success">
              {`📎 Attached to ${
                TARGET_FIELD_LABEL[item.nativeAttachment.targetField] ??
                item.nativeAttachment.targetField
              }`}
            </Badge>
          ) : null}
        </InlineStack>
        <InlineStack gap="200" blockAlign="center" wrap>
          <Badge tone={strength.tone}>{strength.label}</Badge>
          {packageKey ? (
            <Badge tone={packageTone}>{t(`packageStatus.${packageKey}`)}</Badge>
          ) : null}
          {bankKey ? (
            <Badge tone={bankKey === "used" ? "success" : undefined}>
              {t(`bankArgumentStatus.${bankKey}`)}
            </Badge>
          ) : null}
        </InlineStack>
      </InlineStack>

      {/* One-line reason from the line item — explains WHY this row is
          in its current state. Falls back to whyThisMatters when no
          line item is available (legacy path). */}
      <Text as="p" variant="bodySm">
        {lineItem?.reason ?? item.whyThisMatters}
      </Text>

      {/* Source descriptor (kept compact). */}
      <Text as="span" variant="bodyXs" tone="subdued">
        {`${t("source")} · ${sourceLabel(item.source, t)}`}
      </Text>
    </BlockStack>
  );
}
