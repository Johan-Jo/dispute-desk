/**
 * SubmissionSummaryPanel — "What was/will be saved to Shopify".
 *
 * Single source of truth for the six-subsection submission summary on
 * the Overview tab. Everything in this component derives from the same
 * `EvidenceLineItem[]` + `SubmissionSummary` that the rest of the
 * dispute-detail UI reads — no parallel logic, no inferred counts.
 *
 * The component is read-only. Header tense switches between
 * "What will be saved" (DRAFT) and "What was saved" (post-save).
 *
 * Subsections (each renders iff its count > 0, except #1):
 *   1. Saved as structured Shopify fields  — customer name + email
 *      (always renders; these are the only structured fields sent)
 *   2. Included in the defence package     — `factsInPdf`
 *   3. Used as positive bank argument      — usedAsPositiveBankEvidence rows
 *   4. Context only                        — context_only rows
 *   5. Kept internal                       — internal_only rows
 *   6. Not included                        — excluded + waived + failed_upload +
 *                                            not_supported counts
 */

"use client";

import { useMemo } from "react";
import { BlockStack, Card, InlineStack, Text, Badge } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type {
  PresentationStatus,
  SubmissionSummary,
} from "../../workspace-components/types";
import type { EvidenceLineItem } from "@/lib/argument/evidenceLineItem";

interface Props {
  summary: SubmissionSummary;
  lineItems: EvidenceLineItem[];
  presentationStatus: PresentationStatus;
}

function isSavedState(s: PresentationStatus): boolean {
  return (
    s === "SAVED_TO_SHOPIFY" ||
    s === "AWAITING_SHOPIFY_AUTO_SUBMISSION" ||
    s === "SUBMITTED_TO_NETWORK" ||
    s === "CLOSED_WON" ||
    s === "CLOSED_LOST" ||
    s === "CLOSED_UNKNOWN"
  );
}

/**
 * Subsection accent — a small color-coded dot sits to the left of the
 * heading so the merchant can scan the six buckets at a glance.
 * Colors line up with the rest of the dispute-detail palette:
 *   - bank_argument / positive    → green
 *   - context_only                → neutral grey
 *   - internal_only               → amber
 *   - not_included                → red
 *   - structured / pdf            → indigo (neutral "what we sent")
 */
type AccentTone =
  | "indigo"
  | "indigoStrong"
  | "green"
  | "neutral"
  | "amber"
  | "critical";

const ACCENT_COLOR: Record<AccentTone, string> = {
  indigo: "#C7D2FE",
  indigoStrong: "#6366F1",
  green: "#22C55E",
  neutral: "#9CA3AF",
  amber: "#F59E0B",
  critical: "#EF4444",
};

/** Subsection wrapper — consistent label + helper + body layout. */
function Subsection({
  label,
  helper,
  children,
  count,
  accent,
}: {
  label: string;
  helper: string;
  count?: number | null;
  accent: AccentTone;
  children: React.ReactNode;
}) {
  return (
    <BlockStack gap="150">
      <InlineStack gap="200" blockAlign="center">
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 9999,
            background: ACCENT_COLOR[accent],
            flex: "0 0 8px",
          }}
        />
        <Text as="h4" variant="headingSm">
          {label}
        </Text>
        {typeof count === "number" && count > 0 ? (
          <Badge>{`${count}`}</Badge>
        ) : null}
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued">
        {helper}
      </Text>
      {children}
    </BlockStack>
  );
}

