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

import { useMemo } from "react";
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
import type {
  CounterclaimNode,
  WhyWinsItem,
} from "@/lib/argument/types";
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

/* ── §3.E empty-state taxonomy resolver ── */

type TaxonomyState = "Present" | "Missing" | "System unavailable" | "Waived" | "Not applicable";

function taxonomyForChecklistItem(item: ChecklistItemV2): TaxonomyState {
  if (item.status === "available") return "Present";
  if (item.status === "waived") return "Waived";
  if (item.status === "missing") {
    // `auto` and `conditional_auto` collection types come from system
    // integrations. When still missing, the source can't supply it
    // (e.g. IPinfo returned bankEligible=false, or no card payment so
    // AVS/CVV doesn't apply). `unavailable` means no integration can
    // collect this — also a system constraint, not a merchant gap.
    if (item.collectionType === "auto" || item.collectionType === "conditional_auto" || item.collectionType === "unavailable") {
      return "System unavailable";
    }
    return "Missing";
  }
  return "Missing";
}

const TAXONOMY_TONE: Record<TaxonomyState, "success" | "critical" | "warning" | "attention" | undefined> = {
  Present: "success",
  Missing: "critical",
  Waived: undefined,
  "System unavailable": undefined,
  "Not applicable": undefined,
};

/* ── Component ── */

