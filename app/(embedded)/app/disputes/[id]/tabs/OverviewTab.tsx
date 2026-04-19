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

/** Outcome-driven, one-line "why it matters" per evidence field. */
const WHY_EVIDENCE_MATTERS: Record<string, string> = {
  order_confirmation: "Confirms a real, fully recorded transaction tied to this customer.",
  shipping_tracking: "Carrier records confirm the order left your warehouse.",
  delivery_proof: "Delivery confirmed \u2014 the strongest defense against \u2018not received\u2019 claims.",
  billing_address_match: "Billing matches the cardholder\u2019s address \u2014 heavy weight in fraud cases.",
  avs_cvv_match: "Security checks passed \u2014 strong indicator of legitimate cardholder use.",
  product_description: "Product was advertised exactly as delivered.",
  refund_policy: "Customer agreed to refund terms before purchase.",
  shipping_policy: "Shipping commitments were clearly disclosed before purchase.",
  cancellation_policy: "Cancellation rules were disclosed before purchase.",
  customer_communication: "Order timeline shows ongoing legitimate engagement with the customer.",
  duplicate_explanation: "Documents that the charges are distinct, not duplicates.",
  supporting_documents: "Additional proof reinforcing the overall defense.",
  activity_log: "Purchase history shows a legitimate, repeat customer pattern.",
};

const CATEGORY_FIX_HINT: Record<string, string> = {
  order: "Confirm the order record is synced from Shopify.",
  payment: "Pull AVS/CVV results from the payment gateway \u2014 strong fraud defense.",
  fulfillment: "Add tracking and delivery confirmation \u2014 reduces win probability when missing.",
  communication: "Attach customer messages or replies \u2014 banks reward engagement.",
  policy: "Publish or upload your store policies so they can be referenced.",
  identity: "Pull customer purchase history to show legitimate activity.",
  merchant: "Upload product listings or supporting documents to round out the case.",
};

/**
 * Synthesize assertive defense bullets from the present evidence.
 * Each rule fires only when its supporting fields are actually included.
 */
interface DefenseRule {
  any: string[];
  all?: string[];
  bullet: string;
}

const DEFENSE_RULES: DefenseRule[] = [
  { any: ["avs_cvv_match"], bullet: "Payment verification checks passed (AVS/CVV)" },
  { any: ["billing_address_match"], bullet: "Billing address matches the cardholder on file" },
  { any: ["delivery_proof", "shipping_tracking"], bullet: "Order was successfully fulfilled and delivered" },
  { any: ["activity_log"], bullet: "Customer behavior matches previous legitimate purchases" },
  { any: ["customer_communication"], bullet: "Customer was actively engaged through the order timeline" },
  { any: ["product_description"], bullet: "Product was advertised exactly as delivered" },
  { any: ["refund_policy", "shipping_policy", "cancellation_policy"], bullet: "Store policies were clearly disclosed at purchase" },
  { any: ["duplicate_explanation"], bullet: "Each charge is documented as a distinct, separate transaction" },
];

function synthesizeDefenseBullets(presentFields: Set<string>): string[] {
  const bullets: string[] = [];
  for (const rule of DEFENSE_RULES) {
    if (rule.any.some((f) => presentFields.has(f))) bullets.push(rule.bullet);
  }
  return bullets;
}

/** Top-level highlight statements for "What Shopify will receive". */
interface HighlightRule {
  fields: string[];
  text: string;
}

const HIGHLIGHT_RULES: HighlightRule[] = [
  { fields: ["avs_cvv_match", "billing_address_match"], text: "Payment verification passed" },
  { fields: ["shipping_tracking", "delivery_proof"], text: "Order fulfilled and delivered" },
  { fields: ["customer_communication", "activity_log"], text: "Customer actively participated" },
  { fields: ["refund_policy", "shipping_policy", "cancellation_policy"], text: "Policies were disclosed at purchase" },
];

function synthesizeHighlights(presentFields: Set<string>): string[] {
  const highlights: string[] = [];
  for (const rule of HIGHLIGHT_RULES) {
    if (rule.fields.some((f) => presentFields.has(f))) highlights.push(rule.text);
  }
  return highlights;
}

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

/** Calendar-day distance between an ISO timestamp and now (local time). */
function calendarDaysSince(iso: string): number {
  const from = new Date(iso);
  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - fromDay.getTime()) / (1000 * 60 * 60 * 24)));
}

/** Map a Shopify dispute reason to the family id used by /app/rules. */
function mapReasonToRulesFamily(reason: string | null | undefined): string {
  if (!reason) return "general";
  const key = reason.toUpperCase().replace(/\s+/g, "_");
  if (key === "FRAUDULENT" || key === "UNRECOGNIZED") return "fraud";
  if (key === "PRODUCT_NOT_RECEIVED") return "pnr";
  if (key === "PRODUCT_UNACCEPTABLE" || key === "NOT_AS_DESCRIBED") return "not_as_described";
  if (key === "SUBSCRIPTION_CANCELED") return "subscription";
  if (key === "CREDIT_NOT_PROCESSED") return "refund";
  if (key === "DUPLICATE") return "duplicate";
  return "general";
}

