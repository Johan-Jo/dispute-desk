"use client";

/**
 * Dispute detail — Overview tab.
 *
 * Strict implementation of plan v3 §2.1. Every rendered value comes
 * from a backend output (`derived.*`, `data.*`, or a function in
 * `lib/argument/`); nothing is synthesized in this component. Cross-
 * collection references resolve through stable IDs only — never by
 * label, title, or array position.
 *
 * No client-side strength classification. No summary-only rendering.
 * Empty/missing values surface with one of the §3.E taxonomy states:
 * Present / Missing / Not applicable / System unavailable / Waived.
 */

import {
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Icon,
  Divider,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import { EVIDENCE_EVALUATION_HELPER } from "@/lib/argument/evidenceStatus";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import { categoryBadge, classifyEvidenceRow } from "@/lib/argument/categoryBadge";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/* ── Failure copy (merchant-safe) ── */

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

/* ── 1:1 mappings from backend categorical → display labels ── */

const HERO_LABEL_BY_STRENGTH: Record<string, string> = {
  strong: "Likely to win",
  moderate: "Could win",
  weak: "Hard to win",
  insufficient: "Hard to win",
};

const HERO_TONE_BY_STRENGTH: Record<
  string,
  { bg: string; border: string; iconBg: string; iconColor: string; titleColor: string; bodyColor: string; pillBg: string; pillColor: string }
> = {
  strong: {
    bg: "#F0FDF4", border: "#86EFAC", iconBg: "#D1FAE5", iconColor: "#059669",
    titleColor: "#065F46", bodyColor: "#065F46", pillBg: "#D1FAE5", pillColor: "#065F46",
  },
  moderate: {
    bg: "#FFFBEB", border: "#FDE68A", iconBg: "#FEF3C7", iconColor: "#D97706",
    titleColor: "#78350F", bodyColor: "#92400E", pillBg: "#FEF3C7", pillColor: "#92400E",
  },
  weak: {
    bg: "#FEF2F2", border: "#FCA5A5", iconBg: "#FEE2E2", iconColor: "#DC2626",
    titleColor: "#7F1D1D", bodyColor: "#991B1B", pillBg: "#FEE2E2", pillColor: "#991B1B",
  },
  insufficient: {
    bg: "#FEF2F2", border: "#FCA5A5", iconBg: "#FEE2E2", iconColor: "#DC2626",
    titleColor: "#7F1D1D", bodyColor: "#991B1B", pillBg: "#FEE2E2", pillColor: "#991B1B",
  },
};

/* ── Pure helpers ── */

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

/* ── Component ── */

export default function OverviewTab({ workspace }: { workspace: Workspace }) {
  const searchParams = useSearchParams();
  const { data, derived, actions, clientState } = workspace;

  if (!data) return null;

  const { dispute, appliedRule } = data;
  const {
    caseStrength,
    effectiveChecklist,
    isReadOnly,
    recommendationText,
    recommendationHelperText,
    contributions,
    missingItems,
  } = derived;

  /* ── F1: Failure short-circuit ── */
  if (derived.isFailed) {
    const copy = (derived.failureCode && FAILURE_COPY[derived.failureCode]) || FAILURE_FALLBACK;
    return (
      <BlockStack gap="400">
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

  /* ── F2: Auto-save denied banner ── */
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

  /* ── Hero ── */
  const strengthKey = caseStrength.overall;
  const strengthLabel = HERO_LABEL_BY_STRENGTH[strengthKey] ?? "Hard to win";
  const heroTone = HERO_TONE_BY_STRENGTH[strengthKey] ?? HERO_TONE_BY_STRENGTH.weak;

  /* ── Timeline ── */
  type TimelineStep = { state: "done" | "active" | "pending"; title: string; helper: string };
  const timeline: TimelineStep[] = submitted
    ? [
        { state: "done", title: "Evidence submitted", helper: submittedAt ? `Submitted to Shopify on ${formatDate(submittedAt)}` : "Submitted to Shopify" },
        { state: dispute.finalOutcome ? "done" : "active", title: "Bank review in progress", helper: "Expected duration: 30–75 days" },
        {
          state: dispute.finalOutcome ? "done" : "pending",
          title: "Outcome notification",
          helper: dispute.finalOutcome
            ? `Outcome: ${dispute.finalOutcome}`
            : "You’ll be notified by email when a decision is made",
        },
      ]
    : [
        { state: data.pack ? "done" : "active", title: "Evidence pack built", helper: data.pack ? "DisputeDesk assembled the evidence available for this case." : "Generate the evidence pack to begin." },
        { state: data.pack ? "active" : "pending", title: "Review and submit", helper: dispute.dueAt ? `Submission deadline: ${formatDate(dispute.dueAt)}` : "Review the pack and submit to Shopify before the deadline." },
        { state: "pending", title: "Bank review", helper: "Once submitted, the issuing bank typically responds within 30–75 days." },
      ];

  /* ── O4 Coverage breakdown by priority ── */
  const visibleChecklist = effectiveChecklist.filter((c) => c.status !== "unavailable");
  const completenessScore = data.pack?.completenessScore ?? 0;
  type Bucket = { key: "critical" | "recommended" | "optional"; label: string; items: ChecklistItemV2[]; complete: number };
  const buckets: Bucket[] = (["critical", "recommended", "optional"] as const).map((key) => {
    const items = visibleChecklist.filter((c) => (c.priority as string) === key);
    const complete = items.filter((c) => c.status === "available" || c.status === "waived").length;
    return {
      key,
      label: key === "critical" ? "Critical evidence" : key === "recommended" ? "Supporting evidence" : "Optional",
      items,
      complete,
    };
  }).filter((b) => b.items.length > 0);
  const criticalMissing = (buckets.find((b) => b.key === "critical")?.items ?? []).filter(
    (c) => c.status === "missing",
  );
  const totalIncluded = visibleChecklist.filter((c) => c.status === "available" || c.status === "waived").length;
  const totalCount = visibleChecklist.length;

  /* ── Automation rule + Footer CTAs ── */
  const disputeFamily = mapReasonToRulesFamily(dispute.reason);
  const rulesUrl = withShopParams(`/app/rules?family=${disputeFamily}`, searchParams);
  const appliedMode = appliedRule?.mode ?? "review";
  const appliedModeLabel = appliedMode === "auto" ? "Automatic" : "Review before submit";
  const appliedModeHelp = appliedMode === "auto"
    ? "DisputeDesk prepared the evidence pack and submitted it automatically."
    : "DisputeDesk prepared the evidence pack for you. Review it and submit before the deadline.";

  const goToReview = () => actions.setActiveTab(2);
  const goToEvidence = () => actions.setActiveTab(1);
  const shopifyAdminUrl = dispute.shopDomain && dispute.disputeEvidenceGid
    ? getShopifyDisputeUrl(dispute.shopDomain, dispute.disputeEvidenceGid)
    : null;

  // Post-submit secondary CTA — surface only when there's an actual
  // policy gap on this case.
  const POLICY_FIELDS = new Set(["refund_policy", "shipping_policy", "cancellation_policy"]);
  const hasMissingPolicy = missingItems.some((m) => POLICY_FIELDS.has(m.field));
  const policyCta = submitted && hasMissingPolicy
    ? { label: "Set up policies for future cases", url: withShopParams("/app/policies", searchParams) }
    : null;

  return (
    <BlockStack gap="400">
      {/* F2: Auto-save denied banner — preserved from existing logic */}
      {autoSaveBlock && (
        <Banner tone="warning" title="Auto-submit paused — your review needed">
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              DisputeDesk builds your defense automatically, but only auto-submits when the
              pack meets your auto-submit threshold. This pack didn’t clear the bar, so
              we stopped and handed it to you.
            </Text>
            {autoSaveBlock.reasons.length > 0 && (
              <Text as="p" variant="bodySm">Why: {autoSaveBlock.reasons.join(" • ")}</Text>
            )}
            <InlineStack gap="200">
              <Button onClick={goToEvidence}>Add missing evidence</Button>
              <Button variant="primary" onClick={goToReview}>Submit now anyway</Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      )}

      {/* O1: Hero — minimal per Figma: label + confidence pill + 1-line summary.
          Recommendation / improvement / helper / deadline copy moves to the
          dedicated Recommendation card below. */}
      <div
        style={{
          background: heroTone.bg,
          border: `1px solid ${heroTone.border}`,
          borderRadius: 8,
          padding: 24,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 48, height: 48, borderRadius: 8,
            background: heroTone.iconBg, color: heroTone.iconColor,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon source={ShieldCheckMarkIcon} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: heroTone.titleColor, lineHeight: 1.2 }}>
              {strengthLabel}
            </span>
            <span
              style={{
                padding: "2px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: heroTone.pillBg, color: heroTone.pillColor,
              }}
            >
              {`${caseStrength.coveragePercent}% evidence collected`}
            </span>
          </div>
          {caseStrength.strengthReason && (
            <p style={{ fontSize: 14, color: heroTone.bodyColor, margin: 0, lineHeight: 1.5, opacity: 0.85 }}>
              {caseStrength.strengthReason}
            </p>
          )}
        </div>
      </div>

      {/* O2: Timeline — step titles colored per state (green/blue/gray) per Figma */}
      <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">What happens now</Text>
          <BlockStack gap="300">
            {timeline.map((step, i) => {
              const isLast = i === timeline.length - 1;
              const dotBg = step.state === "done" ? "#D1FAE5" : step.state === "active" ? "#DBEAFE" : "#F1F2F4";
              const dotColor = step.state === "done" ? "#059669" : step.state === "active" ? "#1D4ED8" : "#6B7280";
              const titleColor = step.state === "done" ? "#059669" : step.state === "active" ? "#1E40AF" : "#6D7175";
              const iconSrc = step.state === "done" ? CheckCircleIcon : step.state === "active" ? ClockIcon : null;
              return (
                <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                    <div
                      style={{
                        width: 32, height: 32, borderRadius: 999,
                        background: dotBg, color: dotColor,
                        border: "2px solid #FFFFFF",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {iconSrc ? (
                        <span style={{ width: 16, height: 16, display: "inline-flex" }}>
                          <Icon source={iconSrc} />
                        </span>
                      ) : (
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: "#8C9196" }} />
                      )}
                    </div>
                    {!isLast && (
                      <div style={{ width: 2, flex: 1, minHeight: 24, background: "#E1E3E5" }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 4, paddingBottom: isLast ? 0 : 16 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: titleColor, margin: 0 }}>
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

      {/* Recommendation card — preserves the merchant-action copy that
          was previously stuffed into the hero. Stays compact and below
          the timeline so the hero matches Figma's minimal design. */}
      {(recommendationText || caseStrength.improvementHint || dispute.dueAt) && (
        <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
          <BlockStack gap="200">
            {recommendationText && (
              <Text as="p" variant="bodyMd" fontWeight="semibold">{recommendationText}</Text>
            )}
            {recommendationHelperText && (
              <Text as="p" variant="bodySm" tone="subdued">{recommendationHelperText}</Text>
            )}
            {caseStrength.improvementHint && (
              <Text as="p" variant="bodySm" tone="subdued">{caseStrength.improvementHint}</Text>
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              {submitted
                ? `Submitted ${formatDate(submittedAt)}`
                : deadlineDays !== null && deadlineDays > 0
                  ? `Submission deadline in ${deadlineDays} day${deadlineDays === 1 ? "" : "s"} (${formatDate(dispute.dueAt)})${deadlineUrgent ? " — urgent" : ""}`
                  : deadlineDays !== null && deadlineDays <= 0
                    ? `Submission deadline: Overdue (${formatDate(dispute.dueAt)})`
                    : "No deadline set"}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">{EVIDENCE_EVALUATION_HELPER}</Text>
          </BlockStack>
        </div>
      )}

      {/* O3: What supports your case — one row per canonical signalId
          (plan v3 §P2.6 Argument Purity Rule). Iterates
          `derived.contributions.strong[]` then `.moderate[]`. NO
          counterclaim title resolution, NO text matching, NO summary
          rows that fold multiple signals. Supporting items are
          excluded from this surface entirely (P2.6a Field Visibility
          Decision — they appear in the Evidence tab only). */}
      <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">What supports your case</Text>
          {contributions.strong.length === 0 && contributions.moderate.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              No strong or moderate evidence collected yet. Add evidence to surface defense reasons.
            </Text>
          ) : (
            <BlockStack gap="200">
              {[...contributions.strong, ...contributions.moderate].map((row) => {
                const isStrong = row.category === "strong";
                const pillLabel = isStrong ? "Strong" : "Moderate";
                const pillBg = isStrong ? "#D1FAE5" : "#FEF3C7";
                const pillColor = isStrong ? "#065F46" : "#92400E";
                return (
                  <div
                    key={row.signalId}
                    style={{
                      background: "#F6F8FB",
                      border: "1px solid #E1E3E5",
                      borderRadius: 8,
                      padding: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span style={{ width: 20, height: 20, color: "#059669", flexShrink: 0 }}>
                      <Icon source={CheckCircleIcon} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "#202223", margin: 0 }}>
                        {row.label}
                      </p>
                    </div>
                    <span
                      style={{
                        flexShrink: 0,
                        padding: "2px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        background: pillBg,
                        color: pillColor,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pillLabel}
                    </span>
                  </div>
                );
              })}
            </BlockStack>
          )}

          {/* Missing signals — drawn directly from the canonical
              registry (no whyWins.weaknesses lookup). A field surfaces
              here only when its DEFAULT category is strong or moderate
              AND it is missing AND it's merchant-actionable.
              Supporting fields are excluded — they don't affect
              strength so prompting the merchant to add them would be
              misleading. */}
          {(() => {
            const missingActionable = effectiveChecklist.filter((c) => {
              if (c.status !== "missing") return false;
              if (c.collectionType && c.collectionType !== "manual") return false;
              const spec = c.field as string;
              const cat = (data.pack?.evidenceItemsByField && spec in data.pack.evidenceItemsByField)
                ? null
                : null; // missing items have no payload — fall through to default category
              void cat;
              return true;
            }).filter((c) => {
              // Only show missing rows whose default category would
              // be strong or moderate (would actually help the case).
              const fieldKey = c.field;
              // Resolved via canonical registry — supporting fields skipped.
              const spec = (CANONICAL_EVIDENCE as Record<string, { category: string } | undefined>)[fieldKey];
              return spec?.category === "strong" || spec?.category === "moderate";
            });
            if (missingActionable.length === 0) return null;
            return (
              <BlockStack gap="200">
                <Divider />
                <Text as="p" variant="bodySm" fontWeight="semibold">Missing signals</Text>
                {missingActionable.map((c) => {
                  const spec = (CANONICAL_EVIDENCE as Record<string, { label: string; category: string } | undefined>)[c.field];
                  const label = spec?.label ?? c.label;
                  return (
                    <div
                      key={c.field}
                      style={{
                        background: "#FEF2F2",
                        border: "1px solid #FCA5A5",
                        borderRadius: 8,
                        padding: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <span style={{ width: 20, height: 20, color: "#DC2626", flexShrink: 0 }}>
                        <Icon source={AlertCircleIcon} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: "#7F1D1D", margin: 0 }}>{label}</p>
                        {!submitted && (
                          <div style={{ marginTop: 8 }}>
                            <Button size="slim" onClick={() => actions.navigateToEvidence(c.field)}>
                              Add this evidence
                            </Button>
                          </div>
                        )}
                      </div>
                      <span
                        style={{
                          flexShrink: 0,
                          padding: "2px 10px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          background: "#FEE2E2",
                          color: "#991B1B",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Missing
                      </span>
                    </div>
                  );
                })}
              </BlockStack>
            );
          })()}
        </BlockStack>
      </div>

      {/* Evidence collected — shows everything in the pack, not just
          argument-winning signals. "What supports your case" above is
          intentionally limited to strong/moderate per the Argument
          Purity Rule (P2.6); supporting evidence still belongs on the
          Overview so a populated pack never reads as empty. */}
      {(() => {
        const collectedRows = effectiveChecklist
          .filter((c) => CANONICAL_EVIDENCE[c.field])
          .map((c) => {
            const spec = CANONICAL_EVIDENCE[c.field]!;
            const payload =
              (data.pack?.evidenceItemsByField?.[c.field]?.payload ?? null) as
                | Record<string, unknown>
                | null;
            const classification = classifyEvidenceRow({
              fieldKey: c.field,
              status: c.status,
              payload,
            });
            return { item: c, spec, classification };
          });
        const manualUploads = (data.attachments ?? []).filter(
          (a) => a.source === "manual_upload",
        );
        const hasAnything = collectedRows.length > 0 || manualUploads.length > 0;
        if (!hasAnything) return null;

        const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
          collected: { label: "Collected", bg: "#D1FAE5", color: "#065F46" },
          waived: { label: "Waived", bg: "#E5E7EB", color: "#374151" },
          missing: { label: "Missing", bg: "#FEE2E2", color: "#991B1B" },
          not_applicable: { label: "Not applicable", bg: "#F3F4F6", color: "#4B5563" },
        };
        const SOURCE_NOTE: Record<string, string> = {
          auto_shopify: "From Shopify order data",
          auto_policy: "From store policies",
          auto_ipinfo: "From IP intelligence",
          manual_upload: "Uploaded manually",
          unavailable_from_source: "Not available from source",
        };

        return (
          <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">Evidence collected</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  These items were collected for the evidence pack. Some strengthen the argument directly, while others support completeness, context, or Shopify submission fields.
                </Text>
              </BlockStack>

              <BlockStack gap="200">
                {collectedRows.map(({ item, spec, classification }) => {
                  const status = STATUS_BADGE[classification.status];
                  const strength = classification.category
                    ? categoryBadge(classification.category)
                    : null;
                  const sourceNote = SOURCE_NOTE[item.source ?? ""] ?? null;
                  return (
                    <div
                      key={item.field}
                      style={{
                        background: "#F6F8FB",
                        border: "1px solid #E1E3E5",
                        borderRadius: 8,
                        padding: 14,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: "#202223", margin: 0 }}>
                          {spec.label}
                        </p>
                        {sourceNote && (
                          <p style={{ fontSize: 12, color: "#6D7175", margin: "2px 0 0" }}>
                            {sourceNote}
                          </p>
                        )}
                      </div>
                      <InlineStack gap="200" blockAlign="center" wrap={false}>
                        {strength && (
                          <span
                            style={{
                              padding: "2px 10px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              background: strength.bg,
                              color: strength.color,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {strength.label}
                          </span>
                        )}
                        <span
                          style={{
                            padding: "2px 10px",
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: status.bg,
                            color: status.color,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {status.label}
                        </span>
                      </InlineStack>
                    </div>
                  );
                })}
              </BlockStack>

              {manualUploads.length > 0 && (
                <BlockStack gap="150">
                  <Divider />
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {`+${manualUploads.length} attached file${manualUploads.length === 1 ? "" : "s"} included`}
                  </Text>
                  <BlockStack gap="100">
                    {manualUploads.map((a) => (
                      <Text key={a.id} as="p" variant="bodySm" tone="subdued">
                        {a.fileName ?? a.label ?? "Attached file"}
                      </Text>
                    ))}
                  </BlockStack>
                </BlockStack>
              )}
            </BlockStack>
          </div>
        );
      })()}

      {/* O4: Evidence coverage */}
      <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Evidence coverage</Text>

          <div>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {criticalMissing.length === 0
                  ? "All critical evidence present"
                  : `${criticalMissing.length} critical ${criticalMissing.length === 1 ? "item" : "items"} missing`}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">{`${totalIncluded}/${totalCount} included`}</Text>
            </InlineStack>
            <div style={{ marginTop: 8, height: 6, background: "#E1E3E5", borderRadius: 9999, overflow: "hidden" }}>
              <div
                style={{
                  width: `${completenessScore}%`,
                  height: "100%",
                  background: strengthKey === "strong" ? "#059669" : strengthKey === "moderate" ? "#F59E0B" : "#DC2626",
                  borderRadius: 9999,
                }}
              />
            </div>
          </div>

          <div style={{ paddingTop: 12, borderTop: "1px solid #E1E3E5" }}>
            <BlockStack gap="200">
              {buckets.map((b) => (
                <InlineStack key={b.key} align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <span
                      style={{
                        width: 8, height: 8, borderRadius: 9999, display: "inline-block",
                        background: b.key === "critical" ? "#DC2626" : b.key === "recommended" ? "#D97706" : "#6D7175",
                      }}
                    />
                    <Text as="span" variant="bodyMd">{b.label}</Text>
                  </InlineStack>
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {`${b.complete}/${b.items.length} complete`}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>
          </div>

          <Button variant="plain" onClick={goToEvidence}>View all evidence</Button>
        </BlockStack>
      </div>

      {/* Automation rule card */}
      <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center">
              <Text as="p" variant="bodyMd" fontWeight="semibold">Automation rule:</Text>
              <Badge tone={appliedRule?.mode === "auto" ? "success" : appliedRule?.mode === "review" ? "attention" : undefined}>
                {appliedModeLabel}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">{appliedModeHelp}</Text>
          </BlockStack>
          <div style={{ marginLeft: "auto" }}>
            <Button url={rulesUrl}>Change rule</Button>
          </div>
        </InlineStack>
      </div>

      {/* Footer CTAs */}
      <InlineStack gap="200" align="end">
        {!submitted && (
          <>
            <Button onClick={goToEvidence} icon={AlertCircleIcon}>Edit evidence</Button>
            <Button variant="primary" onClick={goToReview} icon={ShieldCheckMarkIcon} size="large">
              Submit to Shopify
            </Button>
          </>
        )}
        {submitted && (
          <>
            {policyCta && <Button url={policyCta.url}>{policyCta.label}</Button>}
            {shopifyAdminUrl && (
              <Button variant="primary" url={shopifyAdminUrl} target="_blank" size="large">
                View in Shopify Admin
              </Button>
            )}
          </>
        )}
      </InlineStack>
    </BlockStack>
  );
}
