"use client";

import { useState } from "react";
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
  Collapsible,
} from "@shopify/polaris";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import { merchantDisputeReasonLabel } from "@/lib/rules/disputeReasons";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import { evidenceStrengthLabel } from "@/lib/argument/evidenceStrength";
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
  billing_address_match: "Billing matches the cardholder\u2019s address \u2014 heavy weight in fraud cases.",
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
    // Skip the IP bullet when the IP check came back unfavorable — we must not
    // claim "consistent with the cardholder" when the finding contradicts it.
    if (rule.any.includes("ip_location_check") && ipUnfavorable) continue;
    bullets.push(rule.bullet);
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

/** Shape of the auto-collected Shopify order section. */
interface OrderEvidencePayload {
  orderId?: string;
  orderName?: string;
  createdAt?: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  cancelledAt?: string | null;
  lineItems?: Array<{
    title?: string;
    variant?: string | null;
    quantity?: number;
    total?: string;
    currency?: string;
    sku?: string | null;
  }>;
  totals?: {
    subtotal?: string;
    shipping?: string;
    tax?: string;
    discounts?: string;
    total?: string;
    refunded?: string;
    currency?: string;
  };
  billingAddress?: { city?: string; provinceCode?: string; countryCode?: string; zipPrefix?: string | null } | null;
  shippingAddress?: { city?: string; provinceCode?: string; countryCode?: string; zipPrefix?: string | null } | null;
  customerTenure?: { totalOrders?: number; customerSince?: string } | null;
}

function extractOrderPayload(
  evidenceItems: Array<{ type: string; payload: Record<string, unknown> }> | undefined,
): OrderEvidencePayload | null {
  if (!evidenceItems) return null;
  // Pick the order section with line items (skips the refund-history sub-section).
  const order = evidenceItems.find(
    (e) => e.type === "order" && Array.isArray((e.payload as { lineItems?: unknown[] })?.lineItems),
  );
  return (order?.payload as OrderEvidencePayload | undefined) ?? null;
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
  // The IP & Location Check section is the only "other" section that
  // exposes a `locationMatch` enum — uniquely identifiable.
  const ip = evidenceItems.find(
    (e) => e.type === "other" && typeof (e.payload as { locationMatch?: unknown })?.locationMatch === "string",
  );
  return (ip?.payload as IpLocationPayload | undefined) ?? null;
}

/**
 * Short, specific status badge for the IP & Location Check row. Tells the
 * merchant at a glance WHAT the check found, not just that it ran.
 */
function ipStatusBadgeLabel(p: IpLocationPayload | null): string {
  if (!p) return "Reviewed";
  const privacy = p.ipinfo?.privacy ?? {};
  if (privacy.vpn || privacy.proxy) return "Network risk";
  if (privacy.hosting) return "Data-center IP";
  if (p.locationMatch === "different_country") return "Location mismatch";
  if (p.ipConsistencyLevel === "variable") return "Multiple IPs used";
  if (p.locationMatch === "same_city" || p.locationMatch === "same_country") return "Match";
  return "Reviewed";
}

function formatAddress(
  addr: OrderEvidencePayload["billingAddress"] | undefined,
): string {
  if (!addr) return "\u2014";
  const parts = [addr.city, addr.provinceCode, addr.countryCode].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "\u2014";
}

/**
 * Merchant-safe copy for system failure codes. The internal
 * failure_reason from the pack record is never rendered directly.
 */
const FAILURE_COPY: Record<string, { title: string; body: string }> = {
  order_fetch_failed: {
    title: "We couldn\u2019t retrieve the Shopify order data",
    body:
      "This pack couldn\u2019t be built because we weren\u2019t able to load the underlying order from Shopify. " +
      "This is a system issue on our end \u2014 not missing evidence on yours.",
  },
};