export default function OverviewTab({ workspace }: { workspace: Workspace }) {
  const searchParams = useSearchParams();
  const { data, derived, actions, clientState } = workspace;

  // ID-keyed counterclaim lookup — declared at the top so the hook
  // call order is stable across every render (rules-of-hooks). The
  // factory tolerates `data === null` by returning an empty map.
  const counterclaimsById: Record<string, CounterclaimNode> = useMemo(() => {
    const argMap = data?.argumentMap;
    if (argMap?.counterclaimsById) return argMap.counterclaimsById;
    const map: Record<string, CounterclaimNode> = {};
    for (const c of argMap?.counterclaims ?? []) map[c.id] = c;
    return map;
  }, [data?.argumentMap]);

  if (!data) return null;

  const { dispute, appliedRule } = data;
  const {
    caseStrength,
    effectiveChecklist,
    isReadOnly,
    recommendationText,
    recommendationHelperText,
    whyWins,
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

  /* ── O3 row resolution: ID-keyed only ── */
  type RowEvidence = { evidenceFieldKey: string; label: string; status: "available" | "waived" | "missing" };
  function resolveSupportingRows(item: WhyWinsItem): RowEvidence[] {
    const cc = counterclaimsById[item.counterclaimId];
    if (!cc) return [];
    return cc.supporting.map((s) => ({
      evidenceFieldKey: s.evidenceFieldKey ?? s.field,
      label: s.label,
      status: s.status,
    }));
  }
  function resolveMissingRows(item: WhyWinsItem): RowEvidence[] {
    const cc = counterclaimsById[item.counterclaimId];
    if (!cc) return [];
    return cc.missing.map((m) => ({
      evidenceFieldKey: m.evidenceFieldKey ?? m.field,
      label: m.label,
      status: "missing" as const,
    }));
  }

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

      {/* O1: Hero — strict backend rendering (label + score + strengthReason + improvementHint + recommendation + helper + EVIDENCE_EVALUATION_HELPER + deadline) */}
      <div
        style={{
          background: heroTone.bg,
          border: `2px solid ${heroTone.border}`,
          borderRadius: 8,
          padding: 24,
          display: "flex",
          alignItems: "flex-start",
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
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: heroTone.titleColor, lineHeight: 1.3 }}>
              {strengthLabel}
            </span>
            <span
              style={{
                padding: "2px 8px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: heroTone.pillBg, color: heroTone.pillColor,
              }}
            >
              {`Evidence coverage: ${caseStrength.score}/100`}
            </span>
          </div>
          {caseStrength.strengthReason && (
            <p style={{ fontSize: 14, color: heroTone.bodyColor, margin: "0 0 8px", lineHeight: 1.5 }}>
              {caseStrength.strengthReason}
            </p>
          )}
          {caseStrength.improvementHint && (
            <p style={{ fontSize: 13, color: heroTone.bodyColor, opacity: 0.8, margin: "0 0 12px", lineHeight: 1.5 }}>
              {caseStrength.improvementHint}
            </p>
          )}
          {recommendationText && (
            <p style={{ fontSize: 14, color: heroTone.bodyColor, margin: "0 0 4px", lineHeight: 1.5, fontWeight: 500 }}>
              {recommendationText}
            </p>
          )}
          {recommendationHelperText && (
            <p style={{ fontSize: 13, color: heroTone.bodyColor, opacity: 0.7, margin: "0 0 12px", lineHeight: 1.5 }}>
              {recommendationHelperText}
            </p>
          )}
          <p style={{ fontSize: 12, color: heroTone.bodyColor, opacity: 0.7, margin: "0 0 8px", lineHeight: 1.5 }}>
            {EVIDENCE_EVALUATION_HELPER}
          </p>
          <p style={{ fontSize: 13, color: heroTone.bodyColor, margin: 0 }}>
            {submitted
              ? `Submitted ${formatDate(submittedAt)}`
              : deadlineDays !== null && deadlineDays > 0
                ? `Submission deadline in ${deadlineDays} day${deadlineDays === 1 ? "" : "s"} (${formatDate(dispute.dueAt)})${deadlineUrgent ? " — urgent" : ""}`
                : deadlineDays !== null && deadlineDays <= 0
                  ? `Submission deadline: Overdue (${formatDate(dispute.dueAt)})`
                  : "No deadline set"}
          </p>
        </div>
      </div>

      {/* O2: Timeline */}
      <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">What happens now</Text>
          <BlockStack gap="300">
            {timeline.map((step, i) => {
              const isLast = i === timeline.length - 1;
              const dotBg = step.state === "done" ? "#D1FAE5" : step.state === "active" ? "#DBEAFE" : "#F1F2F4";
              const dotColor = step.state === "done" ? "#059669" : step.state === "active" ? "#1D4ED8" : "#6B7280";
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

      {/* O3: What supports your case (whyWins.strengths resolved by counterclaimId) */}
      <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">What supports your case</Text>
          {whyWins.strengths.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Evidence is still being collected. Add evidence to surface defense reasons.
            </Text>
          ) : (
            <div>
              {whyWins.strengths.map((s, idx) => {
                const cc = counterclaimsById[s.counterclaimId];
                const supportingRows = resolveSupportingRows(s);
                const isLast = idx === whyWins.strengths.length - 1;
                return (
                  <div
                    key={s.counterclaimId + s.text}
                    style={{
                      paddingBottom: isLast ? 0 : 16,
                      marginBottom: isLast ? 0 : 16,
                      borderBottom: isLast ? "none" : "1px solid #E1E3E5",
                    }}
                  >
                    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                        <span style={{ width: 20, height: 20, color: "#059669", flexShrink: 0, marginTop: 2 }}>
                          <Icon source={CheckCircleIcon} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 500, color: "#202223", margin: "0 0 4px" }}>
                            {s.text}
                          </p>
                          {/* Per-evidence raw breakdown — every supporting field
                              with its taxonomy state from §3.E. */}
                          {supportingRows.length > 0 && (
                            <BlockStack gap="050">
                              {supportingRows.map((row) => {
                                const checklist = effectiveChecklist.find((c) => c.field === row.evidenceFieldKey);
                                const tax: TaxonomyState = checklist
                                  ? taxonomyForChecklistItem(checklist)
                                  : "Present";
                                return (
                                  <InlineStack key={row.evidenceFieldKey} gap="200" blockAlign="center" wrap>
                                    <Text as="span" variant="bodySm" tone="subdued">{row.label}:</Text>
                                    <Badge tone={TAXONOMY_TONE[tax]}>{tax}</Badge>
                                  </InlineStack>
                                );
                              })}
                            </BlockStack>
                          )}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        {cc ? <Badge tone={cc.strength === "strong" ? "success" : cc.strength === "moderate" ? "warning" : "critical"}>{cc.strength}</Badge> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Missing signals — never silently dropped */}
          {whyWins.weaknesses.length > 0 && (
            <BlockStack gap="200">
              <Divider />
              <Text as="p" variant="bodySm" fontWeight="semibold">Missing signals</Text>
              {whyWins.weaknesses.map((w) => {
                const missingRows = resolveMissingRows(w);
                return (
                  <div key={w.counterclaimId + w.text} style={{ paddingLeft: 32 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: "#7F1D1D", margin: "0 0 4px" }}>{w.text}</p>
                    {missingRows.length > 0 && (
                      <BlockStack gap="050">
                        {missingRows.map((row) => {
                          const checklist = effectiveChecklist.find((c) => c.field === row.evidenceFieldKey);
                          const tax: TaxonomyState = checklist ? taxonomyForChecklistItem(checklist) : "Missing";
                          return (
                            <InlineStack key={row.evidenceFieldKey} gap="200" blockAlign="center" wrap>
                              <Text as="span" variant="bodySm" tone="subdued">{row.label}:</Text>
                              <Badge tone={TAXONOMY_TONE[tax]}>{tax}</Badge>
                              {!submitted && tax === "Missing" && (
                                <Button size="micro" onClick={() => actions.navigateToEvidence(row.evidenceFieldKey)}>
                                  Add this evidence
                                </Button>
                              )}
                            </InlineStack>
                          );
                        })}
                      </BlockStack>
                    )}
                  </div>
                );
              })}
            </BlockStack>
          )}
        </BlockStack>
      </div>

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