export default function OverviewTab({ workspace }: { workspace: Workspace }) {
  const searchParams = useSearchParams();
  const { data, derived, actions } = workspace;
  if (!data) return null;

  const { dispute, submissionFields, rebuttalDraft } = data;
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
  const presentFields = new Set(presentItems.map((p) => p.field));

  const totalEvidenceShown = presentItems.length + missingChecklist.length;
  const coveragePct =
    totalEvidenceShown > 0
      ? Math.round((presentItems.length / totalEvidenceShown) * 100)
      : 0;

  // Recommendation line + helper.
  let recommendation: string;
  let recommendationHelper: string | null = null;
  if (submitted) {
    if (strengthKey === "strong" || strengthKey === "moderate") {
      recommendation =
        "Recommendation: No further action is required. Your defense has been successfully submitted. We will notify you when the bank responds.";
    } else {
      recommendation =
        "Recommendation: Monitor this case. Consider strengthening evidence for future disputes.";
    }
    if (submittedAt) {
      const daysElapsed = calendarDaysSince(submittedAt);
      const dayLabel =
        daysElapsed === 0
          ? "Submitted today"
          : `${daysElapsed} day${daysElapsed === 1 ? "" : "s"} since submission`;
      recommendationHelper = `${dayLabel}. The issuing bank typically responds within 30\u201375 days.`;
    } else {
      recommendationHelper = "The issuing bank typically responds within 30\u201375 days.";
    }
  } else if (strengthKey === "strong") {
    recommendation =
      "Recommendation: Submit now \u2014 your evidence is strong enough to defend this charge.";
  } else if (strengthKey === "moderate") {
    const top = missingItems[0];
    recommendation = top
      ? `Recommendation: You can submit, but adding ${top.label.toLowerCase()} would meaningfully improve your odds.`
      : "Recommendation: You can submit now, but a small amount of additional evidence would improve your odds.";
  } else {
    const top = missingItems[0];
    recommendation = top
      ? `Recommendation: Add ${top.label.toLowerCase()} before submitting \u2014 the case is currently unlikely to win as-is.`
      : "Recommendation: Strengthen the evidence before submitting \u2014 the case is currently unlikely to win as-is.";
  }

  // CTAs
  const goToReview = () => actions.setActiveTab(2);
  const goToEvidence = () => actions.setActiveTab(1);
  const shopifyAdminUrl =
    dispute.disputeGid && dispute.shopDomain
      ? `https://${dispute.shopDomain}/admin/payments/dispute_evidences/${(dispute.disputeEvidenceGid ?? dispute.disputeGid).split("/").pop()}`
      : null;

  // Post-submit secondary CTA — gated by what's actually missing in this case.
  // Policy gaps win first (highest leverage: published policies auto-attach to
  // every future pack); otherwise route to Automation Rules pre-filtered to
  // this dispute's family; if nothing is missing, hide the CTA entirely.
  const POLICY_FIELDS = ["refund_policy", "shipping_policy", "cancellation_policy"];
  const missingPolicy = missingChecklist.find((m) => POLICY_FIELDS.includes(m.field));
  const missingNonPolicy = missingChecklist.find((m) => !POLICY_FIELDS.includes(m.field));

  let improveCta: { label: string; url: string } | null = null;
  if (submitted) {
    if (missingPolicy) {
      improveCta = {
        label: "Set up policies for future cases",
        url: withShopParams("/app/policies", searchParams),
      };
    } else if (missingNonPolicy) {
      const family = mapReasonToRulesFamily(dispute.reason);
      improveCta = {
        label: "Automate this for future cases",
        url: withShopParams(`/app/rules?family=${family}`, searchParams),
      };
    }
    // else nothing missing → no improvement CTA shown
  }

  // Defense bullets — synthesized from present evidence so the language is direct and assertive.
  const defenseBullets = synthesizeDefenseBullets(presentFields);

  // What Shopify will receive
  const includedFieldCount = submissionFields.filter((f) => f.included).length || presentItems.length;
  const summaryHighlights = synthesizeHighlights(presentFields);
  const rebuttalSummary = rebuttalDraft?.sections.find((s) => s.type === "summary")?.text?.trim() || null;

  // Coverage interpretation
  const anyMissingCritical = missingChecklist.some((m) => m.priority === "critical");
  const coverageInterpretation = (() => {
    if (totalEvidenceShown === 0) return "No evidence has been collected yet.";
    if (missingChecklist.length === 0) {
      return "Coverage is complete. All required evidence categories are fully supported.";
    }
    if (anyMissingCritical) {
      return "Coverage has critical gaps \u2014 see the categories below.";
    }
    return "Coverage is mostly complete \u2014 a few categories could be strengthened.";
  })();

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

          <BlockStack gap="100">
            <Text as="p" variant="bodyMd" fontWeight="semibold">{recommendation}</Text>
            {recommendationHelper && (
              <Text as="p" variant="bodySm" tone="subdued">{recommendationHelper}</Text>
            )}
          </BlockStack>

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
              improveCta && <Button url={improveCta.url}>{improveCta.label}</Button>
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
            <Text as="p" variant="bodyMd">
              We are arguing that this transaction was legitimate based on:
            </Text>
            <BlockStack gap="200">
              {defenseBullets.map((b) => (
                <InlineStack key={b} gap="200" blockAlign="start" wrap={false}>
                  <Text as="span" variant="bodyMd" tone="success">{"\u2713"}</Text>
                  <Text as="p" variant="bodyMd">{b}</Text>
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

          <Text as="p" variant="bodyMd">
            This case demonstrates that the transaction was legitimate and properly verified.
          </Text>

          {summaryHighlights.length > 0 && (
            <BlockStack gap="100">
              {summaryHighlights.map((h) => (
                <InlineStack key={h} gap="200" blockAlign="center" wrap={false}>
                  <Text as="span" variant="bodyMd" tone="success">{"\u2713"}</Text>
                  <Text as="p" variant="bodyMd">{h}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          )}

          {rebuttalSummary && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Defense summary (from the rebuttal letter)</Text>
              <Text as="p" variant="bodyMd">{rebuttalSummary}</Text>
            </BlockStack>
          )}

          <Divider />

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
        </BlockStack>
      </Card>

      {/* 5. EVIDENCE BY CATEGORY */}
      {categories.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Evidence by category</Text>

            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {coverageInterpretation}
            </Text>

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
