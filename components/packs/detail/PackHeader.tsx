"use client";

import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  ProgressBar,
  Banner,
  Spinner,
} from "@shopify/polaris";
import type { SubmissionReadiness } from "@/lib/types/evidenceItem";

interface PackHeaderProps {
  status: string;
  score: number;
  readiness: SubmissionReadiness;
  warningCount: number;
  blockerCount: number;
  isBuilding: boolean;
  savedAt: string | null;
  saveFailed: boolean;
  disputeUrl: string | null;
  disputePhase: string | null;
  deadline: string | null;
  onScrollToBuilder: () => void;
  onSave: () => void;
  saving: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PackHeader({
  status,
  score,
  readiness,
  warningCount,
  blockerCount,
  isBuilding,
  savedAt,
  saveFailed,
  disputeUrl,
  disputePhase,
  deadline,
  onScrollToBuilder,
  onSave,
  saving,
}: PackHeaderProps) {
  const isSaved = status === "saved_to_shopify" || readiness === "submitted";
  const isSaving = status === "saving" || saving;

  // Deadline urgency
  let deadlineUrgent = false;
  let deadlineText: string | null = null;
  if (deadline && disputePhase === "chargeback") {
    const hoursLeft =
      (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursLeft < 48 && hoursLeft > 0) {
      deadlineUrgent = true;
      deadlineText = `Deadline approaching \u2014 respond by ${formatDate(deadline)}`;
    } else if (hoursLeft > 0) {
      deadlineText = `Respond by ${formatDate(deadline)}`;
    }
  }

  // Determine state message and CTA
  // Submit actions live in the sidebar and page-level primary action only.
  // This header shows status + non-submit CTAs (scroll to builder, open in Shopify).
  let statusMessage: string;
  let cta: { label: string; action: () => void; disabled?: boolean } | null =
    null;

  if (isBuilding) {
    statusMessage = "Building evidence pack...";
  } else if (isSaved) {
    statusMessage = `Submitted to Shopify on ${formatDate(savedAt)}`;
    if (disputeUrl) {
      cta = {
        label: "Open in Shopify Admin",
        action: () => window.open(disputeUrl, "_blank"),
      };
    }
  } else if (saveFailed) {
    statusMessage = "Save failed \u2014 try again";
  } else if (readiness === "blocked" && blockerCount > 0) {
    statusMessage = `Submission blocked \u2014 ${blockerCount} required ${blockerCount === 1 ? "item" : "items"} missing`;
    cta = { label: "Add required evidence", action: onScrollToBuilder };
  } else if (readiness === "ready_with_warnings" && warningCount > 0) {
    statusMessage = `Ready to submit \u2014 ${warningCount} high-impact ${warningCount === 1 ? "item" : "items"} could strengthen your case`;
  } else {
    statusMessage = "Ready to submit";
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" wrap>
          <BlockStack gap="100">
            <Text as="h2" variant="headingLg">
              {statusMessage}
            </Text>
          </BlockStack>

          {cta && !isBuilding && (
            <Button
              variant="primary"
              onClick={cta.action}
              disabled={cta.disabled}
              loading={isSaving && cta.label !== "Add required evidence" && cta.label !== "Open in Shopify Admin"}
            >
              {cta.label}
            </Button>
          )}
          {isBuilding && <Spinner size="small" />}
        </InlineStack>

        {!isSaved && !isBuilding && (
          <ProgressBar
            progress={score}
            tone={score >= 80 ? "success" : "critical"}
            size="small"
          />
        )}

        {deadlineText && (
          <Banner tone={deadlineUrgent ? "critical" : "warning"} hideIcon>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {deadlineText}
            </Text>
          </Banner>
        )}

        {isSaved && (
          <Banner tone="success" hideIcon>
            <Text as="p" variant="bodySm">
              Evidence submitted successfully
            </Text>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}