const FAILURE_FALLBACK = {
  title: "We couldn\u2019t finish building this pack",
  body: "Something went wrong while assembling the evidence pack. This is a system issue, not a missing-evidence issue.",
};

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
  const [orderDetailsOpen, setOrderDetailsOpen] = useState(false);
  const { data, derived, actions, clientState } = workspace;
  if (!data) return null;

  const { dispute, submissionFields, rebuttalDraft } = data;
  const orderPayload = extractOrderPayload(data.pack?.evidenceItems);
  const ipLocPayload = extractIpLocationPayload(data.pack?.evidenceItems);
  const ipUnfavorable = ipLocPayload?.bankEligible === false;
  const { caseStrength, effectiveChecklist, categories, missingItems, isReadOnly } = derived;

  // System failure short-circuit. When the build itself failed (e.g.,
  // Shopify order fetch failed), suppress the recommendation engine
  // entirely. We still render the Case Summary above so the merchant
  // sees what dispute they're looking at, but the Case Status / Defense
  // / Evidence sections would be misleading on a build that never
  // completed. Keep CTAs to "Retry build" only.
  if (derived.isFailed) {
    const copy = (derived.failureCode && FAILURE_COPY[derived.failureCode]) || FAILURE_FALLBACK;
    return (
      <BlockStack gap="500">
        <Text as="h1" variant="headingXl">{copy.title}</Text>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingSm" tone="subdued">Case summary</Text>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(180px, max-content) 1fr",
                gap: "20px",
                alignItems: "start",
              }}
            >
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Amount at risk</Text>
                <Text as="p" variant="heading2xl">
                  {`${dispute.currency} ${dispute.amount}`}
                </Text>
              </BlockStack>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: "12px 24px",
                }}
              >
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">Order</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {dispute.orderName || "\u2014"}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">Customer</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {dispute.customerName || "\u2014"}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">Dispute reason</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {merchantDisputeReasonLabel(dispute.reason)}
                  </Text>
                </BlockStack>
              </div>
            </div>
          </BlockStack>
        </Card>

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

  // Auto-submit denied visibility. When auto-save fires during pack build it
  // records an `auto_save_blocked` audit event with the gate's reasons. If the
  // most-recent audit event for this pack is that block (and the pack hasn't
  // since been submitted), the merchant needs to understand why DisputeDesk
  // did NOT push the pack to Shopify automatically.
  const autoSaveBlock = !submitted
    ? (() => {
        const events = data.pack?.auditEvents ?? [];
        const lastBlock = [...events]
          .reverse()
          .find((e) => e.event_type === "auto_save_blocked");
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
    dispute.shopDomain && dispute.disputeEvidenceGid
      ? getShopifyDisputeUrl(dispute.shopDomain, dispute.disputeEvidenceGid)
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
  const defenseBullets = synthesizeDefenseBullets(presentFields, ipUnfavorable);

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
      {/* CASE SUMMARY — what the dispute is */}
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingSm" tone="subdued">Case summary</Text>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, max-content) 1fr",
              gap: "20px",
              alignItems: "start",
            }}
          >
            <BlockStack gap="050">
              <Text as="p" variant="bodySm" tone="subdued">Amount at risk</Text>
              <Text as="p" variant="heading2xl">
                {`${dispute.currency} ${dispute.amount}`}
              </Text>
            </BlockStack>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: "12px 24px",
              }}
            >
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Order</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {dispute.orderName || "\u2014"}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Customer</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {dispute.customerName || "\u2014"}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Dispute reason</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {merchantDisputeReasonLabel(dispute.reason)}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Submitted</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {submitted && submittedAt ? formatDate(submittedAt) : "Awaiting submission"}
                </Text>
              </BlockStack>
            </div>
          </div>

          {orderPayload && (
            <>
              <div>
                <Button
                  variant="plain"
                  ariaExpanded={orderDetailsOpen}
                  ariaControls="case-summary-order-details"
                  disclosure={orderDetailsOpen ? "up" : "down"}
                  onClick={() => setOrderDetailsOpen((v) => !v)}
                >
                  {orderDetailsOpen ? "Hide order details" : "Show order details"}
                </Button>
              </div>
              <Collapsible
                open={orderDetailsOpen}
                id="case-summary-order-details"
                transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
                expandOnPrint
              >
                <BlockStack gap="400">
                  <Divider />

                  {/* Line items */}
                  {orderPayload.lineItems && orderPayload.lineItems.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
                        Items in this order
                      </Text>
                      <BlockStack gap="100">
                        {orderPayload.lineItems.map((li, i) => {
                          const subtitleParts = [
                            li.variant,
                            li.sku ? `SKU ${li.sku}` : null,
                          ].filter(Boolean) as string[];
                          return (
                            <InlineStack
                              key={`${li.title}-${i}`}
                              gap="200"
                              align="space-between"
                              blockAlign="start"
                              wrap={false}
                            >
                              <BlockStack gap="050">
                                <Text as="p" variant="bodyMd" fontWeight="semibold">
                                  {`${li.quantity ?? 1} \u00D7 ${li.title ?? "Item"}`}
                                </Text>
                                {subtitleParts.length > 0 && (
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {subtitleParts.join(" \u2022 ")}
                                  </Text>
                                )}
                              </BlockStack>
                              {li.total && (
                                <Text as="p" variant="bodyMd">
                                  {`${li.currency ?? orderPayload.totals?.currency ?? dispute.currency} ${li.total}`}
                                </Text>
                              )}
                            </InlineStack>
                          );
                        })}
                      </BlockStack>
                    </BlockStack>
                  )}

                  {/* Totals */}
                  {orderPayload.totals && (
                    <>
                      <Divider />
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
                          Order totals
                        </Text>
                        {([
                          ["Subtotal", orderPayload.totals.subtotal],
                          ["Shipping", orderPayload.totals.shipping],
                          ["Tax", orderPayload.totals.tax],
                          ["Discounts", orderPayload.totals.discounts],
                          ["Refunded", orderPayload.totals.refunded],
                        ] as Array<[string, string | undefined]>).map(([label, value]) => {
                          if (!value || value === "0.00" || value === "0") return null;
                          return (
                            <InlineStack key={label} align="space-between" gap="200">
                              <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                              <Text as="p" variant="bodySm">
                                {`${orderPayload.totals?.currency ?? dispute.currency} ${value}`}
                              </Text>
                            </InlineStack>
                          );
                        })}
                        {orderPayload.totals.total && (
                          <InlineStack align="space-between" gap="200">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">Total</Text>
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {`${orderPayload.totals.currency ?? dispute.currency} ${orderPayload.totals.total}`}
                            </Text>
                          </InlineStack>
                        )}
                      </BlockStack>
                    </>
                  )}

                  {/* Order facts */}
                  <Divider />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "12px 24px",
                    }}
                  >
                    {orderPayload.createdAt && (
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Order placed</Text>
                        <Text as="p" variant="bodyMd">{formatDate(orderPayload.createdAt)}</Text>
                      </BlockStack>
                    )}
                    {orderPayload.financialStatus && (
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Payment status</Text>
                        <Text as="p" variant="bodyMd">{orderPayload.financialStatus}</Text>
                      </BlockStack>
                    )}
                    {orderPayload.fulfillmentStatus && (
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Fulfillment</Text>
                        <Text as="p" variant="bodyMd">{orderPayload.fulfillmentStatus}</Text>
                      </BlockStack>
                    )}
                    {orderPayload.cancelledAt && (
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Cancelled</Text>
                        <Text as="p" variant="bodyMd">{formatDate(orderPayload.cancelledAt)}</Text>
                      </BlockStack>
                    )}
                    {orderPayload.billingAddress && (
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Billing</Text>
                        <Text as="p" variant="bodyMd">{formatAddress(orderPayload.billingAddress)}</Text>
                      </BlockStack>
                    )}
                    {orderPayload.shippingAddress && (
                      <BlockStack gap="050">
                        <Text as="p" variant="bodySm" tone="subdued">Shipping</Text>
                        <Text as="p" variant="bodyMd">{formatAddress(orderPayload.shippingAddress)}</Text>
                      </BlockStack>
                    )}
                    {orderPayload.customerTenure && (
                      <>
                        {typeof orderPayload.customerTenure.totalOrders === "number" && (
                          <BlockStack gap="050">
                            <Text as="p" variant="bodySm" tone="subdued">Customer total orders</Text>
                            <Text as="p" variant="bodyMd">{orderPayload.customerTenure.totalOrders}</Text>
                          </BlockStack>
                        )}
                        {orderPayload.customerTenure.customerSince && (
                          <BlockStack gap="050">
                            <Text as="p" variant="bodySm" tone="subdued">Customer since</Text>
                            <Text as="p" variant="bodyMd">{formatDate(orderPayload.customerTenure.customerSince)}</Text>
                          </BlockStack>
                        )}
                      </>
                    )}
                  </div>

                  <Text as="p" variant="bodySm" tone="subdued">
                    Pulled from Shopify order data. Address details are city-level only for privacy.
                  </Text>
                </BlockStack>
              </Collapsible>
            </>
          )}
        </BlockStack>
      </Card>

      {/* PAGE HEADER */}
      <Text as="h1" variant="headingXl">
        {pageHeader}
      </Text>

      {/* AUTO-SUBMIT DENIED — why DisputeDesk did not push to Shopify */}
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
                Biggest gap: {topMissingLabel}. Adding it strengthens the case
                before you submit.
              </Text>
            )}
            <InlineStack gap="200">
              <Button onClick={goToEvidence}>Add missing evidence</Button>
              <Button variant="primary" onClick={goToReview}>Submit now anyway</Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      )}

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
            const strengthLabel = evidenceStrengthLabel(item.field);
            const strong = strengthLabel === "Strong evidence";
            // The IP & Location Check row is special: it's "available" because
            // we ran the check, but the result may be unfavorable (mismatch /
            // VPN / proxy). When that's the case we render with warning treatment
            // and surface the actual verdict + guidance instead of the generic
            // description, so the merchant sees WHAT was found, not just that
            // we looked.
            const isIpRow = item.field === "ip_location_check";
            const negativeIp = isIpRow && ipUnfavorable;
            const borderColor = negativeIp ? "#d97706" : strong ? "#16a34a" : "#d97706";

            // For the IP row, prefer the case-specific verdict over the
            // generic explainer. The verdict already reads conclusion-first
            // ("Purchase location differs from billing country.").
            const ipVerdict = isIpRow ? ipLocPayload?.summary?.split("\n")[0] ?? null : null;
            const ipGuidance = isIpRow ? ipLocPayload?.merchantGuidance ?? null : null;
            const ipBadgeLabel = isIpRow ? ipStatusBadgeLabel(ipLocPayload) : null;

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
                    {isIpRow ? (
                      <Badge tone={negativeIp ? "warning" : "success"}>
                        {ipBadgeLabel ?? "Reviewed"}
                      </Badge>
                    ) : (
                      <Badge tone="success">Included</Badge>
                    )}
                    <Badge tone={negativeIp ? "warning" : strong ? "success" : "info"}>{strengthLabel}</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone={negativeIp ? undefined : "subdued"}>
                    {ipVerdict ?? WHY_EVIDENCE_MATTERS[item.field] ?? "Strengthens the overall response."}
                  </Text>
                  {ipGuidance ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {ipGuidance}
                    </Text>
                  ) : null}
                </BlockStack>
              </div>
            );
          })}

          {missingChecklist.map((item) => {
            const strengthLabel = evidenceStrengthLabel(item.field);
            const strong = strengthLabel === "Strong evidence";
            return (
              <div
                key={item.field}
                style={{
                  border: "1px solid #e5e7eb",
                  borderLeft: `4px solid ${strong ? "#dc2626" : "#9ca3af"}`,
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{item.label}</Text>
                    <Badge tone={strong ? "critical" : undefined}>Missing</Badge>
                    <Badge tone={strong ? "critical" : "info"}>{strengthLabel}</Badge>
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
