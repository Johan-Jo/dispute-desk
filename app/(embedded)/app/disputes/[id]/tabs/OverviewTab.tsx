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
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import { merchantDisputeReasonLabel } from "@/lib/rules/disputeReasons";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import {
  EVIDENCE_EVALUATION_HELPER,
  categoryImpactLabel,
  evidenceRowStatus,
} from "@/lib/argument/evidenceStatus";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

const STRENGTH_LABEL: Record<string, string> = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
  insufficient: "Weak",
};

/** Plain-English description per evidence field — kept in sync with
 * WHY_TEXT in EvidenceTab.tsx so both tabs surface identical bank-grade
 * wording. Updated 2026-04-21 for the evidence-model rename. */
const WHY_EVIDENCE_MATTERS: Record<string, string> = {
  order_confirmation: "A complete record of the order, including items, amount, and customer details.",
  shipping_tracking: "Carrier confirmation that the order was shipped and delivered.",
  delivery_proof: "Proof of delivery through signature or photographic confirmation.",
  billing_address_match: "Billing matches the cardholder’s address — heavy weight in fraud cases.",
  avs_cvv_match: "Card security checks confirming the purchaser had access to billing details.",
  product_description: "Product was advertised exactly as delivered.",
  refund_policy: "Customer agreed to refund terms before purchase.",
  shipping_policy: "Shipping commitments were clearly disclosed before purchase.",
  cancellation_policy: "Cancellation rules were disclosed before purchase.",
  customer_communication: "Messages or emails showing engagement before or after the purchase.",
  customer_account_info: "Account age and activity supporting a legitimate customer profile.",
  duplicate_explanation: "Documents that the charges are distinct, not duplicates.",
  supporting_documents: "Additional proof reinforcing the overall defense.",
  activity_log: "Evidence of prior successful transactions from the same customer.",
  device_session_consistency: "Technical signals showing consistent device and session behavior.",
  ip_location_check: "Verification of purchase location compared to billing details and prior activity.",
};

const CATEGORY_FIX_HINT: Record<string, string> = {
  order: "Confirm the order record is synced from Shopify.",
  payment: "Pull AVS/CVV results from the payment gateway — strong fraud defense.",
  fulfillment: "Add tracking and delivery confirmation — reduces win probability when missing.",
  communication: "Attach customer messages or replies — banks reward engagement.",
  policy: "Publish or upload your store policies so they can be referenced.",
  identity: "Pull customer purchase history to show legitimate activity.",
  merchant: "Upload product listings or supporting documents to round out the case.",
};

interface DefenseRule {
  any: string[];
  all?: string[];
  bullet: string;
}

const DEFENSE_RULES: DefenseRule[] = [
  { any: ["order_confirmation"], bullet: "Complete order record confirms items, amount, and customer details" },
  { any: ["avs_cvv_match"], bullet: "Payment verification checks passed (AVS/CVV)" },
  { any: ["billing_address_match"], bullet: "Billing address matches the cardholder on file" },
  { any: ["delivery_proof", "shipping_tracking"], bullet: "Order was successfully fulfilled and delivered" },
  { any: ["activity_log"], bullet: "Customer behavior matches previous legitimate purchases" },
  { any: ["customer_account_info"], bullet: "Customer account history supports a legitimate profile" },
  { any: ["customer_communication"], bullet: "Customer was actively engaged through the order timeline" },
  { any: ["product_description"], bullet: "Product was advertised exactly as delivered" },
  { any: ["refund_policy", "shipping_policy", "cancellation_policy"], bullet: "Store policies were clearly disclosed at purchase" },
  { any: ["duplicate_explanation"], bullet: "Each charge is documented as a distinct, separate transaction" },
  { any: ["device_session_consistency"], bullet: "Device and session signals are consistent with a legitimate purchase" },
  { any: ["ip_location_check"], bullet: "Purchase location is consistent with the cardholder" },
  { any: ["supporting_documents"], bullet: "Additional documentation reinforces the overall defense" },
];