export function SubmissionSummaryPanel({
  summary,
  lineItems,
  presentationStatus,
}: Props) {
  const t = useTranslations("disputes.overview.submissionSummary");
  const saved = isSavedState(presentationStatus);

  const bankArgumentRows = useMemo(
    () => lineItems.filter((li) => li.usedAsPositiveBankEvidence),
    [lineItems],
  );
  const contextOnlyRows = useMemo(
    () => lineItems.filter((li) => li.submissionMethod === "context_only"),
    [lineItems],
  );
  const internalRows = useMemo(
    () => lineItems.filter((li) => li.submissionMethod === "internal_only"),
    [lineItems],
  );

  const { counts } = summary;
  const notIncludedTotal =
    counts.excluded + counts.waived + counts.failedUpload + counts.notSupported;

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {saved ? t("titlePostSave") : t("titlePreSave")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {saved ? t("subtitlePostSave") : t("subtitlePreSave")}
          </Text>
        </BlockStack>

        {/* §1 Structured Shopify fields — always renders.
            Values render as a clean stack with no per-field label;
            the section's `shopifyFieldsHelper` already tells the
            merchant what the three rows are ("Customer name and
            email — the only structured fields DisputeDesk sends.").
            The order is stable (first name, last name, email) so
            the values are self-describing. */}
        <Subsection
          label={t("shopifyFieldsLabel")}
          helper={t("shopifyFieldsHelper")}
          accent="indigo"
        >
          <BlockStack gap="050">
            {summary.shopifyStructuredFields.map((f) => (
              <Text
                key={f.field}
                as="span"
                variant="bodySm"
                tone={f.value ? undefined : "subdued"}
              >
                {f.value ?? t("shopifyFieldsNoneOnFile")}
              </Text>
            ))}
          </BlockStack>
        </Subsection>

        {/* §2 Included in defence package — facts inside the PDF. */}
        <Subsection
          label={t("includedInPackageLabel")}
          helper={t("includedInPackageHelper")}
          count={summary.factsInPdf.length}
          accent="indigoStrong"
        >
          {summary.factsInPdf.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {t("includedInPackageEmpty")}
            </Text>
          ) : (
            <BlockStack gap="050">
              {summary.pdfFileName ? (
                <Text as="p" variant="bodyXs" tone="subdued">
                  {t("includedInPackagePdfLine", {
                    pdfFileName: summary.pdfFileName,
                  })}
                </Text>
              ) : null}
              {/* Just the human-readable label per fact. The internal
                  category key (e.g. `payment_authentication`) used to
                  render in a trailing column — leaked engineering
                  detail with no merchant value. */}
              {summary.factsInPdf.map((f) => (
                <Text key={f.field} as="span" variant="bodySm">
                  {f.label}
                </Text>
              ))}
            </BlockStack>
          )}
        </Subsection>

        {/* §3 Used as positive bank argument. */}
        <Subsection
          label={t("bankArgumentLabel")}
          helper={t("bankArgumentHelper")}
          count={bankArgumentRows.length}
          accent="green"
        >
          {bankArgumentRows.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {t("bankArgumentEmpty")}
            </Text>
          ) : (
            <BlockStack gap="050">
              {bankArgumentRows.map((r) => (
                <Text key={r.field} as="span" variant="bodySm">
                  {r.label}
                </Text>
              ))}
            </BlockStack>
          )}
        </Subsection>

        {/* §4 Context only — only renders when populated. */}
        {contextOnlyRows.length > 0 ? (
          <Subsection
            label={t("contextOnlyLabel")}
            helper={t("contextOnlyHelper")}
            count={contextOnlyRows.length}
            accent="neutral"
          >
            <BlockStack gap="050">
              {contextOnlyRows.map((r) => (
                <Text key={r.field} as="span" variant="bodySm">
                  {r.label}
                </Text>
              ))}
            </BlockStack>
          </Subsection>
        ) : null}

        {/* §5 Kept internal — only renders when populated. */}
        {internalRows.length > 0 ? (
          <Subsection
            label={t("keptInternalLabel")}
            helper={t("keptInternalHelper")}
            count={internalRows.length}
            accent="amber"
          >
            <BlockStack gap="050">
              {internalRows.map((r) => (
                <Text key={r.field} as="span" variant="bodySm">
                  {r.label}
                </Text>
              ))}
              <Text as="p" variant="bodyXs" tone="subdued">
                {t("keptInternalSeeEvidenceTab")}
              </Text>
            </BlockStack>
          </Subsection>
        ) : null}

        {/* §6 Not included — collapsed counts for excluded/waived/
            failed_upload/not_supported. Only renders when any > 0. */}
        {notIncludedTotal > 0 ? (
          <Subsection
            label={t("notIncludedLabel")}
            helper={t("notIncludedHelper")}
            count={notIncludedTotal}
            accent="critical"
          >
            <BlockStack gap="050">
              {counts.failedUpload > 0 ? (
                <Text as="span" variant="bodySm" tone="critical">
                  {t("notIncludedFailedUpload", { count: counts.failedUpload })}
                </Text>
              ) : null}
              {counts.excluded > 0 ? (
                <Text as="span" variant="bodySm">
                  {t("notIncludedExcluded", { count: counts.excluded })}
                </Text>
              ) : null}
              {counts.waived > 0 ? (
                <Text as="span" variant="bodySm">
                  {t("notIncludedWaived", { count: counts.waived })}
                </Text>
              ) : null}
              {counts.notSupported > 0 ? (
                <Text as="span" variant="bodySm">
                  {t("notIncludedNotSupported", { count: counts.notSupported })}
                </Text>
              ) : null}
            </BlockStack>
          </Subsection>
        ) : null}
      </BlockStack>
    </Card>
  );
}
