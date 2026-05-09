/**
 * CaseSummaryCard — Section 1 of EvidenceTab.
 *
 * Hero layout: the strength badge is the dominant visual element, with
 * Status + Automation pushed to the right of the same row. The "Next
 * step" sentence reads as a standalone subtitle. Why-this-strength and
 * What-would-make-it-stronger collapse into one labelled region.
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

type DisplayStrength = "strong" | "moderate" | "weak";

function toDisplayStrength(level: CaseStrengthLevel): DisplayStrength {
  if (level === "strong") return "strong";
  if (level === "moderate") return "moderate";
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

  const display = toDisplayStrength(props.strength);
  const showExplanation =
    props.strength !== "strong" &&
    (Boolean(props.strengthReason) || Boolean(props.improvementHint));

  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="200">
          <Text as="span" variant="bodySm" tone="subdued">
            {t("title")}
          </Text>
          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={strengthTone(display)} size="large">
                {tStrength(display)}
              </Badge>
              <Text as="h2" variant="headingMd">
                {nextStepCopy(props.nextStep, tNext)}
              </Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center" wrap>
              <InlineStack gap="100" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("statusLabel")}
                </Text>
                <Badge tone={statusTone(props.status)}>
                  {tStatus(props.status)}
                </Badge>
              </InlineStack>
              <InlineStack gap="100" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("automationLabel")}
                </Text>
                <Badge tone={automationTone(props.automationMode)}>
                  {tAuto(props.automationMode)}
                </Badge>
              </InlineStack>
            </InlineStack>
          </InlineStack>
        </BlockStack>

        {showExplanation ? (
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              {t("whyLabel")}
            </Text>
            {props.strengthReason ? (
              <Text as="p" variant="bodyMd">
                {props.strengthReason}
              </Text>
            ) : null}
            {props.improvementHint ? (
              <BlockStack gap="050">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("improveLabel")}
                </Text>
                <Text as="p" variant="bodyMd">
                  {props.improvementHint}
                </Text>
              </BlockStack>
            ) : null}
          </BlockStack>
        ) : null}

        <Text as="p" variant="bodySm" tone="subdued">
          {props.automationMode === "automatic"
            ? tAutoCopy("automatic")
            : tAutoCopy("reviewRequired")}
        </Text>
      </BlockStack>
    </Card>
  );
}
