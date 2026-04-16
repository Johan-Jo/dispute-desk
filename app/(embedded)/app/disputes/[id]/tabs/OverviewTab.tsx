"use client";

import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import styles from "../workspace.module.css";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

export default function OverviewTab({ workspace }: { workspace: Workspace }) {
  const { data, derived, actions } = workspace;
  if (!data) return null;

  const { dispute, caseTypeInfo } = data;
  const { caseStrength, nextAction, missingItems, readiness, warningCount } = derived;

  const completeness = data.pack?.completenessScore ?? 0;

  // Deadline
  const deadlineDays = dispute.dueAt
    ? Math.ceil((new Date(dispute.dueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const deadlineUrgent = deadlineDays !== null && deadlineDays <= 2;

  return (
    <BlockStack gap="400">
      {/* 1. Case Type Header */}
      <div className={styles.caseTypeHeader}>
        <BlockStack gap="300">
          <Text as="h2" variant="headingLg">
            {caseTypeInfo.disputeType}
          </Text>

          <BlockStack gap="100">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              Your best available defense:
            </Text>
            <ul className={styles.toWinList}>
              {caseTypeInfo.toWin.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </BlockStack>

          <BlockStack gap="100">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              Best available evidence in this case:
            </Text>
            <div className={styles.strongestEvidence}>
              {caseTypeInfo.strongestEvidence.map((item, i) => (
                <span key={i} className={styles.evidenceBadge}>
                  {item}
                </span>
              ))}
            </div>
          </BlockStack>
        </BlockStack>
      </div>

      {/* 2. Status + Deadline + CTA */}
      <Card>
        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Badge
                tone={
                  readiness === "ready" ? "success" :
                  readiness === "ready_with_warnings" ? "warning" :
                  readiness === "blocked" ? "critical" :
                  readiness === "submitted" ? "info" :
                  undefined
                }
              >
                {readiness === "ready" ? "Ready" :
                 readiness === "ready_with_warnings" ? "Ready with warnings" :
                 readiness === "blocked" ? "Blocked" :
                 readiness === "submitted" ? "Submitted" :
                 dispute.normalizedStatus}
              </Badge>
              {deadlineDays !== null && deadlineDays > 0 && (
                <Text as="span" variant="bodySm" tone={deadlineUrgent ? "critical" : "subdued"}>
                  {deadlineUrgent
                    ? `Deadline approaching \u2014 ${deadlineDays} ${deadlineDays === 1 ? "day" : "days"} left`
                    : `${deadlineDays} days to respond`}
                </Text>
              )}
            </InlineStack>
          </BlockStack>

          {nextAction.severity !== "info" || nextAction.targetTab !== undefined ? (
            <Button
              variant="primary"
              onClick={() => {
                if (nextAction.targetTab !== undefined) {
                  actions.setActiveTab(nextAction.targetTab);
                  if (nextAction.targetField) {
                    actions.navigateToEvidence(nextAction.targetField);
                  }
                }
              }}
            >
              {nextAction.label}
            </Button>
          ) : null}
        </InlineStack>
      </Card>

      {/* 3. Next Action Panel */}
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h3" variant="headingMd">
              Next step
            </Text>
            <Badge
              tone={
                nextAction.severity === "critical" ? "critical" :
                nextAction.severity === "warning" ? "warning" :
                "info"
              }
            >
              {nextAction.severity === "critical" ? "Action needed" :
               nextAction.severity === "warning" ? "Recommended" :
               "Info"}
            </Badge>
          </InlineStack>
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {nextAction.label}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {nextAction.description}
          </Text>
        </BlockStack>
      </Card>

      {/* 4. Case Summary */}
      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">Case summary</Text>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <Text as="p" variant="bodySm" tone="subdued">Order</Text>
              <Text as="p" variant="bodyMd">{dispute.orderName || "\u2014"}</Text>
            </div>
            <div>
              <Text as="p" variant="bodySm" tone="subdued">Amount</Text>
              <Text as="p" variant="bodyMd">{dispute.currency} {dispute.amount}</Text>
            </div>
            <div>
              <Text as="p" variant="bodySm" tone="subdued">Customer</Text>
              <Text as="p" variant="bodyMd">{dispute.customerName || "\u2014"}</Text>
            </div>
            <div>
              <Text as="p" variant="bodySm" tone="subdued">Reason</Text>
              <Text as="p" variant="bodyMd">{dispute.reason ?? "\u2014"}</Text>
            </div>
          </div>
        </BlockStack>
      </Card>

      {/* 5. Case Strength */}
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">Win likelihood based on current data</Text>
            <Badge
              tone={
                caseStrength.overall === "strong" ? "success" :
                caseStrength.overall === "moderate" ? "warning" :
                "critical"
              }
            >
              {caseStrength.overall.charAt(0).toUpperCase() + caseStrength.overall.slice(1)}
            </Badge>
          </InlineStack>
          {caseStrength.totalClaims > 0 && (
            <Text as="p" variant="bodySm" tone="subdued">
              {caseStrength.supportedClaims} of {caseStrength.totalClaims} claims supported
            </Text>
          )}
          {caseStrength.improvementHint && (
            <Banner tone="info" hideIcon>
              <Text as="p" variant="bodySm">{caseStrength.improvementHint}</Text>
            </Banner>
          )}
        </BlockStack>
      </Card>

      {/* 6. Evidence Completeness */}
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">Evidence completeness</Text>
            <Text as="span" variant="headingMd">{completeness}%</Text>
          </InlineStack>
          <ProgressBar
            progress={completeness}
            tone={completeness >= 80 ? "success" : completeness >= 40 ? "highlight" : "critical"}
            size="small"
          />
          {derived.categories.length > 0 && (
            <InlineStack gap="200" wrap>
              {derived.categories.map((cat) => {
                const allAvailable = cat.items.every((i) => i.status === "available" || i.status === "waived");
                const someMissing = cat.items.some((i) => i.status === "missing");
                return (
                  <Badge
                    key={cat.category.key}
                    tone={allAvailable ? "success" : someMissing ? "warning" : undefined}
                  >
                    {`${allAvailable ? "\u2713" : someMissing ? "\u26a0" : "\u2717"} ${cat.category.label}`}
                  </Badge>
                );
              })}
            </InlineStack>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
