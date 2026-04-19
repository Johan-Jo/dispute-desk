"use client";

import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

const STRENGTH_LABEL: Record<string, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
  insufficient: "Weak",
};

const WHY_EVIDENCE_MATTERS: Record<string, string> = {
  order_confirmation: "Anchors the case — proves the order is real and tied to this customer.",
  shipping_tracking: "Carrier records show the package left your hands.",
  delivery_proof: "Confirms the customer received the package — the strongest defense against \u2018not received\u2019 claims.",
  billing_address_match: "Ties the order to the cardholder\u2019s billing address — heavy weight in fraud cases.",
  avs_cvv_match: "Bank security checks passed — banks weigh this heavily for fraud.",
  product_description: "Shows the customer saw and accepted the product as advertised.",
  refund_policy: "Proves the customer agreed to refund terms before purchase.",
  shipping_policy: "Documents your shipping commitments for delivery timing disputes.",
  cancellation_policy: "Proves the customer was informed of cancellation rules.",
  customer_communication: "Banks favor merchants who try to resolve issues directly.",
  duplicate_explanation: "Required to prove the charges are not duplicates.",
  supporting_documents: "Extra proof that strengthens the overall case.",
  activity_log: "Customer history that shows legitimate ongoing engagement.",
};

const CATEGORY_FIX_HINT: Record<string, string> = {
  order: "Confirm the order record is synced from Shopify.",
  payment: "Verify the gateway returned AVS/CVV results — strong fraud defense.",
  fulfillment: "Add tracking and delivery confirmation \u2014 reduces win probability when missing.",
  communication: "Attach customer messages or replies \u2014 banks reward engagement.",
  policy: "Publish or upload your store policies so they can be referenced.",
  identity: "Pull customer purchase history to show legitimate activity.",
  merchant: "Upload product listings or supporting documents to round out the case.",
};

function formatDate(iso: string | null): string {
  if (!iso) return "\u2014";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "\u2014";
  }
}

function strengthTone(level: string): "success" | "warning" | "critical" {
  if (level === "strong") return "success";
  if (level === "moderate") return "warning";
  return "critical";
}

