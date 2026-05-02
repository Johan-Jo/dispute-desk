/**
 * CaseSummaryCard — Section 1 of EvidenceTab.
 *
 * Renders the merchant-facing case state in a single card:
 *   - Case strength chip   (Strong | Moderate | Weak — pack.overall verbatim)
 *   - Status chip          (Submitted | Needs attention | In progress)
 *   - Automation chip      (Automatic | Review required)
 *   - Next step line       (one of four fixed sentences)
 *
 * NO percentages. NO progress bars. NO predictive copy.
 */

"use client";

import { Card, BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type {
  CaseSummaryViewModel,
  CaseStatus,
  AutomationMode,
  NextStep,
} from "../useEvidenceSections";
import type { CaseStrengthLevel } from "@/lib/argument/types";

/**
 * Display-time mapping of the raw backend strength level to the
 * three merchant-facing labels (Strong / Moderate / Weak). The
 * backend value is never mutated; "insufficient" is rendered as
 * "Weak" only at this presentation layer.
 */
type DisplayStrength = "strong" | "moderate" | "weak";

function toDisplayStrength(level: CaseStrengthLevel): DisplayStrength {
  if (level === "strong") return "strong";
  if (level === "moderate") return "moderate";
  // Both "weak" and "insufficient" surface as "Weak" at the
  // merchant-facing categorical layer per the approved plan.
  return "weak";
}

function strengthTone(
  strength: DisplayStrength,
): "success" | "attention" | "warning" {
  if (strength === "strong") return "success";
  if (strength === "moderate") return "attention";
  return "warning";
}

function statusTone(status: CaseStatus): "success" | "attention" | "info" {
  if (status === "submitted") return "success";
  if (status === "needs_attention") return "attention";
  return "info";
}

function automationTone(mode: AutomationMode): "info" | "attention" {
  return mode === "automatic" ? "info" : "attention";
}

function nextStepCopy(
  step: NextStep,
  t: ReturnType<typeof useTranslations>,
): string {
  if (step.kind === "ready_no_action") return t("readyNoAction");
  if (step.kind === "submit_now") return t("submitNow");
  if (step.kind === "submitted_no_action") return t("submittedNoAction");
  return t("reviewMissing");
}

export function CaseSummaryCard(props: CaseSummaryViewModel) {
  const t = useTranslations("disputes.evidenceTab.sections.summary");
  const tStrength = useTranslations("disputes.caseStrength");
  const tStatus = useTranslations("disputes.evidenceTab.sections.summary.status");
  const tAuto = useTranslations(
    "disputes.evidenceTab.sections.summary.automationMode",
  );
  const tNext = useTranslations("disputes.evidenceTab.sections.summary.nextStep");
  const tAutoCopy = useTranslations("disputes.evidenceTab.automation");

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {t("title")}
        </Text>

        <InlineStack gap="200" wrap>
          <InlineStack gap="100" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("strengthLabel")}:
            </Text>
            {(() => {
              const display = toDisplayStrength(props.strength);
              return (
                <Badge tone={strengthTone(display)}>
                  {tStrength(display)}
                </Badge>
              );
            })()}
          </InlineStack>

          <InlineStack gap="100" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("statusLabel")}:
            </Text>
            <Badge tone={statusTone(props.status)}>
              {tStatus(props.status)}
            </Badge>
          </InlineStack>

          <InlineStack gap="100" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              {t("automationLabel")}:
            </Text>
            <Badge tone={automationTone(props.automationMode)}>
              {tAuto(props.automationMode)}
            </Badge>
          </InlineStack>
        </InlineStack>

        <BlockStack gap="050">
          <Text as="span" variant="bodySm" tone="subdued">
            {t("nextStepLabel")}
          </Text>
          <Text as="p" variant="bodyMd">
            {nextStepCopy(props.nextStep, tNext)}
          </Text>
        </BlockStack>

        <Text as="p" variant="bodySm" tone="subdued">
          {props.automationMode === "automatic"
            ? tAutoCopy("automatic")
            : tAutoCopy("reviewRequired")}
        </Text>
      </BlockStack>
    </Card>
  );
}