function synthesizeDefenseBullets(presentFields: Set<string>, ipUnfavorable: boolean): string[] {
  const bullets: string[] = [];
  for (const rule of DEFENSE_RULES) {
    if (!rule.any.some((f) => presentFields.has(f))) continue;
    if (rule.any.includes("ip_location_check") && ipUnfavorable) continue;
    bullets.push(rule.bullet);
  }
  return bullets;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function strengthTone(level: string): "success" | "warning" | "critical" {
  if (level === "strong") return "success";
  if (level === "moderate") return "warning";
  return "critical";
}

interface IpLocationPayload {
  bankEligible?: boolean;
  locationMatch?: string;
  summary?: string;
  merchantGuidance?: string | null;
  ipConsistencyLevel?: string;
  ipinfo?: { privacy?: { vpn?: boolean; proxy?: boolean; hosting?: boolean } } | null;
}

function extractIpLocationPayload(
  evidenceItems: Array<{ type: string; payload: Record<string, unknown> }> | undefined,
): IpLocationPayload | null {
  if (!evidenceItems) return null;
  const ip = evidenceItems.find(
    (e) => e.type === "other" && typeof (e.payload as { locationMatch?: unknown })?.locationMatch === "string",
  );
  return (ip?.payload as IpLocationPayload | undefined) ?? null;
}

const FAILURE_COPY: Record<string, { title: string; body: string }> = {
  order_fetch_failed: {
    title: "We couldn’t retrieve the Shopify order data",
    body:
      "This pack couldn’t be built because we weren’t able to load the underlying order from Shopify. " +
      "This is a system issue on our end — not missing evidence on yours.",
  },
};

const FAILURE_FALLBACK = {
  title: "We couldn’t finish building this pack",
  body: "Something went wrong while assembling the evidence pack. This is a system issue, not a missing-evidence issue.",
};

function calendarDaysSince(iso: string): number {
  const from = new Date(iso);
  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - fromDay.getTime()) / (1000 * 60 * 60 * 24)));
}

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
  const { data, derived, actions, clientState } = workspace;
  if (!data) return null;

  const { dispute, appliedRule } = data;
  const ipLocPayload = extractIpLocationPayload(data.pack?.evidenceItems);
  const ipUnfavorable = ipLocPayload?.bankEligible === false;
  const { caseStrength, effectiveChecklist, categories, missingItems, isReadOnly } = derived;

  // System failure short-circuit. When the build itself failed (e.g.,
  // Shopify order fetch failed), suppress the recommendation engine
  // entirely. Identity (title/amount/customer/reason) is already in the
  // shared header card rendered by WorkspaceShell, so the failed-build
  // body just shows the failure banner and a Retry CTA.
  if (derived.isFailed) {
    const copy = (derived.failureCode && FAILURE_COPY[derived.failureCode]) || FAILURE_FALLBACK;
    return (
      <BlockStack gap="500">
        <Banner tone="critical" title={copy.title}>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">{copy.body}</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Try rebuilding. If it keeps failing, contact support and reference this dispute.
            </Text>
            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={() => { void actions.generatePack(); }}
                disabled={clientState.retrying}
                loading={clientState.retrying}
              >
                Retry build
              </Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      </BlockStack>
    );
  }

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

  // Auto-submit denied visibility.
  const autoSaveBlock = !submitted
    ? (() => {
        const events = data.pack?.auditEvents ?? [];
        const lastBlock = [...events].reverse().find((e) => e.event_type === "auto_save_blocked");
        if (!lastBlock) return null;
        const payload = (lastBlock.event_payload ?? {}) as { reasons?: unknown };
        const reasons = Array.isArray(payload.reasons)
          ? (payload.reasons as unknown[]).filter((r): r is string => typeof r === "string")
          : [];
        return { reasons };
      })()
    : null;

  const topMissingLabel = missingItems[0]?.label ?? null;

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
      recommendationHelper = `${dayLabel}. The issuing bank typically responds within 30–75 days.`;
    } else {
      recommendationHelper = "The issuing bank typically responds within 30–75 days.";
    }
  } else if (strengthKey === "strong") {
    recommendation =
      "Recommendation: Submit now — your evidence is strong enough to defend this charge.";
  } else if (strengthKey === "moderate") {
    const top = missingItems[0];
    recommendation = top
      ? `Recommendation: You can submit, but adding ${top.label.toLowerCase()} would meaningfully improve your odds.`
      : "Recommendation: You can submit now, but a small amount of additional evidence would improve your odds.";
  } else {
    const top = missingItems[0];
    recommendation = top
      ? `Recommendation: Add ${top.label.toLowerCase()} before submitting — the case is currently unlikely to win as-is.`
      : "Recommendation: Strengthen the evidence before submitting — the case is currently unlikely to win as-is.";
  }

  const goToReview = () => actions.setActiveTab(2);
  const goToEvidence = () => actions.setActiveTab(1);
  const shopifyAdminUrl =
    dispute.shopDomain && dispute.disputeEvidenceGid
      ? getShopifyDisputeUrl(dispute.shopDomain, dispute.disputeEvidenceGid)
      : null;

  const POLICY_FIELDS = ["refund_policy", "shipping_policy", "cancellation_policy"];
  const missingPolicy = missingChecklist.find((m) => POLICY_FIELDS.includes(m.field));

  let improveCta: { label: string; url: string } | null = null;
  if (submitted && missingPolicy) {
    improveCta = {
      label: "Set up policies for future cases",
      url: withShopParams("/app/policies", searchParams),
    };
  }

  const disputeFamily = mapReasonToRulesFamily(dispute.reason);
  const rulesUrl = withShopParams(`/app/rules?family=${disputeFamily}`, searchParams);
  const appliedMode = appliedRule?.mode ?? "review";
  const appliedModeLabel = appliedMode === "auto" ? "Automatic" : "Review before submit";
  const appliedModeHelp =
    appliedMode === "auto"
      ? "DisputeDesk prepared the evidence pack and submitted it automatically."
      : "DisputeDesk prepared the evidence pack for you. Review it and submit before the deadline.";

  const defenseBullets = synthesizeDefenseBullets(presentFields, ipUnfavorable);

  const anyMissingCritical = missingChecklist.some((m) => m.priority === "critical");
  const coverageInterpretation = (() => {
    if (totalEvidenceShown === 0) return "No evidence has been collected yet.";
    if (missingChecklist.length === 0) {
      return "Coverage is complete. All required evidence categories are fully supported.";
    }
    if (anyMissingCritical) {
      return "Coverage has critical gaps — see the categories below.";
    }
    return "Coverage is mostly complete — a few categories could be strengthened.";
  })();

  const pageHeader = submitted
    ? "Your defense has been submitted to Shopify"
    : "Review your defense before submitting to Shopify";

  return (
    <BlockStack gap="500">
      {/* PAGE HEADER */}
      <Text as="h1" variant="headingXl">{pageHeader}</Text>

      {/* AUTO-SUBMIT DENIED */}
      {autoSaveBlock && (
        <Banner tone="warning" title="Auto-submit paused — your review needed">
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              DisputeDesk builds your defense automatically, but only auto-submits when the
              pack meets your auto-submit threshold. This pack didn’t clear the bar, so
              we stopped and handed it to you.
            </Text>
            {autoSaveBlock.reasons.length > 0 && (
              <Text as="p" variant="bodySm">
                Why: {autoSaveBlock.reasons.join(" • ")}
              </Text>
            )}
            {topMissingLabel && (
              <Text as="p" variant="bodySm">
                Biggest gap: {topMissingLabel}. Adding it strengthens the case before you submit.
              </Text>
            )}
            <InlineStack gap="200">
              <Button onClick={goToEvidence}>Add missing evidence</Button>
              <Button variant="primary" onClick={goToReview}>Submit now anyway</Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      )}

      {/* CASE STATUS */}
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
            <Text as="p" variant="bodySm" tone="subdued">
              {EVIDENCE_EVALUATION_HELPER}
            </Text>
          </BlockStack>

          {/* AUTOMATION RULE */}
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <BlockStack gap="050">
              <InlineStack gap="200" blockAlign="center">
                <Text as="p" variant="bodyMd">Automation rule:</Text>
                <Badge
                  tone={
                    appliedRule?.mode === "auto"
                      ? "success"
                      : appliedRule?.mode === "review"
                        ? "attention"
                        : undefined
                  }
                >
                  {appliedModeLabel}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">{appliedModeHelp}</Text>
            </BlockStack>
            <div style={{ marginLeft: "auto" }}>
              <Button url={rulesUrl}>Change rule</Button>
            </div>
          </InlineStack>

          {/* PRIMARY CTA */}
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

      {/* HOW WE DEFEND THIS CASE */}
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
                  <Text as="span" variant="bodyMd" tone="success">{"✓"}</Text>
                  <Text as="p" variant="bodyMd">{b}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}

      {/* YOUR SUPPORTING EVIDENCE */}
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Your supporting evidence</Text>

          {presentItems.length === 0 && missingChecklist.length === 0 && (
            <Text as="p" variant="bodyMd" tone="subdued">
              No evidence collected yet. Generate or build the evidence pack to begin.
            </Text>
          )}

          {presentItems.map((item) => {
            const row = evidenceRowStatus(item);
            const isIpRow = item.field === "ip_location_check";
            const ipVerdict = isIpRow ? ipLocPayload?.summary?.split("\n")[0] ?? null : null;
            const ipGuidance = isIpRow ? ipLocPayload?.merchantGuidance ?? null : null;

            return (
              <div
                key={item.field}
                style={{
                  border: "1px solid #e5e7eb",
                  borderLeft: "4px solid #16a34a",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{item.label}</Text>
                    <Badge tone={row.tone}>{row.label}</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {ipVerdict ?? WHY_EVIDENCE_MATTERS[item.field] ?? "Strengthens the overall response."}
                  </Text>
                  {ipGuidance ? (
                    <Text as="p" variant="bodySm" tone="subdued">{ipGuidance}</Text>
                  ) : null}
                </BlockStack>
              </div>
            );
          })}

          {missingChecklist.map((item) => {
            const row = evidenceRowStatus(item);
            const borderColor =
              row.label === "Critical gap"
                ? "#dc2626"
                : row.label === "Recommended"
                  ? "#2563eb"
                  : "#9ca3af";
            return (
              <div
                key={item.field}
                style={{
                  border: "1px solid #e5e7eb",
                  borderLeft: `4px solid ${borderColor}`,
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{item.label}</Text>
                    <Badge tone={row.tone}>{row.label}</Badge>
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

      {/* EVIDENCE BY CATEGORY */}
      {categories.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Evidence by category</Text>

            <Text as="p" variant="bodyMd" fontWeight="semibold">{coverageInterpretation}</Text>

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
                const visible = cat.items.filter((i) => i.status !== "unavailable");
                if (visible.length === 0) return null;
                const present = visible.filter(
                  (i) => i.status === "available" || i.status === "waived",
                );
                const missingActionable = visible.filter(
                  (i) =>
                    i.status === "missing" &&
                    (i.collectionType === "manual" || !i.collectionType),
                );
                const impact = categoryImpactLabel(cat.relevance);
                const hasCriticalGap = missingActionable.some((m) => m.priority === "critical");
                const borderColor = hasCriticalGap
                  ? "#dc2626"
                  : impact.tone === "success"
                    ? "#16a34a"
                    : impact.tone === "info"
                      ? "#2563eb"
                      : "#9ca3af";

                const suggestion = missingActionable[0]
                  ? `Missing ${missingActionable[0].label.toLowerCase()} — ${
                      WHY_EVIDENCE_MATTERS[missingActionable[0].field] ??
                      CATEGORY_FIX_HINT[cat.category.key] ??
                      "would strengthen this category."
                    }`
                  : null;

                return (
                  <div
                    key={cat.category.key}
                    style={{
                      borderLeft: `3px solid ${borderColor}`,
                      paddingLeft: 12,
                    }}
                  >
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {cat.category.label}
                        </Text>
                        <Badge tone={impact.tone}>{impact.label}</Badge>
                        <Badge>{`${present.length}/${visible.length}`}</Badge>
                        {hasCriticalGap && <Badge tone="critical">Critical gap</Badge>}
                      </InlineStack>
                      {suggestion && !submitted && (
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Text as="p" variant="bodySm" tone="subdued">{suggestion}</Text>
                          <Button
                            size="micro"
                            onClick={() => actions.navigateToEvidence(missingActionable[0].field)}
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
