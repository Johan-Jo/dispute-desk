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
} from "@shopify/polaris";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import styles from "../workspace.module.css";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/** Map internal strength to merchant-facing label. */
function strengthLabel(s: string): string {
  if (s === "strong") return "Strong";
  if (s === "moderate") return "Medium";
  return "Weak";
}

export default function OverviewTab({ workspace }: { workspace: Workspace }) {
  const { data, derived, actions, clientState } = workspace;
  if (!data) return null;

  const { dispute, caseTypeInfo, argumentMap } = data;
  const { caseStrength, nextAction, missingItems, effectiveChecklist, categories } = derived;

  // Deadline
  const deadlineDays = dispute.dueAt
    ? Math.ceil((new Date(dispute.dueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const deadlineUrgent = deadlineDays !== null && deadlineDays <= 2;

  // Defense position (derived from evidence)
  const hasAvs = effectiveChecklist.some(c => c.field === "avs_cvv_match" && c.status === "available");
  const hasCvv = hasAvs; // same field
  const hasOrder = effectiveChecklist.some(c => c.field === "order_confirmation" && c.status === "available");
  const hasDelivery = effectiveChecklist.some(c => c.field === "delivery_proof" && c.status === "available");
  const hasTracking = effectiveChecklist.some(c => c.field === "shipping_tracking" && c.status === "available");
  const hasHistory = effectiveChecklist.some(c => c.field === "activity_log" && c.status === "available");
  const hasComms = effectiveChecklist.some(c => c.field === "customer_communication" && c.status === "available");

  const signals: string[] = [];
  if (hasAvs) signals.push("AVS/CVV match");
  if (hasOrder) signals.push("Order confirmed");
  if (hasDelivery) signals.push("Delivery confirmed");
  if (hasTracking && !hasDelivery) signals.push("Tracking confirmed");
  if (hasHistory) signals.push("Customer history");
  if (hasComms) signals.push("Customer notified");

  const positionLabel = "Purchase made by the legitimate cardholder";
  const confidence = signals.length >= 3 ? "High" : signals.length >= 2 ? "Medium" : "Low";

  // Claims from argument map — only supported ones
  const supportedClaims = argumentMap?.counterclaims.filter(c => c.supporting.length > 0) ?? [];
  // Missing merchant-actionable items only
  const actionableMissing = missingItems.filter(m => m.priority === "critical" || m.priority === "recommended");

  // Supporting vs missing evidence badges
  const presentItems = effectiveChecklist.filter(c => c.status === "available");
  const missingChecklist = effectiveChecklist.filter(c =>
    c.status === "missing" && (c.collectionType === "manual" || !c.collectionType),
  );

  // Strength
  const strength = strengthLabel(caseStrength.overall);
  const strengthTone = caseStrength.overall === "strong" ? "success" as const
    : caseStrength.overall === "moderate" ? "warning" as const
    : "critical" as const;

  return (
    <BlockStack gap="400">
      {/* 1. DEFENSE POSITION (top block) */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="start" wrap>
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">
                {positionLabel}
              </Text>
              <InlineStack gap="200" blockAlign="center">
                <Badge tone={confidence === "High" ? "success" : confidence === "Medium" ? "warning" : "critical"}>
                  {`Confidence: ${confidence}`}
                </Badge>
                {deadlineDays !== null && deadlineDays > 0 && (
                  <Text as="span" variant="bodySm" tone={deadlineUrgent ? "critical" : "subdued"}>
                    {deadlineUrgent
                      ? `Deadline approaching \u2014 ${deadlineDays}d left`
                      : `${deadlineDays} days to respond`}
                  </Text>
                )}
              </InlineStack>
            </BlockStack>

            <Button
              variant="primary"
              onClick={() => {
                if (nextAction.targetTab !== undefined) {
                  actions.setActiveTab(nextAction.targetTab);
                  if (nextAction.targetField) actions.navigateToEvidence(nextAction.targetField);
                } else {
                  actions.setActiveTab(2);
                }
              }}
            >
              {nextAction.label}
            </Button>
          </InlineStack>

          {signals.length > 0 && (
            <Text as="p" variant="bodySm" tone="subdued">
              {`Based on: ${signals.join(", ")}`}
            </Text>
          )}

          {confidence === "Low" && (
            <Banner tone="warning" hideIcon>
              <Text as="p" variant="bodySm">
                This case may require manual review before submission.
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Card>

      {/* 2. CASE STRENGTH */}
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">Case strength</Text>
            <Badge tone={strengthTone}>{strength}</Badge>
          </InlineStack>

          {/* Improvement actions — only if not strong */}
          {caseStrength.overall !== "strong" && actionableMissing.length > 0 && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                To strengthen your case:
              </Text>
              {actionableMissing.slice(0, 3).map((item) => (
                <InlineStack key={item.field} gap="200" blockAlign="center">
                  <Text as="p" variant="bodySm">
                    {`\u2022 ${item.label}`}
                  </Text>
                  <Badge tone={item.priority === "critical" ? "attention" : undefined}>
                    {item.priority === "critical" ? "Critical" : "Recommended"}
                  </Badge>
                </InlineStack>
              ))}
            </BlockStack>
          )}

          {caseStrength.strengthReason && (
            <Text as="p" variant="bodySm" tone="subdued">
              {caseStrength.strengthReason}
            </Text>
          )}
        </BlockStack>
      </Card>

      {/* 3. CLAIMS BREAKDOWN */}
      {supportedClaims.length > 0 && (
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Claims</Text>
            {supportedClaims.map((claim) => (
              <InlineStack key={claim.id} gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodySm" tone="success">{"\u2714"}</Text>
                <Text as="span" variant="bodyMd">{claim.title}</Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {`\u2014 ${claim.supporting.map(s => s.label).join(", ")}`}
                </Text>
              </InlineStack>
            ))}
            {/* Show missing claims only as actionable gaps, not as failures */}
            {missingChecklist.length > 0 && (
              <>
                {missingChecklist.slice(0, 2).map((item) => (
                  <InlineStack key={item.field} gap="200" blockAlign="center" wrap>
                    <Text as="span" variant="bodySm" tone="caution">{"\u2716"}</Text>
                    <Text as="span" variant="bodyMd" tone="subdued">{item.label}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">{"\u2014 not added yet"}</Text>
                  </InlineStack>
                ))}
              </>
            )}
          </BlockStack>
        </Card>
      )}

      {/* 4. EVIDENCE SUMMARY */}
      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">Evidence</Text>
          {presentItems.length > 0 && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold" tone="success">Supporting</Text>
              <InlineStack gap="200" wrap>
                {presentItems.map((item) => (
                  <Badge key={item.field} tone="success">{item.label}</Badge>
                ))}
              </InlineStack>
            </BlockStack>
          )}
          {missingChecklist.length > 0 && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold" tone="caution">Can be added</Text>
              <InlineStack gap="200" wrap>
                {missingChecklist.map((item) => (
                  <Badge key={item.field}>{item.label}</Badge>
                ))}
              </InlineStack>
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      {/* 5. NEXT BEST ACTION */}
      {nextAction.severity !== "info" && (
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">Best next step</Text>
            <Text as="p" variant="bodyMd">{nextAction.description}</Text>
            <Button
              size="slim"
              onClick={() => {
                if (nextAction.targetTab !== undefined) {
                  actions.setActiveTab(nextAction.targetTab);
                  if (nextAction.targetField) actions.navigateToEvidence(nextAction.targetField);
                }
              }}
            >
              {nextAction.label}
            </Button>
          </BlockStack>
        </Card>
      )}

      {/* 6. SUBMISSION MAPPING */}
      <Card>
        <BlockStack gap="100">
          <Text as="h3" variant="headingMd">Submission</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            This will be submitted as:
          </Text>
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {`"${positionLabel}"`}
          </Text>
        </BlockStack>
      </Card>

      {/* 7. EVIDENCE PROGRESS (tied to claims, no numeric %) */}
      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">Evidence by category</Text>
          <ProgressBar
            progress={presentItems.length > 0 ? Math.round((presentItems.length / (presentItems.length + missingChecklist.length)) * 100) : 0}
            tone={caseStrength.overall === "strong" ? "success" : "critical"}
            size="small"
          />
          {categories.length > 0 && (
            <InlineStack gap="200" wrap>
              {categories.map((cat) => {
                const allAvailable = cat.items.every(i => i.status === "available" || i.status === "waived");
                const hasMissing = cat.items.some(i => i.status === "missing" && (i.collectionType === "manual" || !i.collectionType));
                if (cat.items.every(i => i.status === "unavailable")) return null;
                return (
                  <Badge
                    key={cat.category.key}
                    tone={allAvailable ? "success" : hasMissing ? "attention" : undefined}
                  >
                    {`${allAvailable ? "\u2713" : hasMissing ? "\u2022" : "\u2014"} ${cat.category.label}`}
                  </Badge>
                );
              })}
            </InlineStack>
          )}
        </BlockStack>
      </Card>

      {/* Case summary (compact) */}
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px" }}>
          <div>
            <Text as="p" variant="bodySm" tone="subdued">Order</Text>
            <Text as="p" variant="bodyMd">{dispute.orderName || "\u2014"}</Text>
          </div>
          <div>
            <Text as="p" variant="bodySm" tone="subdued">Amount</Text>
            <Text as="p" variant="bodyMd">{`${dispute.currency} ${dispute.amount}`}</Text>
          </div>
          <div>
            <Text as="p" variant="bodySm" tone="subdued">Customer</Text>
            <Text as="p" variant="bodyMd">{dispute.customerName || "\u2014"}</Text>
          </div>
          <div>
            <Text as="p" variant="bodySm" tone="subdued">Type</Text>
            <Text as="p" variant="bodyMd">{caseTypeInfo.disputeType}</Text>
          </div>
        </div>
      </Card>
    </BlockStack>
  );
}
