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
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import { EVIDENCE_EVALUATION_HELPER } from "@/lib/argument/evidenceStatus";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { PresentationStatus } from "../workspace-components/types";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import { resolveToken } from "@/lib/i18n/resolveToken";
import { classifyEvidenceRow } from "@/lib/argument/categoryBadge";
import { canMerchantUpload, type useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { LiabilityShiftPanel } from "@/components/liability-shift/LiabilityShiftPanel";
import { SubmissionSummaryPanel } from "./sections/SubmissionSummaryPanel";
import { MERCHANT_UI_HIDDEN_FIELDS } from "@/lib/automation/merchantUiHiddenFields";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/* ── 1:1 mappings from backend categorical → display labels ── */

/**
 * Hero label + tone are driven entirely by `caseStrength.heroVariant`
 * (set by the backend in `lib/argument/caseStrength.ts`). The four
 * variants:
 *   - `likely_to_win` — overall "strong"
 *   - `could_win` — overall "moderate" via the standard formula
 *   - `needs_strengthening` — fraud + avs_cvv_match Strong alone (one
 *     decisive signal but no corroboration). Same amber tone as
 *     could_win, different accent on what's required next.
 *   - `hard_to_win` — overall "weak" or "insufficient", no decisive
 *     signal collected
 */
type HeroVariant = "likely_to_win" | "could_win" | "needs_strengthening" | "hard_to_win" | "covered";

// Hero title + subtitle copy lives in messages/en.json under
// `disputes.overview.hero.*`. The component picks the right variant ×
// status combination at render time (see `resolveHeroTitle` /
// `resolveHeroSubtitle` inside the component) so the rule that
// "submitted to card network" / "sent to bank" never appears outside
// SUBMITTED_TO_NETWORK + CLOSED_* is enforced in one place.

const HERO_TONE_BY_VARIANT: Record<
  HeroVariant,
  { bg: string; border: string; iconBg: string; iconColor: string; titleColor: string; bodyColor: string; pillBg: string; pillColor: string }
> = {
  likely_to_win: {
    bg: "#F0FDF4", border: "#86EFAC", iconBg: "#D1FAE5", iconColor: "#059669",
    titleColor: "#065F46", bodyColor: "#065F46", pillBg: "#D1FAE5", pillColor: "#065F46",
  },
  could_win: {
    bg: "#FFFBEB", border: "#FDE68A", iconBg: "#FEF3C7", iconColor: "#D97706",
    titleColor: "#78350F", bodyColor: "#92400E", pillBg: "#FEF3C7", pillColor: "#92400E",
  },
  // Same amber palette as could_win — only the label differs.
  needs_strengthening: {
    bg: "#FFFBEB", border: "#FDE68A", iconBg: "#FEF3C7", iconColor: "#D97706",
    titleColor: "#78350F", bodyColor: "#92400E", pillBg: "#FEF3C7", pillColor: "#92400E",
  },
  hard_to_win: {
    bg: "#FEF2F2", border: "#FCA5A5", iconBg: "#FEE2E2", iconColor: "#DC2626",
    titleColor: "#7F1D1D", bodyColor: "#991B1B", pillBg: "#FEE2E2", pillColor: "#991B1B",
  },
  // Covered = Shopify Protect active. Distinct cool-blue palette so the
  // merchant immediately reads "no action" rather than green-go.
  covered: {
    bg: "#EFF6FF", border: "#BFDBFE", iconBg: "#DBEAFE", iconColor: "#1D4ED8",
    titleColor: "#1E3A8A", bodyColor: "#1E40AF", pillBg: "#DBEAFE", pillColor: "#1E40AF",
  },
};

/* ── Pure helpers ── */

/**
 * One cell of the Evidence-coverage legend strip (4 cells side by side
 * across the bottom of the card). Renders a coloured dot, "X of N",
 * a label, and a one-line helper. Borders are drawn on the right so
 * the cells stitch into a single dividerless row inside the card.
 */
function LegendCell({
  dot,
  count,
  total,
  ofTotalLabel,
  label,
  helper,
  borderRight,
}: {
  dot: string;
  count: number;
  total: number;
  ofTotalLabel: string;
  label: string;
  helper: string;
  borderRight?: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 14px 14px 32px",
        borderRight: borderRight ? "1px solid #E1E3E5" : "0",
        position: "relative",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 14,
          top: 18,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dot,
        }}
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, lineHeight: 1, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#202223",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
        <span style={{ fontSize: 11, color: "#6D7175", fontVariantNumeric: "tabular-nums" }}>
          {ofTotalLabel}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#202223", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: "#6D7175", lineHeight: 1.4 }}>
        {helper}
      </div>
    </div>
  );
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
  const t = useTranslations("disputes.overview");
  // Waive-reason enum labels live alongside the §3 Missing-or-weak
  // waive modal copy; reuse them here so the Overview row caption
  // matches the modal verbatim.
  const tEvidence = useTranslations("disputes.evidenceTab");
  const tExtra = useTranslations("disputes.overviewExtra");
  const tSignal = useTranslations("disputes.signalLabel");
  const tSource = useTranslations("disputes.sourceCaption");
  const tItemStrength = useTranslations("disputes.itemStrength");
  const tPill = useTranslations("disputes.overviewPill");
  // Root (unscoped) translator for token resolution — used to resolve
  // EvidenceLineItem.reasonToken at the internal-only row caption boundary.
  const tRoot = useTranslations();
  const { data, derived, actions, clientState } = workspace;

  if (!data) return null;

  const { dispute, appliedRule } = data;
  // Workspace API exposes presentationStatus on every fetch. Default to
  // DRAFT for the brief render window before the first response lands.
  const presentationStatus: PresentationStatus =
    (data.presentationStatus as PresentationStatus | undefined) ?? "DRAFT";
  const {
    caseStrength,
    strengthReasonText,
    improvementHintText,
    effectiveChecklist,
    isReadOnly,
    recommendationText,
    recommendationHelperText,
    missingItems,
  } = derived;

  /* ── F1: Failure short-circuit ── */
  if (derived.isFailed) {
    const failureCode = derived.failureCode;
    const titleKey = failureCode && (failureCode === "order_fetch_failed")
      ? `failureCopy.${failureCode}.title`
      : "failureCopyFallback.title";
    const bodyKey = failureCode && (failureCode === "order_fetch_failed")
      ? `failureCopy.${failureCode}.body`
      : "failureCopyFallback.body";
    return (
      <BlockStack gap="400">
        <Banner tone="critical" title={tExtra(titleKey)}>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">{tExtra(bodyKey)}</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {tExtra("retryHelp")}
            </Text>
            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={() => { void actions.generatePack(); }}
                disabled={clientState.retrying}
                loading={clientState.retrying}
              >
                {tExtra("retryBuild")}
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

  /* ── Hero ──
   *
   *  Title resolution: title family is picked from `presentationStatus`
   *  (DRAFT → preSubmit, SAVED_TO_SHOPIFY → saved,
   *  AWAITING_SHOPIFY_AUTO_SUBMISSION → awaiting,
   *  SUBMITTED_TO_NETWORK → submitted_to_network, CLOSED_* → closed).
   *  Inside the chosen family the variant key (`hard_to_win`, etc.)
   *  selects the actual string. Hard rule: card-network wording only
   *  reaches the title via the `submitted_to_network` and `closed`
   *  families — both of which are reachable only when Shopify exposes
   *  `evidenceSentOn` or a terminal `finalOutcome`. */
  // heroVariant is server-guaranteed by `calculateCaseStrength()` —
  // the type was made non-optional in lib/argument/types.ts so a
  // dropped field surfaces as a TypeScript error rather than a silent
  // "hard_to_win" degradation in the UI.
  const heroVariant: HeroVariant = caseStrength.heroVariant as HeroVariant;
  const heroTone = HERO_TONE_BY_VARIANT[heroVariant];

  function resolveHeroTitle(): string {
    switch (presentationStatus) {
      case "CLOSED_WON":
        return t("hero.title.closed.won");
      case "CLOSED_LOST":
        return t("hero.title.closed.lost");
      case "CLOSED_UNKNOWN":
        return t("hero.title.closed.unknown");
      case "SUBMITTED_TO_NETWORK":
        return t(`hero.title.submitted_to_network.${heroVariant}`);
      case "AWAITING_SHOPIFY_AUTO_SUBMISSION":
        return t(`hero.title.awaiting.${heroVariant}`);
      case "SAVED_TO_SHOPIFY":
        return t(`hero.title.saved.${heroVariant}`);
      case "DRAFT":
      default:
        return t(`hero.title.preSubmit.${heroVariant}`);
    }
  }
  const strengthLabel = resolveHeroTitle();

  function resolveHeroSubtitle(): string | null {
    const reason = (strengthReasonText ?? "").trim();
    const savedDate = formatDate(submittedAt);
    const deadline = dispute.dueAt ? formatDate(dispute.dueAt) : null;
    switch (presentationStatus) {
      case "DRAFT":
        return reason.length > 0 ? reason : null;
      case "SAVED_TO_SHOPIFY":
        if (!reason && !submittedAt) return null;
        if (reason && submittedAt && deadline) {
          return t("hero.subtitle.savedWithReasonAndDeadline", {
            strengthReason: reason || " ",
            savedDate,
            deadline,
          });
        }
        if (reason && submittedAt) {
          return t("hero.subtitle.savedWithReason", {
            strengthReason: reason || " ",
            savedDate,
          });
        }
        return t("hero.subtitle.savedNoDate", { strengthReason: reason || " " });
      case "AWAITING_SHOPIFY_AUTO_SUBMISSION":
        return t("hero.subtitle.awaitingForward", { strengthReason: reason || " " });
      case "SUBMITTED_TO_NETWORK":
        if (submittedAt) {
          return t("hero.subtitle.submittedToNetworkWithDate", {
            submittedDate: formatDate(submittedAt),
          });
        }
        return t("hero.subtitle.submittedToNetwork", { strengthReason: reason || " " });
      case "CLOSED_WON":
        return t("hero.subtitle.closedWon", {
          submittedDate: submittedAt ? formatDate(submittedAt) : "none",
        });
      case "CLOSED_LOST":
        return t("hero.subtitle.closedLost", {
          submittedDate: submittedAt ? formatDate(submittedAt) : "none",
        });
      case "CLOSED_UNKNOWN":
        return t("hero.subtitle.closedUnknown", {
          outcome: dispute.finalOutcome ?? "—",
        });
      default:
        return reason.length > 0 ? reason : null;
    }
  }
  const heroSubtitle = resolveHeroSubtitle();

  /* ── Timeline ──
   *
   *  Critical: "Saved to Shopify" is NOT "bank review in progress."
   *  Shopify holds the evidence until the deadline (then auto-forwards
   *  to the card network) OR until the merchant clicks Submit in
   *  Shopify Admin. The window between those two events is the
   *  merchant's last chance to add evidence — so the timeline must
   *  surface it as a distinct active step, not collapse straight into
   *  "bank review".
   *
   *  Signals:
   *    - dispute.submissionState === "saved_to_shopify": we saved.
   *    - dispute.normalizedStatus === "submitted_to_bank":
   *        Shopify has forwarded to the card network (their status
   *        flipped to `under_review`). Bank is now reviewing.
   *    - dispute.finalOutcome != null: bank decided.
   */
  // ── Timeline ── driven by presentationStatus.
  //
  // Five-step sequence (post-save):
  //   1. Defence package prepared
  //   2. Evidence saved to Shopify
  //   3. Awaiting Shopify forwarding to card network
  //   4. Card network review
  //   5. Outcome posted in Shopify
  //
  // Pre-save (DRAFT):
  //   1. Defence package prepared
  //   2. Review and submit
  //   3. Card network review (pending)
  //
  // Hard rule: card-network wording NEVER reaches the timeline copy
  // unless presentationStatus is AWAITING_*, SUBMITTED_TO_NETWORK, or
  // CLOSED_*. The forwarding step's "Awaiting Shopify forwarding to
  // card network" title is the only place the phrase appears before
  // forwarding actually happens, and it accurately describes a future
  // event Shopify controls.
  type TimelineStep = { state: "done" | "active" | "pending"; title: string; helper: string };
  const dueDateStr = dispute.dueAt ? formatDate(dispute.dueAt) : null;
  const savedDateStr = submittedAt ? formatDate(submittedAt) : null;

  function timelineForPresentation(): TimelineStep[] {
    switch (presentationStatus) {
      case "DRAFT": {
        // Three distinct states, not two. Previously `packExists ? done : active`
        // showed "Building defence package" (active) whenever no pack existed —
        // even when NO build was ever enqueued, leaving a stuck dispute looking
        // like it was building forever. Distinguish by pack status + active job:
        //   - pack ready/draft (a real, built pack) → prepared (done)
        //   - pack queued/building, or an active build_pack job → building (active)
        //   - no pack + no active job → not started (a build hasn't run)
        const packStatus = data?.pack?.status ?? null;
        const buildInProgress =
          packStatus === "queued" ||
          packStatus === "building" ||
          !!data?.pack?.activeBuildJob;
        const packPrepared = !!data?.pack && !buildInProgress;

        const firstStep: TimelineStep = buildInProgress
          ? {
              state: "active",
              title: t("timeline.defencePackagePrepared.titleActive"),
              helper: t("timeline.defencePackagePrepared.helperActive"),
            }
          : packPrepared
            ? {
                state: "done",
                title: t("timeline.defencePackagePrepared.titleDone"),
                helper: t("timeline.defencePackagePrepared.helperDone"),
              }
            : {
                // No pack and nothing building — honest "not started" (reuses
                // the existing pending copy: "Prepare defence package" /
                // "Generate the evidence pack to begin") instead of a phantom
                // "Building defence package".
                state: "pending",
                title: t("timeline.defencePackagePrepared.titlePending"),
                helper: t("timeline.defencePackagePrepared.helperPending"),
              };

        return [
          firstStep,
          {
            state: packPrepared ? "active" : "pending",
            title: t("timeline.reviewAndSubmit.title"),
            helper: dueDateStr
              ? t("timeline.reviewAndSubmit.helperWithDeadline", { deadline: dueDateStr })
              : t("timeline.reviewAndSubmit.helperNoDeadline"),
          },
          {
            state: "pending",
            title: t("timeline.cardNetworkReview.title"),
            helper: t("timeline.cardNetworkReview.helperPending"),
          },
        ];
      }
      case "SAVED_TO_SHOPIFY":
      case "AWAITING_SHOPIFY_AUTO_SUBMISSION": {
        return [
          {
            state: "done",
            title: t("timeline.defencePackagePrepared.titleDone"),
            helper: t("timeline.defencePackagePrepared.helperDone"),
          },
          {
            state: "done",
            title: t("timeline.evidenceSavedToShopify.title"),
            helper: savedDateStr
              ? t("timeline.evidenceSavedToShopify.helperWithDate", { savedDate: savedDateStr })
              : t("timeline.evidenceSavedToShopify.helperNoDate"),
          },
          {
            state: "active",
            title: t("timeline.awaitingShopifyForwarding.title"),
            helper: dueDateStr
              ? t("timeline.awaitingShopifyForwarding.helperWithDeadline", { deadline: dueDateStr })
              : t("timeline.awaitingShopifyForwarding.helperNoDeadline"),
          },
          {
            state: "pending",
            title: t("timeline.cardNetworkReview.title"),
            helper: t("timeline.cardNetworkReview.helperPending"),
          },
        ];
      }
      case "SUBMITTED_TO_NETWORK": {
        return [
          {
            state: "done",
            title: t("timeline.defencePackagePrepared.titleDone"),
            helper: t("timeline.defencePackagePrepared.helperDone"),
          },
          {
            state: "done",
            title: t("timeline.evidenceSavedToShopify.title"),
            helper: savedDateStr
              ? t("timeline.evidenceSavedToShopify.helperWithDate", { savedDate: savedDateStr })
              : t("timeline.evidenceSavedToShopify.helperNoDate"),
          },
          {
            state: "done",
            title: t("timeline.submittedToCardNetwork.title"),
            helper: t("timeline.submittedToCardNetwork.helper"),
          },
          {
            state: "active",
            title: t("timeline.cardNetworkReview.title"),
            helper: t("timeline.cardNetworkReview.helperActive"),
          },
          {
            state: "pending",
            title: t("timeline.outcomePosted.title"),
            helper: t("timeline.outcomePosted.helperPending"),
          },
        ];
      }
      case "CLOSED_WON":
      case "CLOSED_LOST":
      case "CLOSED_UNKNOWN": {
        return [
          {
            state: "done",
            title: t("timeline.defencePackagePrepared.titleDone"),
            helper: t("timeline.defencePackagePrepared.helperDone"),
          },
          {
            state: "done",
            title: t("timeline.evidenceSavedToShopify.title"),
            helper: savedDateStr
              ? t("timeline.evidenceSavedToShopify.helperWithDate", { savedDate: savedDateStr })
              : t("timeline.evidenceSavedToShopify.helperNoDate"),
          },
          {
            state: "done",
            title: t("timeline.submittedToCardNetwork.title"),
            helper: t("timeline.submittedToCardNetwork.helper"),
          },
          {
            state: "done",
            title: t("timeline.cardNetworkReview.title"),
            helper: t("timeline.cardNetworkReview.helperActive"),
          },
          {
            state: "done",
            title: t("timeline.outcomePosted.title"),
            helper: t("timeline.outcomePosted.helperWithOutcome", {
              outcome: dispute.finalOutcome ?? "—",
            }),
          },
        ];
      }
      default:
        return [];
    }
  }
  const timeline: TimelineStep[] = timelineForPresentation();

  /* ── O4 Coverage breakdown by priority ──
     Hide two kinds of rows from coverage + the Evidence collected list:
       1. `unavailable` — structurally impossible to collect (e.g. 3DS
          on non-Shopify-Payments orders).
       2. `missing` rows the merchant cannot act on — auto-only signals
          like `fraud_risk_screening`, `avs_cvv_match`, or
          `billing_address_match`. Per commit 9241996 + fraud-risk source
          rules: absence of an auto-collected signal is never a negative
          signal, so it must not render as a red "Missing" card with no
          actionable CTA. Mirrors the §3 Missing-or-weak filter
          (deriveMissingItems → collectionType === "manual"). */
  // `MERCHANT_UI_HIDDEN_FIELDS` (currently customer_communication +
  // supporting_documents) are hidden from every merchant-facing list
  // (decision 2026-05-21 — dev mode, no prod merchants). The underlying
  // checklist still carries them so pack builder, scoring, and coverage
  // gate are untouched; only the merchant-facing surfaces filter them.
  const visibleChecklist = effectiveChecklist.filter((c) => {
    if (c.status === "unavailable") return false;
    if (c.status === "missing" && !canMerchantUpload(c)) return false;
    if (MERCHANT_UI_HIDDEN_FIELDS.has(c.field)) return false;
    return true;
  });
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
  const appliedModeLabel = appliedMode === "auto"
    ? tExtra("appliedMode.automatic")
    : tExtra("appliedMode.reviewBeforeSubmit");
  const appliedModeHelp = appliedMode === "auto"
    ? tExtra("appliedMode.automaticHelp")
    : tExtra("appliedMode.reviewBeforeSubmitHelp");

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
    ? { label: tExtra("setUpPolicies"), url: withShopParams("/app/policies", searchParams) }
    : null;

  return (
    <BlockStack gap="400">
      {/* LSE-1: Visa CE 3.0 qualification verdict. Renders null when not applicable. */}
      <LiabilityShiftPanel disputeId={dispute.id} />

      {/* F2: Auto-save denied banner — preserved from existing logic */}
      {autoSaveBlock && (
        <Banner tone="warning" title={tExtra("autoSubmitPausedTitle")}>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              {tExtra("autoSubmitPausedBody")}
            </Text>
            {autoSaveBlock.reasons.length > 0 && (
              <Text as="p" variant="bodySm">{tExtra("whyPrefix")} {autoSaveBlock.reasons.join(" • ")}</Text>
            )}
            <InlineStack gap="200">
              <Button onClick={goToEvidence}>{tExtra("addMissingEvidence")}</Button>
              <Button variant="primary" onClick={goToReview}>{tExtra("submitAnyway")}</Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      )}


      {/* O1: Hero — minimal per Figma: label + confidence pill + 1-line summary.
          Recommendation / improvement / helper / deadline copy moves to the
          dedicated Recommendation card below. */}
      <div
        data-help-guide="detail-overview-hero"
        style={{
          background: heroTone.bg,
          border: `2px solid ${heroTone.border}`,
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
          </div>
          {heroSubtitle && (
            <p style={{ fontSize: 14, color: heroTone.bodyColor, margin: 0, lineHeight: 1.5, opacity: 0.85 }}>
              {heroSubtitle}
            </p>
          )}
        </div>
      </div>

      {/* Monitoring banner — placed directly under the hero so the
          merchant sees the "we're still watching" reassurance immediately
          after the saved-to-Shopify confirmation. Custom card styling
          (instead of Polaris <Banner>) keeps the visual rhythm with the
          hero + content cards: same border-radius, same padding scale,
          tighter info-blue palette. Suppressed once Shopify has forwarded
          to the card network or the dispute is closed. */}
      {(presentationStatus === "DRAFT" ||
        presentationStatus === "SAVED_TO_SHOPIFY" ||
        presentationStatus === "AWAITING_SHOPIFY_AUTO_SUBMISSION") && (
        <div
          style={{
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            borderRadius: 12,
            padding: 16,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              color: "#1D4ED8",
              flexShrink: 0,
              marginTop: 2,
              display: "inline-flex",
            }}
          >
            <Icon source={ShieldCheckMarkIcon} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#1E3A8A",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {t("monitoring.title")}
            </p>
            <p
              style={{
                fontSize: 13,
                color: "#1E40AF",
                margin: "4px 0 0",
                lineHeight: 1.5,
              }}
            >
              {dispute.dueAt
                ? t("monitoring.bodyWithDeadline", { deadline: formatDate(dispute.dueAt) })
                : t("monitoring.bodyNoDeadline")}
            </p>
          </div>
        </div>
      )}

      {/* O2: Timeline — step titles colored per state (green/blue/gray) per Figma */}
      <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">{tExtra("whatHappensNow")}</Text>
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
          the timeline so the hero matches Figma's minimal design.
          Pre-submit advice (recommendationText, improvementHint) is
          suppressed once the pack is submitted because the merchant
          can no longer act on it — the card collapses to the
          submission/deadline line plus the evaluation helper. */}
      {((!submitted && (recommendationText || improvementHintText)) || dispute.dueAt || submitted) && (
        <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
          <BlockStack gap="200">
            {!submitted && recommendationText && (
              <Text as="p" variant="bodyMd" fontWeight="semibold">{recommendationText}</Text>
            )}
            {!submitted && recommendationHelperText && (
              <Text as="p" variant="bodySm" tone="subdued">{recommendationHelperText}</Text>
            )}
            {!submitted && improvementHintText && (
              <Text as="p" variant="bodySm" tone="subdued">{improvementHintText}</Text>
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              {submitted
                ? tExtra("submittedOn", { date: formatDate(submittedAt) })
                : deadlineDays !== null && deadlineDays > 0
                  ? tExtra("submissionDeadlineIn", { days: deadlineDays, date: formatDate(dispute.dueAt), urgent: deadlineUrgent ? "yes" : "no" })
                  : deadlineDays !== null && deadlineDays <= 0
                    ? tExtra("submissionDeadlineOverdue", { date: formatDate(dispute.dueAt) })
                    : tExtra("noDeadlineSet")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">{tExtra("evidenceEvaluationHelper")}</Text>
          </BlockStack>
        </div>
      )}

      {/* "What supports your case" is intentionally NOT a separate
          card — the strong/moderate rows already render at the top of
          "Evidence collected" below (single-list, strongest-first
          ordering). A separate card duplicated those rows visually
          without adding new information. */}

      {/* Evidence collected — shows everything in the pack, not just
          argument-winning signals. The single-list, strongest-first
          ordering replaces the prior "What supports your case" card,
          so strong/moderate rows are still the first thing the
          merchant sees, but without duplicating them.

          Single ordered list — strongest first. Row sort key:
          strong (0) → moderate (1) → supporting (2) → missing (3) →
          not_applicable / waived (4). Within each tier rows preserve
          checklist order. Each row carries exactly ONE pill: when
          collected, the pill is the strength category (Strong /
          Moderate / Supporting); when not, the pill is the status
          (Missing / Not applicable / Waived). The redundant
          "Collected" pill has been dropped — presence in the list
          implies collected unless the pill says otherwise. */}
      {(() => {
        // Hide rows that aren't actionable feedback for the merchant:
        //   1. `unavailable` — structural facts (3DS on non-Shopify-
        //      Payments, "No card payment on this order" for AVS/CVV
        //      when the order paid with a wallet/installments, etc.).
        //      The data is correct; surfacing it just adds noise the
        //      merchant can't act on.
        //   2. `missing` rows the merchant cannot act on — auto-only
        //      signals (fraud_risk_screening, avs_cvv_match on missing
        //      gateway codes, etc.). Per commit 9241996 + fraudRiskSource
        //      rules: absence of an auto-collected signal is never a
        //      negative signal. Mirrors `visibleChecklist` above and the
        //      §3 Missing-or-weak gate in `deriveMissingItems`.
        // Field → line-item lookup. The line-item layer
        // (lib/argument/evidenceLineItem.ts) is the only place that
        // computes `submissionMethod: "internal_only"` — the legacy
        // `classifyEvidenceRow` only sees status + payload category and
        // returns "supporting" for rows like `ip_location_check` whose
        // payload is negative/ambiguous. Without this lookup the
        // Overview list mislabels withheld signals as "Supporting".
        const lineItemsByField = new Map(
          (data?.evidenceLineItems ?? []).map((li) => [li.field, li]),
        );
        const collectedRows = effectiveChecklist
          .filter((c) => CANONICAL_EVIDENCE[c.field])
          .filter((c) => c.status !== "unavailable")
          .filter((c) => !(c.status === "missing" && !canMerchantUpload(c)))
          // Hide merchant-UI-hidden fields when they're not yet collected.
          // If they end up uploaded, classifyEvidenceRow will mark them
          // collected and they'll surface as real evidence — but until
          // then, no "Missing / Add this evidence" nag.
          .filter((c) => !(MERCHANT_UI_HIDDEN_FIELDS.has(c.field) && c.status !== "available"))
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
            return {
              item: c,
              spec,
              classification,
              lineItem: lineItemsByField.get(c.field),
            };
          });
        const manualUploads = (data.attachments ?? []).filter(
          (a) => a.source === "manual_upload",
        );
        const hasAnything = collectedRows.length > 0 || manualUploads.length > 0;
        if (!hasAnything) return null;

        const SOURCE_NOTE: Record<string, string> = {
          auto_shopify: tSource("auto_shopify"),
          auto_policy: tSource("auto_policy"),
          auto_ipinfo: tSource("auto_ipinfo"),
          manual_upload: tSource("manual_upload"),
          unavailable_from_source: tSource("unavailable_from_source"),
        };

        // EvidenceLineItem.source is the *actual* provenance (e.g.
        // `merchant_upload` for the cardholder-acknowledgement flow on
        // customer_communication) while `item.source` on the checklist
        // is the *expected* origin (auto_shopify for the same field).
        // For collected rows we want to surface what really happened —
        // a merchant who uploaded a cardholder acknowledgement should
        // not see "From Shopify order data" against it.
        //
        // Mapping intentionally narrow: only the two EvidenceSource
        // values that flip the displayed caption away from the
        // checklist default land here. The remaining sources
        // (`shopify`, `derived`) keep the checklist mapping.
        const LINE_ITEM_SOURCE_NOTE: Partial<
          Record<NonNullable<ReturnType<typeof lineItemsByField.get>>["source"], string>
        > = {
          merchant_upload: SOURCE_NOTE.manual_upload,
        };

        type Row = (typeof collectedRows)[number];

        // Internal-only check used by both the pill resolver and the
        // sort tier. Lives at the line-item layer (the legacy
        // classifier doesn't know about negative-payload withholding).
        // When the line item flags `internal_only`, the row's primary
        // evidentiary value is unfavorable and the system has
        // withheld it from the bank-facing argument — render the
        // verdict + reason inline so the merchant sees DisputeDesk's
        // call, not a misleading "Supporting" label.
        const isInternalOnlyRow = (row: Row): boolean =>
          row.lineItem?.submissionMethod === "internal_only";

        // Single ordered list — sort by tier then preserve checklist
        // order within tier (Array.prototype.sort is stable).
        const tierOf = (row: Row): number => {
          const { classification } = row;
          if (classification.status === "missing") return 4;
          if (
            classification.status === "not_applicable" ||
            classification.status === "waived"
          ) {
            return 5;
          }
          // Internal-only rows render between supporting and missing —
          // they're collected, just not bank-facing.
          if (isInternalOnlyRow(row)) return 3;
          // Collected — defer to category.
          if (classification.category === "strong") return 0;
          if (classification.category === "moderate") return 1;
          return 2; // supporting (and the rare invalid soft-landed in classifyEvidenceRow)
        };
        const orderedRows = [...collectedRows].sort(
          (a, b) => tierOf(a) - tierOf(b),
        );

        // ── One pill per row. Strength wins when collected; status
        //    wins when missing / not applicable / waived / internal-only.
        //    Palette mirrors Figma `shopify-dispute-detail.tsx`. ──
        const pillFor = (row: Row): { label: string; bg: string; color: string } => {
          const { classification } = row;
          if (classification.status === "missing") {
            return { label: tPill("missing"), bg: "#FEE2E2", color: "#991B1B" };
          }
          if (classification.status === "not_applicable") {
            return { label: tPill("not_applicable"), bg: "#F3F4F6", color: "#4B5563" };
          }
          if (classification.status === "waived") {
            return { label: tPill("waived"), bg: "#E5E7EB", color: "#374151" };
          }
          // Internal-only — system withheld this signal from the
          // bank-facing argument because the payload is negative or
          // ambiguous. Same amber palette as the Internal-only Signals
          // section on the Evidence tab.
          if (isInternalOnlyRow(row)) {
            return { label: tPill("internal_only"), bg: "#FEF3C7", color: "#78350F" };
          }
          // Collected — strength label.
          switch (classification.category) {
            case "strong":
              return { label: tItemStrength("strong"), bg: "#D1FAE5", color: "#065F46" };
            case "moderate":
              return { label: tItemStrength("moderate"), bg: "#FEF3C7", color: "#92400E" };
            case "invalid":
              return { label: tPill("invalid"), bg: "#FEE2E2", color: "#991B1B" };
            default:
              return { label: tItemStrength("supporting"), bg: "#E5E7EB", color: "#374151" };
          }
        };

        // Row visual matches the "What supports your case" pattern from
        // Figma's shopify-dispute-detail.tsx (Make file):
        //   bg #F6F8FB · border #E1E3E5 · rounded-lg · padding 16px,
        //   leading icon (5x5) · title (14/600) + descriptor (12/subdued)
        //   · trailing pill self-aligned.
        const renderRow = (row: Row) => {
          const { item, spec, classification, lineItem } = row;
          const isMissing = classification.status === "missing";
          const isInternalOnly = isInternalOnlyRow(row);
          // System-derived row that's currently missing — replace the
          // generic "From Shopify order data" caption with the more
          // informative "Pending order activity — populates automatically
          // when Shopify reports it" so the merchant understands the
          // system is watching and they don't need to act.
          const isPendingSystemSignal = isMissing && !canMerchantUpload(item);
          // Caption priority:
          //   1. Structurally unavailable → row.unavailableReason
          //      ("Order is unfulfilled", etc.)
          //   2. Internal-only → lineItem.reason — explains WHY
          //      DisputeDesk is withholding this signal from the
          //      bank-facing argument (e.g. "This signal is ambiguous
          //      or unfavorable and could weaken the fraud response.")
          //   3. Waived → "You/DisputeDesk marked this not applicable:
          //      <reason label>." + optional note. Built from
          //      `item.waiveReason`, `item.waivedBy`, `item.waiveNote`
          //      (threaded onto the checklist by `completeness.ts:507-511`).
          //   4. Missing + non-actionable → pending-system caption
          //   5. Otherwise → generic SOURCE_NOTE
          const waiveCaption = (() => {
            if (classification.status !== "waived" || !item.waiveReason) {
              return null;
            }
            const reasonLabel =
              item.waiveReason === "other" && item.waiveNote
                ? item.waiveNote
                : tEvidence(
                    `sections.missing.actions.waiveReason.${item.waiveReason}`,
                  );
            const base =
              item.waivedBy === "system"
                ? t("rowWaivedBySystem", { reason: reasonLabel })
                : t("rowWaivedByMerchant", { reason: reasonLabel });
            // Append a freeform note only when the reason isn't `other`
            // (in that case the note IS the reason label already, so
            // appending it again would be redundant).
            if (
              item.waiveReason !== "other" &&
              item.waiveNote &&
              item.waiveNote.trim().length > 0
            ) {
              return (
                base + t("rowWaivedNoteSuffix", { note: item.waiveNote.trim() })
              );
            }
            return base;
          })();

          // For collected rows, the line item's source is the actual
          // provenance (e.g. merchant_upload for a cardholder
          // acknowledgement on customer_communication). Use it to
          // override the checklist's expected-source caption so the
          // merchant doesn't see "From Shopify order data" against
          // evidence they uploaded themselves. Falls through to the
          // checklist mapping for system-collected rows.
          const lineItemSourceNote =
            lineItem &&
            classification.status !== "missing" &&
            classification.status !== "waived" &&
            !isInternalOnly
              ? (LINE_ITEM_SOURCE_NOTE[lineItem.source] ?? null)
              : null;
          const sourceNote =
            classification.status === "not_applicable" && item.unavailableReason
              ? item.unavailableReason
              : waiveCaption
                ? waiveCaption
                : isInternalOnly && lineItem?.reasonToken
                  ? resolveToken(tRoot, lineItem.reasonToken)
                  : isPendingSystemSignal
                    ? t("rowSourceCaptionPendingSystem")
                    : (lineItemSourceNote ?? SOURCE_NOTE[item.source ?? ""] ?? null);
          const isNeutral =
            classification.status === "not_applicable" ||
            classification.status === "waived";
          const iconSrc = isMissing
            ? AlertCircleIcon
            : isInternalOnly
              ? AlertCircleIcon
              : CheckCircleIcon;
          const iconColor = isMissing
            ? "#DC2626"
            : isInternalOnly
              ? "#D97706"
              : isNeutral
                ? "#8C9196"
                : "#059669";
          const pill = pillFor(row);
          // Inline "Add this evidence" CTA — surfaces on every missing
          // row the merchant can actually act on, gated by the shared
          // `canMerchantUpload()` helper (single-sourced with the
          // Evidence tab). The previous gate restricted to
          // `defaultCat ∈ {strong, moderate}` AND `collectionType ===
          // "manual"`, which silently hid the CTA for fields that only
          // become Strong via merchant content (e.g.
          // `customer_communication` defaults to "supporting" but
          // becomes Strong when `payload.customerConfirmsOrder ===
          // true` — the merchant's upload IS the path to strength).
          //
          // The CTA hides only when the dispute has a `finalOutcome`
          // (won / lost). "Saved to Shopify" is NOT terminal — Shopify
          // accepts evidence updates until the dispute's deadline,
          // and the Evidence tab still shows the upload UI in that
          // window, so the Overview CTA (which navigates to Evidence)
          // must remain consistent.
          const isCaseClosed = !!dispute.finalOutcome;
          const showAddCta = !isCaseClosed && isMissing && canMerchantUpload(item);
          // Row background tone:
          //   - red for missing rows
          //   - amber tint for internal-only (matches the pill palette)
          //   - neutral otherwise
          const rowBg = isMissing
            ? "#FEF2F2"
            : isInternalOnly
              ? "#FFFBEB"
              : "#F6F8FB";
          const rowBorder = isMissing
            ? "1px solid #FCA5A5"
            : isInternalOnly
              ? "1px solid #FDE68A"
              : "1px solid #E1E3E5";
          return (
            <div
              key={item.field}
              style={{
                background: rowBg,
                border: rowBorder,
                borderRadius: 8,
                padding: 16,
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  color: iconColor,
                  flexShrink: 0,
                  marginTop: 1,
                  display: "inline-flex",
                }}
              >
                <Icon source={iconSrc} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: isMissing
                      ? "#7F1D1D"
                      : isInternalOnly
                        ? "#78350F"
                        : "#202223",
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {(() => {
                    // signalLabel.<signalId> is now the canonical key
                    // (no more spec.label fallback). When the lookup
                    // returns the key path verbatim, fall back to the
                    // raw signalId so the row still renders something
                    // identifiable.
                    try {
                      const k = tSignal(spec.signalId);
                      return k && k !== spec.signalId ? k : spec.signalId;
                    } catch {
                      return spec.signalId;
                    }
                  })()}
                </p>
                {sourceNote && (
                  <p
                    style={{
                      fontSize: 12,
                      color: isInternalOnly ? "#78350F" : "#6D7175",
                      margin: "2px 0 0",
                      lineHeight: 1.4,
                    }}
                  >
                    {sourceNote}
                  </p>
                )}
                {/* Internal-only warnings attached to a row whose
                    primary value is still useful (e.g.
                    order_confirmation carrying a billing/shipping
                    address mismatch). Render after the main caption. */}
                {lineItem?.internalSignals?.map((sig) => (
                  <p
                    key={sig.id}
                    style={{
                      fontSize: 12,
                      color: "#78350F",
                      margin: "2px 0 0",
                      lineHeight: 1.4,
                    }}
                  >
                    {sig.label}: {sig.reason}
                  </p>
                ))}
                {showAddCta && (
                  <div style={{ marginTop: 8 }}>
                    <Button
                      size="slim"
                      onClick={() => actions.navigateToEvidence(item.field)}
                    >
                      {tExtra("addThisEvidence")}
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
                  background: pill.bg,
                  color: pill.color,
                  whiteSpace: "nowrap",
                  alignSelf: "flex-start",
                }}
              >
                {pill.label}
              </span>
            </div>
          );
        };

        return (
          <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">{tExtra("evidenceCollected")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {tExtra("evidenceOrderingHelper")}
                </Text>
              </BlockStack>

              <BlockStack gap="200">
                {orderedRows.map(renderRow)}
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

      {/* O4: Evidence coverage — single-glance stacked bar that splits
          the evidence sections by disposition (positive argument /
          context only / kept internal / not included). Replaces the
          earlier 2×2 tile grid; same line-item source, same numbers,
          but you can see at a glance how much of what was found made
          it into the bank-facing argument. The four buckets line up
          1:1 with the SubmissionSummaryPanel cells below — this card
          is the summary, that card is the drill-down. */}
      {(() => {
        const lineItems = data?.evidenceLineItems ?? [];
        const positiveCount = lineItems.filter((li) => li.usedAsPositiveBankEvidence).length;
        const contextCount = lineItems.filter(
          (li) => li.submissionMethod === "context_only",
        ).length;
        const internalCount = lineItems.filter(
          (li) => li.submissionMethod === "internal_only",
        ).length;
        const excludedCount = lineItems.filter(
          (li) =>
            li.submissionMethod === "excluded" ||
            li.submissionMethod === "waived" ||
            li.submissionMethod === "failed_upload" ||
            li.submissionMethod === "not_supported" ||
            li.submissionMethod === "not_included",
        ).length;
        const totalFound = positiveCount + contextCount + internalCount + excludedCount;
        const includedInPackage = positiveCount + contextCount;

        // Disposition swatches. Positive + internal use the darker
        // tones from the Hero palette (`#059669` and `#D97706`) so
        // the bar segments line up with the success / warning icons
        // and pills elsewhere on this tab. Earlier values
        // (`#22C55E` / `#F59E0B`) were the brighter Tailwind 500
        // shades and stacked two slightly different greens / ambers
        // on the same screen.
        const DISP = {
          positive: "#059669",
          context: "#9CA3AF",
          internal: "#D97706",
          excluded: "#EF4444",
        } as const;

        return (
          <div
            data-help-guide="detail-overview-evidence"
            style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}
          >
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                <Text as="h3" variant="headingSm">{t("coverage.title")}</Text>
                <Text as="span" variant="bodyXs" tone="subdued">
                  {t("coverage.subtitle")}
                </Text>
              </InlineStack>

              {/* Headline: "N / M  evidence sections included in the
                  defence package · K cited as positive arguments" */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    lineHeight: 1,
                    color: "#202223",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {includedInPackage}
                  <span style={{ color: "#6D7175", fontWeight: 500 }}>
                    {" / "}
                    {totalFound}
                  </span>
                </span>
                <span style={{ color: "#6D7175", fontSize: 13 }}>
                  {t("coverage.headlineSub", { positive: positiveCount })}
                </span>
              </div>

              {/* Stacked disposition bar. Each segment is flex-sized by
                  count so a bucket with 0 items collapses out of the
                  visual without leaving a stub. */}
              {totalFound > 0 ? (
                <div
                  role="img"
                  aria-label={t("coverage.barAria", {
                    positive: positiveCount,
                    context: contextCount,
                    internal: internalCount,
                    excluded: excludedCount,
                    total: totalFound,
                  })}
                  style={{
                    display: "flex",
                    height: 14,
                    width: "100%",
                    gap: 2,
                    borderRadius: 999,
                    overflow: "hidden",
                    background: "#F6F6F7",
                    marginTop: 4,
                  }}
                >
                  {positiveCount > 0 ? (
                    <div style={{ flex: positiveCount, background: DISP.positive }} />
                  ) : null}
                  {contextCount > 0 ? (
                    <div style={{ flex: contextCount, background: DISP.context }} />
                  ) : null}
                  {internalCount > 0 ? (
                    <div style={{ flex: internalCount, background: DISP.internal }} />
                  ) : null}
                  {excludedCount > 0 ? (
                    <div style={{ flex: excludedCount, background: DISP.excluded, opacity: 0.55 }} />
                  ) : null}
                </div>
              ) : null}
            </BlockStack>

            {/* Legend strip — flush to the card's outer edges so the
                top divider lines up with the card border. Each cell
                shows a coloured dot, the per-bucket count "X of N",
                a one-line label, and a one-line helper that matches
                the dot's meaning. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 0,
                margin: "16px -20px -20px",
                borderTop: "1px solid #E1E3E5",
              }}
            >
              <LegendCell
                dot={DISP.positive}
                count={positiveCount}
                total={totalFound}
                ofTotalLabel={t("coverage.legendOfTotal", { total: totalFound })}
                label={t("coverage.legendPositiveLabel")}
                helper={t("coverage.legendPositiveHelper")}
                borderRight
              />
              <LegendCell
                dot={DISP.context}
                count={contextCount}
                total={totalFound}
                ofTotalLabel={t("coverage.legendOfTotal", { total: totalFound })}
                label={t("coverage.legendContextLabel")}
                helper={t("coverage.legendContextHelper")}
                borderRight
              />
              <LegendCell
                dot={DISP.internal}
                count={internalCount}
                total={totalFound}
                ofTotalLabel={t("coverage.legendOfTotal", { total: totalFound })}
                label={t("coverage.legendInternalLabel")}
                helper={t("coverage.legendInternalHelper")}
                borderRight
              />
              <LegendCell
                dot={DISP.excluded}
                count={excludedCount}
                total={totalFound}
                ofTotalLabel={t("coverage.legendOfTotal", { total: totalFound })}
                label={t("coverage.legendExcludedLabel")}
                helper={t("coverage.legendExcludedHelper")}
              />
            </div>
          </div>
        );
      })()}

      {/* O5: Submission summary — "What was/will be saved to Shopify".
              Same EvidenceLineItem source as the §2 Evidence section so
              the panel cannot disagree with the rows. Plan v2 §G. */}
      {data?.submissionSummary && (
        <SubmissionSummaryPanel
          summary={data.submissionSummary}
          lineItems={data.evidenceLineItems ?? []}
          presentationStatus={presentationStatus}
        />
      )}

      {/* Automation rule card */}
      <div style={{ background: "#fff", border: "1px solid #E1E3E5", borderRadius: 12, padding: 20 }}>
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center">
              <Text as="p" variant="bodyMd" fontWeight="semibold">{tExtra("automationRule")}</Text>
              <Badge tone={appliedRule?.mode === "auto" ? "success" : appliedRule?.mode === "review" ? "attention" : undefined}>
                {appliedModeLabel}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">{appliedModeHelp}</Text>
          </BlockStack>
          <div style={{ marginLeft: "auto" }}>
            <Button url={rulesUrl}>{tExtra("changeRule")}</Button>
          </div>
        </InlineStack>
      </div>

      {/* Footer CTAs */}
      <InlineStack gap="200" align="end">
        {!submitted && (
          <>
            <Button onClick={goToEvidence} icon={AlertCircleIcon}>{tExtra("editEvidence")}</Button>
            <Button variant="primary" onClick={goToReview} icon={ShieldCheckMarkIcon} size="large">
              {tExtra("submitToShopify")}
            </Button>
          </>
        )}
        {submitted && (
          <>
            {policyCta && <Button url={policyCta.url}>{policyCta.label}</Button>}
            {shopifyAdminUrl && (
              <Button variant="primary" url={shopifyAdminUrl} target="_blank" size="large">
                {tExtra("viewInShopify")}
              </Button>
            )}
          </>
        )}
      </InlineStack>
    </BlockStack>
  );
}
