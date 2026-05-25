/**
 * CaseSummaryCard — Section 1 of EvidenceTab.
 *
 * Matches the Dispute Page Evidence Tab design verbatim — pill-shaped
 * (radius-999) strength badge on the left grouped with the next-step
 * headline; on the right, two `Label [pill]` pairs (Status,
 * Automation). A top divider separates the lead row from the
 * "Why this strength" explanation block; the merchant-facing
 * automation copy (e.g. "Review required before submission.") renders
 * as a small subdued meta line at the bottom of the why-block.
 *
 * Polaris `<Card>` and `<Badge>` are intentionally not used here:
 * Badge renders rounded-rect chips that do not match the design's
 * full-pill (radius-999) shape, and Card adds padding/shadow that
 * doesn't line up with the unified card-on-card visual the rest of
 * the redesigned tab uses.
 *
 * NO percentages. NO progress bars. NO predictive copy.
 */

"use client";

import { useTranslations } from "next-intl";
import type {
  CaseSummaryViewModel,
  CaseStatus,
  AutomationMode,
  NextStep,
} from "../useEvidenceSections";
import type { CaseStrengthLevel } from "@/lib/argument/types";

type DisplayStrength = "strong" | "moderate" | "weak";

function toDisplayStrength(level: CaseStrengthLevel): DisplayStrength {
  if (level === "strong") return "strong";
  if (level === "moderate") return "moderate";
  return "weak";
}

const STRENGTH_PILL: Record<DisplayStrength, { bg: string; color: string }> = {
  strong: { bg: "#D1FAE5", color: "#065F46" },
  moderate: { bg: "#FEF3C7", color: "#92400E" },
  weak: { bg: "#FEE2E2", color: "#991B1B" },
};

const STATUS_PILL: Record<CaseStatus, { bg: string; color: string }> = {
  submitted: { bg: "#D1FAE5", color: "#065F46" },
  needs_attention: { bg: "#FEF3C7", color: "#92400E" },
  in_progress: { bg: "#DBEAFE", color: "#1E40AF" },
};

const AUTOMATION_PILL: Record<AutomationMode, { bg: string; color: string }> = {
  automatic: { bg: "#D1FAE5", color: "#065F46" },
  review_required: { bg: "#FEF3C7", color: "#92400E" },
};

function nextStepCopy(
  step: NextStep,
  tNext: ReturnType<typeof useTranslations>,
): string {
  if (step.kind === "ready_no_action") return tNext("readyNoAction");
  if (step.kind === "submit_now") return tNext("submitNow");
  if (step.kind === "submitted_no_action") return tNext("submittedNoAction");
  return tNext("reviewMissing");
}

/**
 * Pill-shaped status chip — full-radius (999), small uppercase-cased
 * body. Used for the Status and Automation chips on the right side of
 * the lead row.
 */
function Pill({
  bg,
  color,
  children,
}: {
  bg: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

export function CaseSummaryCard(props: CaseSummaryViewModel) {
  const t = useTranslations("disputes.evidenceTab.sections.summary");
  const tStrength = useTranslations("disputes.caseStrength");
  const tStatus = useTranslations(
    "disputes.evidenceTab.sections.summary.status",
  );
  const tAuto = useTranslations(
    "disputes.evidenceTab.sections.summary.automationMode",
  );
  const tNext = useTranslations(
    "disputes.evidenceTab.sections.summary.nextStep",
  );
  const tAutoCopy = useTranslations("disputes.evidenceTab.automation");

  const display = toDisplayStrength(props.strength);
  const showExplanation =
    props.strength !== "strong" &&
    (Boolean(props.strengthReasonText) || Boolean(props.improvementHintText));

  const strengthColors = STRENGTH_PILL[display];
  const statusColors = STATUS_PILL[props.status];
  const autoColors = AUTOMATION_PILL[props.automationMode];

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E1E3E5",
        borderRadius: 12,
        padding: 20,
      }}
    >
      {/* Lead block: three vertically-stacked label+content groups
          arranged in a single row.
            - Left  : "Case summary" caption · strength badge + headline
            - Right : "Status" caption · pill ; "Automation" caption · pill
          Each group renders the label as a small subdued caption above
          its main element — same pattern, just three groups in a row.
          Wraps on narrow viewports so the right pair drops underneath
          the headline instead of clipping. */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 24,
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 0,
          }}
        >
          <p
            style={{
              fontSize: 12,
              color: "#6D7175",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {t("title")}
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            {/* Pill-shaped strength badge — the dominant visual element
                in the lead row. Slightly larger padding than the
                right-side Status/Automation pills to match the design. */}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 12px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                background: strengthColors.bg,
                color: strengthColors.color,
              }}
            >
              {tStrength(display)}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, color: "#202223" }}>
              {nextStepCopy(props.nextStep, tNext)}
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <p
              style={{
                fontSize: 12,
                color: "#6D7175",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {t("statusLabel")}
            </p>
            <Pill bg={statusColors.bg} color={statusColors.color}>
              {tStatus(props.status)}
            </Pill>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <p
              style={{
                fontSize: 12,
                color: "#6D7175",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {t("automationLabel")}
            </p>
            <Pill bg={autoColors.bg} color={autoColors.color}>
              {tAuto(props.automationMode)}
            </Pill>
          </div>
        </div>
      </div>

      {/* "Why this strength" block — only renders when the case is
          not already strong and the backend produced at least one of
          strengthReason / improvementHint. Separated from the lead
          row by a top divider, matching the design's `.CS-why`
          border-top rule. The automation copy (e.g. "Review required
          before submission.") is folded into this block as a small
          subdued meta line, since the design groups them together
          rather than placing the meta line at the card's bottom. */}
      {showExplanation ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid #E1E3E5",
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#202223",
              margin: "0 0 6px",
              lineHeight: 1.4,
            }}
          >
            {t("whyLabel")}
          </h3>
          {props.strengthReasonText ? (
            <p
              style={{
                fontSize: 13,
                color: "#4B5563",
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {props.strengthReasonText}
            </p>
          ) : null}
          {props.improvementHintText ? (
            <div style={{ marginTop: 8 }}>
              <p
                style={{
                  fontSize: 12,
                  color: "#6D7175",
                  margin: "0 0 2px",
                  lineHeight: 1.4,
                }}
              >
                {t("improveLabel")}
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: "#4B5563",
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                {props.improvementHintText}
              </p>
            </div>
          ) : null}
          <p
            style={{
              fontSize: 12,
              color: "#6D7175",
              margin: "10px 0 0",
              lineHeight: 1.4,
            }}
          >
            {props.automationMode === "automatic"
              ? tAutoCopy("automatic")
              : tAutoCopy("reviewRequired")}
          </p>
        </div>
      ) : (
        <p
          style={{
            fontSize: 12,
            color: "#6D7175",
            margin: "16px 0 0",
            paddingTop: 16,
            borderTop: "1px solid #E1E3E5",
            lineHeight: 1.4,
          }}
        >
          {props.automationMode === "automatic"
            ? tAutoCopy("automatic")
            : tAutoCopy("reviewRequired")}
        </p>
      )}
    </div>
  );
}