export default function OverviewTab({ workspace }: { workspace: Workspace }) {
  const searchParams = useSearchParams();
  const { data, derived, actions } = workspace;
  if (!data) return null;

  const { dispute, argumentMap, rebuttalDraft, submissionFields } = data;
  const { caseStrength, effectiveChecklist, categories, missingItems, isReadOnly } = derived;

  const submitted = isReadOnly;
  const submittedAt = data.pack?.savedToShopifyAt ?? null;

  const deadlineDays = dispute.dueAt
    ? Math.ceil((new Date(dispute.dueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const deadlineUrgent = deadlineDays !== null && deadlineDays <= 2;

  const strengthKey = caseStrength.overall;
  const strengthText = STRENGTH_LABEL[strengthKey] ?? "Weak";

  const presentItems = effectiveChecklist.filter((c) => c.status === "available");
  const missingChecklist = effectiveChecklist.filter(
    (c) => c.status === "missing" && (c.collectionType === "manual" || !c.collectionType),
  );

  const totalEvidenceShown = presentItems.length + missingChecklist.length;
  const coveragePct =
    totalEvidenceShown > 0
      ? Math.round((presentItems.length / totalEvidenceShown) * 100)
      : 0;

  // Recommendation sentence — single, decision-oriented.
  let recommendation: string;
  if (submitted) {
    recommendation = `Your evidence pack was sent to Shopify on ${formatDate(submittedAt)}. The issuing bank typically responds within 30\u201375 days.`;
  } else if (strengthKey === "strong") {
    recommendation = "Submit now \u2014 your evidence is strong enough to defend this charge.";
  } else if (strengthKey === "moderate") {
    const top = missingItems[0];
    recommendation = top
      ? `You can submit, but adding ${top.label.toLowerCase()} would meaningfully improve your odds.`
      : "You can submit now, but a small amount of additional evidence would improve your odds.";
  } else {
    const top = missingItems[0];
    recommendation = top
      ? `Add ${top.label.toLowerCase()} before submitting \u2014 the case is currently unlikely to win as-is.`
      : "Strengthen the evidence before submitting \u2014 the case is currently unlikely to win as-is.";
  }

  // CTAs
  const goToReview = () => actions.setActiveTab(2);
  const goToEvidence = () => actions.setActiveTab(1);
  const shopifyAdminUrl =
    dispute.disputeGid && dispute.shopDomain
      ? `https://${dispute.shopDomain}/admin/payments/dispute_evidences/${(dispute.disputeEvidenceGid ?? dispute.disputeGid).split("/").pop()}`
      : null;
  const policiesUrl = withShopParams("/app/policies", searchParams);

  // Defense bullets — plain language counterclaim titles, only those with support.
  const defenseBullets = (argumentMap?.counterclaims ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    supported: c.supporting.length > 0,
  }));

  // What Shopify will receive
  const includedFieldCount = submissionFields.filter((f) => f.included).length || presentItems.length;
  const summaryText =
    rebuttalDraft?.sections.find((s) => s.type === "summary")?.text?.trim() ||
    "A structured response letter that maps your evidence to each issuer claim.";
  const keyHighlights = presentItems.slice(0, 3).map((i) => i.label);

  // Page header
  const pageHeader = submitted
    ? "Your defense has been submitted to Shopify"
    : "Review your defense before submitting to Shopify";

  return (
    <BlockStack gap="500">
      {/* PAGE HEADER */}
      <Text as="h1" variant="headingXl">
        {pageHeader}
      </Text>

      {/* 1. CASE STATUS */}
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">Case status</Text>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "16px",
            }}
          >
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Status</Text>
              <Badge tone={submitted ? "info" : "attention"}>
                {submitted ? "Submitted" : "Not submitted"}
              </Badge>
            </BlockStack>

            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Strength</Text>
              <Badge tone={strengthTone(strengthKey)}>{strengthText}</Badge>
            </BlockStack>

            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Deadline</Text>
              <Text
                as="p"
                variant="bodyMd"
                fontWeight="semibold"
                tone={!submitted && deadlineUrgent ? "critical" : undefined}
              >
                {submitted
                  ? `Submitted ${formatDate(submittedAt)}`
                  : deadlineDays !== null && deadlineDays > 0
                    ? `${deadlineDays} day${deadlineDays === 1 ? "" : "s"} remaining`
                    : deadlineDays !== null && deadlineDays <= 0
                      ? "Overdue"
                      : "No deadline set"}
              </Text>
            </BlockStack>
          </div>

          <Divider />

          <Text as="p" variant="bodyMd">{recommendation}</Text>

          {/* PRIMARY CTA — visually dominant */}
          <InlineStack gap="300" blockAlign="center">
            <div style={{ minWidth: 220 }}>
              {submitted ? (
                <Button
                  variant="primary"
                  size="large"
                  url={shopifyAdminUrl ?? undefined}
                  target="_blank"
                  disabled={!shopifyAdminUrl}
                >
                  View in Shopify
                </Button>
              ) : (
                <Button variant="primary" size="large" onClick={goToReview}>
                  Submit to Shopify
                </Button>
              )}
            </div>
            {submitted ? (
              <Button url={policiesUrl}>Improve for future cases</Button>
            ) : (
              <Button onClick={goToEvidence}>Edit evidence</Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>

      {/* 2. HOW WE DEFEND THIS CASE */}
      {defenseBullets.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">How we defend this case</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              The argument we are making to the issuing bank, in plain language.
            </Text>
            <BlockStack gap="200">
              {defenseBullets.map((b) => (
                <InlineStack key={b.id} gap="200" blockAlign="start" wrap={false}>
                  <Text as="span" variant="bodyMd" tone={b.supported ? "success" : "subdued"}>
                    {b.supported ? "\u2713" : "\u25CB"}
                  </Text>
                  <Text as="p" variant="bodyMd">{b.title}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}

      {/* 3. YOUR SUPPORTING EVIDENCE */}
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Your supporting evidence</Text>

          {presentItems.length === 0 && missingChecklist.length === 0 && (
            <Text as="p" variant="bodyMd" tone="subdued">
              No evidence collected yet. Generate or build the evidence pack to begin.
            </Text>
          )}

          {presentItems.map((item) => {
            const strong = item.strength === "strong";
            return (
              <div
                key={item.field}
                style={{
                  border: "1px solid #e5e7eb",
                  borderLeft: `4px solid ${strong ? "#16a34a" : "#d97706"}`,
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{item.label}</Text>
                    <Badge tone="success">Included</Badge>
                    <Badge tone={strong ? "success" : "warning"}>
                      {strong ? "Strong" : "Moderate"}
                    </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {WHY_EVIDENCE_MATTERS[item.field] ?? "Strengthens the overall response."}
                  </Text>
                </BlockStack>
              </div>
            );
          })}

          {missingChecklist.map((item) => {
            const critical = item.priority === "critical";
            return (
              <div
                key={item.field}
                style={{
                  border: "1px solid #e5e7eb",
                  borderLeft: `4px solid ${critical ? "#dc2626" : "#9ca3af"}`,
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{item.label}</Text>
                    <Badge tone={critical ? "critical" : undefined}>Missing</Badge>
                    <Badge tone={critical ? "critical" : "warning"}>
                      {critical ? "Weak without it" : "Helpful"}
                    </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {WHY_EVIDENCE_MATTERS[item.field] ?? "Would strengthen the overall response."}
                  </Text>
                  {!submitted && (
                    <div>
                      <Button
                        size="slim"
                        onClick={() => actions.navigateToEvidence(item.field)}
                      >
                        Add this evidence
                      </Button>
                    </div>
                  )}
                </BlockStack>
              </div>
            );
          })}
        </BlockStack>
      </Card>

      {/* 4. WHAT SHOPIFY WILL RECEIVE */}
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">What Shopify will receive</Text>

          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">Defense summary</Text>
            <Text as="p" variant="bodyMd">{summaryText}</Text>
          </BlockStack>

          <InlineStack gap="400" wrap>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Evidence items</Text>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {`${includedFieldCount} item${includedFieldCount === 1 ? "" : "s"} attached`}
              </Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Format</Text>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                Letter + structured Shopify fields
              </Text>
            </BlockStack>
          </InlineStack>

          {keyHighlights.length > 0 && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Key highlights</Text>
              <BlockStack gap="050">
                {keyHighlights.map((h) => (
                  <Text key={h} as="p" variant="bodyMd">{`\u2022 ${h}`}</Text>
                ))}
              </BlockStack>
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      {/* 5. EVIDENCE BY CATEGORY */}
      {categories.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Evidence by category</Text>
            <ProgressBar
              progress={coveragePct}
              tone={strengthKey === "strong" ? "success" : strengthKey === "moderate" ? "primary" : "critical"}
              size="small"
            />
            <Text as="p" variant="bodySm" tone="subdued">
              {`${presentItems.length} of ${totalEvidenceShown} addable items collected`}
            </Text>

            <BlockStack gap="200">
              {categories.map((cat) => {
                const visible = cat.items.filter(
                  (i) => i.status !== "unavailable",
                );
                if (visible.length === 0) return null;
                const present = visible.filter((i) => i.status === "available" || i.status === "waived");
                const missingActionable = visible.filter(
                  (i) =>
                    i.status === "missing" &&
                    (i.collectionType === "manual" || !i.collectionType),
                );
                const allCovered = missingActionable.length === 0 && present.length > 0;
                const tone = allCovered
                  ? "success"
                  : missingActionable.some((m) => m.priority === "critical")
                    ? "critical"
                    : "warning";

                const suggestion = missingActionable[0]
                  ? `Missing ${missingActionable[0].label.toLowerCase()} \u2014 ${
                      WHY_EVIDENCE_MATTERS[missingActionable[0].field] ??
                      CATEGORY_FIX_HINT[cat.category.key] ??
                      "would strengthen this category."
                    }`
                  : null;

                return (
                  <div
                    key={cat.category.key}
                    style={{
                      borderLeft: `3px solid ${
                        tone === "success" ? "#16a34a" : tone === "critical" ? "#dc2626" : "#d97706"
                      }`,
                      paddingLeft: 12,
                    }}
                  >
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {cat.category.label}
                        </Text>
                        <Badge tone={tone}>
                          {`${present.length}/${visible.length}`}
                        </Badge>
                      </InlineStack>
                      {suggestion && !submitted && (
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Text as="p" variant="bodySm" tone="subdued">{suggestion}</Text>
                          <Button
                            size="micro"
                            onClick={() =>
                              actions.navigateToEvidence(missingActionable[0].field)
                            }
                          >
                            Fix
                          </Button>
                        </InlineStack>
                      )}
                    </BlockStack>
                  </div>
                );
              })}
            </BlockStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
