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

import { useTranslations, useLocale } from "next-intl";
import { resolveToken } from "@/lib/i18n/resolveToken";
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
  won: { bg: "#D1FAE5", color: "#065F46" },
  lost: { bg: "#FEE2E2", color: "#991B1B" },
  closed: { bg: "#F1F2F3", color: "#4B5563" },
};

const AUTOMATION_PILL: Record<AutomationMode, { bg: string; color: string }> = {
  automatic: { bg: "#D1FAE5", color: "#065F46" },
  review_required: { bg: "#FEF3C7", color: "#92400E" },
};

/**
 * Format a due-date for inline use inside next-step copy. Uses the
 * active next-intl locale so the date matches the rest of the UI. Falls
 * back to a sentinel the caller swaps for "the deadline" copy.
 */
function formatDueDate(dueAt: string | null, locale: string): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(d);
}

/** next-intl ships strict per-key typings that don't model nested
 *  variant suffixes well. Widen to a generic translator at the boundary
 *  so we can interpolate `{dueDate}` from a runtime-computed key. */
type LooseTranslate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

function nextStepCopy(
  step: NextStep,
  tNext: ReturnType<typeof useTranslations>,
  locale: string,
): string {
  // Verifier-friendly explicit calls so scripts/verify-i18n-keys.mjs can
  // statically resolve the namespace (it doesn't follow aliased
  // translator vars through helper functions).
  if (step.kind === "submitted_no_action") return tNext("submittedNoAction");
  if (step.kind === "review_missing") return tNext("reviewMissing");
  // No assessment: the headline states the state and nothing else. It must not
  // fall through to `review_missing`, which instructs the merchant to go and
  // find missing evidence we have not established is missing.
  if (step.kind === "not_assessed") return "";

  const loose = tNext as unknown as LooseTranslate;
  const dueDate = formatDueDate(step.dueAt, locale);
  if (dueDate) return loose(`${step.kind}.WithDate`, { dueDate });
  return loose(`${step.kind}.NoDate`);
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
  const tAssessment = useTranslations("disputes.assessmentState");
  const tRoot = useTranslations();
  const locale = useLocale();

  /* NO ASSESSMENT, NO BADGE.
   *
   * `props.strength` is null exactly when there is no current assessment, and
   * `toDisplayStrength` coerces `insufficient` to "Weak" — so before this
   * branch an unassessed case rendered a WEAK verdict badge. The badge is
   * replaced by a neutral state chip; nothing infers a band. */
  const notAssessed = props.nextStep.kind === "not_assessed";
  const display = props.strength ? toDisplayStrength(props.strength) : null;
  const showExplanation =
    !notAssessed &&
    props.strength !== "strong" &&
    (Boolean(props.strengthReasonText) || Boolean(props.improvementHintText));

  const strengthColors = display ? STRENGTH_PILL[display] : null;
  const statusColors = STATUS_PILL[props.status];
  // null automationMode → decided dispute: no automation pill at all.
  const autoColors = props.automationMode ? AUTOMATION_PILL[props.automationMode] : null;

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
            {display && strengthColors ? (
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
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  background: "#F1F2F3",
                  color: "#6D7175",
                }}
              >
                {tAssessment("notAssessed.title")}
              </span>
            )}
            <span style={{ fontSize: 16, fontWeight: 600, color: "#202223" }}>
              {props.status === "won" || props.status === "lost" || props.status === "closed"
                ? t(`outcomeHeadline.${props.status}`)
                : notAssessed
                  ? tAssessment("notAssessed.title")
                  : nextStepCopy(props.nextStep, tNext, locale)}
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
          {autoColors && props.automationMode && (
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
          )}
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
      {/* THE EXPLICIT STATE.
        *
        * Rendered instead of the strength explanation, never beside it: the
        * merchant is owed a reason there is no number, and an empty card is
        * indistinguishable from a broken one. `bodyToken` distinguishes "not
        * assessed yet" from "the evidence moved after we assessed it" — two
        * different situations that read the same as silence. */}
      {props.nextStep.kind === "not_assessed" ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid #E1E3E5",
          }}
        >
          <p
            style={{
              fontSize: 13,
              color: "#6D7175",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {resolveToken(tRoot, props.nextStep.bodyToken)}
          </p>
        </div>
      ) : null}

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
          {/* No automation line on a DECIDED dispute (automationMode null)
              — "Review required before submission" is false once settled. */}
          {props.automationMode && (
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
          )}
        </div>
      ) : props.automationMode ? (
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
      ) : null}
    </div>
  );
}
