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

interface PackHeaderProps {
  status: string;
  score: number;
  missingRequiredCount: number;
  allRequiredDone: boolean;
  isBuilding: boolean;
  savedAt: string | null;
  saveFailed: boolean;
  disputeUrl: string | null;
  disputePhase: string | null;
  /** ISO deadline date string, if available. */
  deadline: string | null;
  onScrollToBuilder: () => void;
  onSave: () => void;
  saving: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
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
  missingRequiredCount,
  allRequiredDone,
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
  const isSaved = status === "saved_to_shopify";
  const isSaving = status === "saving" || saving;

  // Deadline urgency
  let deadlineUrgent = false;
  let deadlineText: string | null = null;
  if (deadline && disputePhase === "chargeback") {
    const hoursLeft =
      (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursLeft < 48 && hoursLeft > 0) {
      deadlineUrgent = true;
      deadlineText = `Deadline approaching — respond by ${formatDate(deadline)}`;
    } else if (hoursLeft > 0) {
      deadlineText = `Respond by ${formatDate(deadline)}`;
    }
  }

  // Determine state
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
    statusMessage = "Save failed — try again";
    cta = { label: "Retry submission", action: onSave };
  } else if (!allRequiredDone && missingRequiredCount > 0) {
    statusMessage = `Submission blocked — ${missingRequiredCount} required ${missingRequiredCount === 1 ? "item" : "items"} missing`;
    cta = { label: "Add required evidence", action: onScrollToBuilder };
  } else if (allRequiredDone) {
    statusMessage = missingRequiredCount === 0 && score === 0
      ? "Everything is already included"
      : "Ready to submit";
    cta = {
      label: "Submit to Shopify",
      action: onSave,
      disabled: isSaving,
    };
  } else {
    statusMessage = "Everything is already included";
    cta = { label: "Submit to Shopify", action: onSave };
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
              loading={isSaving && cta.label === "Submit to Shopify"}
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
