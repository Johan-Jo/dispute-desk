"use client";

import {
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ClockIcon,
  ShieldCheckMarkIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/** Confidence label + visual styling per case strength.
 *  Submitted-strong/moderate maps to the Figma green hero; weak/pre-submit
 *  fall back to amber/red while keeping the same structural layout. */
interface ConfidenceStyle {
  title: string;
  pct: number;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  titleColor: string;
  bodyColor: string;
  pillBg: string;
  pillColor: string;
}
const CONFIDENCE_BY_STRENGTH: Record<string, ConfidenceStyle> = {
  strong: {
    title: "Likely to win",
    pct: 85,
    bg: "#F0FDF4",
    border: "#86EFAC",
    iconBg: "#D1FAE5",
    iconColor: "#059669",
    titleColor: "#065F46",
    bodyColor: "#065F46",
    pillBg: "#D1FAE5",
    pillColor: "#065F46",
  },
  moderate: {
    title: "Could win",
    pct: 60,
    bg: "#FFFBEB",
    border: "#FDE68A",
    iconBg: "#FEF3C7",
    iconColor: "#D97706",
    titleColor: "#78350F",
    bodyColor: "#92400E",
    pillBg: "#FEF3C7",
    pillColor: "#92400E",
  },
  weak: {
    title: "Hard to win",
    pct: 30,
    bg: "#FEF2F2",
    border: "#FCA5A5",
    iconBg: "#FEE2E2",
    iconColor: "#DC2626",
    titleColor: "#7F1D1D",
    bodyColor: "#991B1B",
    pillBg: "#FEE2E2",
    pillColor: "#991B1B",
  },
  insufficient: {
    title: "Hard to win",
    pct: 15,
    bg: "#FEF2F2",
    border: "#FCA5A5",
    iconBg: "#FEE2E2",
    iconColor: "#DC2626",
    titleColor: "#7F1D1D",
    bodyColor: "#991B1B",
    pillBg: "#FEE2E2",
    pillColor: "#991B1B",
  },
};

interface DefenseReason {
  any: string[];
  title: string;
  description: string;
  /** Strength shown as a pill. */
  strength: "Strong" | "Supporting" | "Helpful";
}

/** Defense reasons surfaced when the relevant evidence field is present. */
const DEFENSE_REASONS: DefenseReason[] = [
  {
    any: ["avs_cvv_match"],
    title: "Payment verified",
    description: "AVS and CVV checks passed, indicating cardholder authorization.",
    strength: "Strong",
  },
  {
    any: ["billing_address_match"],
    title: "Billing address matches",
    description: "Billing matches the cardholder’s address on file.",
    strength: "Strong",
  },
  {
    any: ["delivery_proof", "shipping_tracking"],
    title: "Delivered with tracking",
    description: "Package delivered to billing address with carrier confirmation.",
    strength: "Strong",
  },
  {
    any: ["order_confirmation"],
    title: "Complete order record",
    description: "Order details confirm items, amount, and customer identity.",
    strength: "Strong",
  },
  {
    any: ["activity_log"],
    title: "Customer activity consistent",
    description: "Repeat customer with prior successful purchases.",
    strength: "Supporting",
  },
  {
    any: ["customer_account_info"],
    title: "Established customer profile",
    description: "Account history supports a legitimate customer.",
    strength: "Supporting",
  },
  {
    any: ["customer_communication"],
    title: "Customer engagement",
    description: "Customer was actively engaged through the order timeline.",
    strength: "Supporting",
  },
  {
    any: ["product_description"],
    title: "Product as described",
    description: "Product was advertised exactly as delivered.",
    strength: "Supporting",
  },
  {
    any: ["refund_policy", "shipping_policy", "cancellation_policy"],
    title: "Store policies disclosed",
    description: "Refund, shipping, and cancellation policies were clearly disclosed at purchase.",
    strength: "Supporting",
  },
  {
    any: ["duplicate_explanation"],
    title: "Charges are distinct",
    description: "Each charge is documented as a separate, non-duplicate transaction.",
    strength: "Strong",
  },
  {
    any: ["ip_location_check"],
    title: "Purchase location consistent",
    description: "Purchase location is consistent with the cardholder.",
    strength: "Helpful",
  },
  {
    any: ["device_session_consistency"],
    title: "Consistent device signals",
    description: "Device and session signals match a legitimate purchase.",
    strength: "Helpful",
  },
  {
    any: ["supporting_documents"],
    title: "Additional documentation",
    description: "Supplementary documents reinforce the overall defense.",
    strength: "Helpful",
  },
];

function strengthTone(s: DefenseReason["strength"]): "success" | "warning" | undefined {
  if (s === "Strong") return "success";
  if (s === "Supporting") return "warning";
  return undefined;
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

/** Synthesize a one-paragraph case description from the present defense reasons. */
function synthesizeHeroDescription(activeReasons: DefenseReason[]): string {
  if (activeReasons.length === 0) {
    return "Evidence collection is in progress. Add evidence to strengthen the defense.";
  }
  const fragments: string[] = [];
  if (activeReasons.some((r) => r.any.includes("avs_cvv_match") || r.any.includes("billing_address_match"))) {
    fragments.push("payment verification passed");
  }
  if (activeReasons.some((r) => r.any.includes("delivery_proof") || r.any.includes("shipping_tracking"))) {
    fragments.push("delivery was confirmed with tracking");
  }
  if (activeReasons.some((r) => r.any.includes("activity_log") || r.any.includes("customer_account_info"))) {
    fragments.push("customer activity is consistent with a legitimate purchase");
  }
  if (fragments.length === 0) {
    fragments.push("supporting evidence has been collected");
  }
  return `This dispute has strong evidence supporting authorization. ${fragments
    .map((f, i) => (i === 0 ? f.charAt(0).toUpperCase() + f.slice(1) : f))
    .join(", ")}.`;
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

export default function OverviewTab({ workspace }: { workspace: Workspace }) {
  const { data, derived, actions, clientState } = workspace;
  if (!data) return null;

  const { dispute } = data;
  const { caseStrength, effectiveChecklist, isReadOnly } = derived;

  // System failure short-circuit (preserved).
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

  // Auto-save denied banner (preserved).
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

  // Hero card (Likely to win / Could win / Hard to win)
  const strengthKey = caseStrength.overall;
  const confidence = CONFIDENCE_BY_STRENGTH[strengthKey] ?? CONFIDENCE_BY_STRENGTH.weak;

  const presentItems = effectiveChecklist.filter((c) => c.status === "available");
  const presentFields = new Set(presentItems.map((p) => p.field));

  // Active defense reasons — only those backed by present evidence.
  const activeReasons = DEFENSE_REASONS.filter((r) =>
    r.any.some((f) => presentFields.has(f)),
  );

  const heroDescription = synthesizeHeroDescription(activeReasons);

  const goToReview = () => actions.setActiveTab(2);
  const goToEvidence = () => actions.setActiveTab(1);

  // Coverage by priority bucket.
  type Bucket = "critical" | "recommended" | "optional";
  const buckets: Bucket[] = ["critical", "recommended", "optional"];
  const bucketLabel: Record<Bucket, string> = {
    critical: "Critical evidence",
    recommended: "Supporting evidence",
    optional: "Optional",
  };
  const bucketDot: Record<Bucket, string> = {
    critical: "#DC2626",
    recommended: "#D97706",
    optional: "#9CA3AF",
  };

  const visibleChecklist = effectiveChecklist.filter((c) => c.status !== "unavailable");
  const totalIncluded = visibleChecklist.filter((c) => c.status === "available" || c.status === "waived").length;
  const totalCount = visibleChecklist.length;

  const bucketStats = buckets.map((b) => {
    const items = visibleChecklist.filter((c) => (c.priority as string) === b);
    const complete = items.filter((c) => c.status === "available" || c.status === "waived").length;
    return { bucket: b, complete, total: items.length };
  }).filter((row) => row.total > 0);

  const coveragePct = totalCount > 0 ? Math.round((totalIncluded / totalCount) * 100) : 0;

  // Timeline steps.
  type TimelineStep = {
    state: "done" | "active" | "pending";
    title: string;
    helper: string;
  };

  const timeline: TimelineStep[] = submitted
    ? [
        {
          state: "done",
          title: "Evidence submitted",
          helper: submittedAt
            ? `Submitted to Shopify on ${formatDate(submittedAt)}`
            : "Submitted to Shopify",
        },
        {
          state: "active",
          title: "Bank review in progress",
          helper: "Expected duration: 30–75 days",
        },
        {
          state: "pending",
          title: "Outcome notification",
          helper: "You’ll be notified by email when a decision is made",
        },
      ]
    : [
        {
          state: data.pack ? "done" : "active",
          title: "Evidence pack built",
          helper: data.pack
            ? "DisputeDesk assembled the evidence available for this case."
            : "Generate the evidence pack to begin.",
        },
        {
          state: data.pack ? "active" : "pending",
          title: "Review and submit",
          helper: dispute.dueAt
            ? `Submission deadline: ${formatDate(dispute.dueAt)}`
            : "Review the pack and submit to Shopify before the deadline.",
        },
        {
          state: "pending",
          title: "Bank review",
          helper: "Once submitted, the issuing bank typically responds within 30–75 days.",
        },
      ];

  return (
    <BlockStack gap="400">
      {/* AUTO-SUBMIT DENIED (preserved) */}
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
            <InlineStack gap="200">
              <Button onClick={goToEvidence}>Add missing evidence</Button>
              <Button variant="primary" onClick={goToReview}>Submit now anyway</Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      )}

      {/* 1. HERO — "Likely to win" / "Could win" / "Hard to win" (Figma: bg #F0FDF4, border-2 #86EFAC) */}
      <div
        style={{
          background: confidence.bg,
          border: `2px solid ${confidence.border}`,
          borderRadius: 8,
          padding: 24,
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 8,
            background: confidence.iconBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: confidence.iconColor,
            flexShrink: 0,
          }}
        >
          <Icon source={ShieldCheckMarkIcon} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: confidence.titleColor, lineHeight: 1.3 }}>
              {confidence.title}
            </span>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                background: confidence.pillBg,
                color: confidence.pillColor,
              }}
            >
              {`${confidence.pct}% confidence`}
            </span>
          </div>
          <p style={{ fontSize: 14, color: confidence.bodyColor, margin: 0, lineHeight: 1.5 }}>
            {heroDescription}
          </p>
        </div>
      </div>

      {/* 2. WHAT HAPPENS NOW timeline */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">What happens now</Text>
          <BlockStack gap="300">
            {timeline.map((step, i) => {
              const isLast = i === timeline.length - 1;
              const dotBg =
                step.state === "done"
                  ? "#D1FAE5"
                  : step.state === "active"
                    ? "#DBEAFE"
                    : "#F1F2F4";
              const dotColor =
                step.state === "done"
                  ? "#22C55E"
                  : step.state === "active"
                    ? "#1D4ED8"
                    : "#6B7280";
              const iconSrc =
                step.state === "done"
                  ? CheckCircleIcon
                  : step.state === "active"
                    ? ClockIcon
                    : null;

              return (
                <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 999,
                        background: dotBg,
                        color: dotColor,
                        border: "2px solid #FFFFFF",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        zIndex: 1,
                      }}
                    >
                      {iconSrc ? (
                        <span style={{ width: 16, height: 16, display: "inline-flex" }}>
                          <Icon source={iconSrc} />
                        </span>
                      ) : (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: "#8C9196",
                          }}
                        />
                      )}
                    </div>
                    {!isLast && (
                      <div
                        style={{
                          width: 2,
                          flex: 1,
                          minHeight: 24,
                          background: "#E1E3E5",
                          marginTop: 0,
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 4, paddingBottom: isLast ? 0 : 16 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: step.state === "pending" ? "#6D7175" : "#202223", margin: 0 }}>
                      {step.title}
                    </p>
                    <p style={{ fontSize: 12, color: "#6D7175", margin: "2px 0 0" }}>{step.helper}</p>
                  </div>
                </div>
              );
            })}
          </BlockStack>
        </BlockStack>
      </div>

      {/* 3. WHY THIS CASE IS DEFENSIBLE */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Why this case is defensible</Text>
          {activeReasons.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Evidence is still being collected. Add evidence to surface defense reasons.
            </Text>
          ) : (
            <div>
              {activeReasons.map((r, i) => {
                const isLast = i === activeReasons.length - 1;
                return (
                  <div
                    key={r.title}
                    style={{
                      display: "flex",
                      gap: 16,
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      paddingBottom: isLast ? 0 : 16,
                      marginBottom: isLast ? 0 : 16,
                      borderBottom: isLast ? "none" : "1px solid #E1E3E5",
                    }}
                  >
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                      <span style={{ width: 20, height: 20, color: "#059669", flexShrink: 0, marginTop: 2 }}>
                        <Icon source={CheckCircleIcon} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 500, color: "#202223", margin: "0 0 4px" }}>
                          {r.title}
                        </p>
                        <p style={{ fontSize: 12, color: "#6D7175", margin: 0 }}>{r.description}</p>
                      </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <Badge tone={strengthTone(r.strength)}>{r.strength}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </BlockStack>
      </div>

      {/* 4. EVIDENCE COVERAGE */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Evidence coverage</Text>

          <div>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="bodySm" tone="subdued">Coverage completeness</Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {`${totalIncluded}/${totalCount} included`}
              </Text>
            </InlineStack>
            <div
              style={{
                marginTop: 6,
                height: 6,
                background: "#F1F2F4",
                borderRadius: 9999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${coveragePct}%`,
                  height: "100%",
                  background: coveragePct >= 80 ? "#22C55E" : coveragePct >= 50 ? "#F59E0B" : "#DC2626",
                  borderRadius: 9999,
                }}
              />
            </div>
          </div>

          <div style={{ paddingTop: 12, borderTop: "1px solid #E1E3E5" }}>
            <BlockStack gap="300">
              {bucketStats.map((row) => (
                <InlineStack key={row.bucket} align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 9999,
                        background: bucketDot[row.bucket],
                        display: "inline-block",
                      }}
                    />
                    <Text as="span" variant="bodyMd">{bucketLabel[row.bucket]}</Text>
                  </InlineStack>
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {row.complete === row.total
                      ? `${row.complete}/${row.total} complete`
                      : `${row.complete}/${row.total}`}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
          </div>
        </BlockStack>
      </div>

      {/* PRE-SUBMIT CTA — only when not yet submitted, low-emphasis. */}
      {!submitted && (
        <InlineStack gap="200" align="end">
          <Button onClick={goToEvidence} icon={AlertCircleIcon}>
            Edit evidence
          </Button>
          <Button variant="primary" onClick={goToReview} icon={ShieldCheckMarkIcon}>
            Review &amp; submit
          </Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}
