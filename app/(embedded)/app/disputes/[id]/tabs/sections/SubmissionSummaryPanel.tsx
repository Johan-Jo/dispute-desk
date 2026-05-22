/**
 * SubmissionSummaryPanel — "What was/will be saved to Shopify".
 *
 * Single source of truth for the submission summary on the Overview
 * tab. Everything in this component derives from the same
 * `EvidenceLineItem[]` + `SubmissionSummary` that the rest of the
 * dispute-detail UI reads — no parallel logic, no inferred counts.
 *
 * The component is read-only. Header tense switches between
 * "What will be saved" (DRAFT) and "What was saved" (post-save).
 *
 * Layout (matches the Dispute Page Overview design):
 *   - Header: title + subtitle line.
 *   - Inline "Structured fields" strip on tinted background — the
 *     three shopifyStructuredFields collapsed to a single row
 *     ("Customer: <name> · Email: <email>"). These are the only
 *     structured fields DisputeDesk sends; everything else travels
 *     inside the PDF.
 *   - 2×2 disposition grid that mirrors the Evidence coverage legend
 *     above: Positive arguments (green) · Context only (neutral) ·
 *     Kept internal (amber) · Not included (red). Each cell lists the
 *     evidence rows in that bucket; the "Not included" cell collapses
 *     excluded / waived / failed_upload / not_supported into a single
 *     count line.
 *
 * The "Included in defence package" wrapper that used to render
 * around §2 (factsInPdf) is gone — it was redundant with the Positive
 * arguments cell, and the Evidence coverage card above already shows
 * the included-in-package headline.
 */

"use client";

import { useMemo } from "react";
import { BlockStack, Card, Text } from "@shopify/polaris";
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
 * Disposition swatches — line up 1:1 with the Evidence coverage
 * legend cells in OverviewTab so the two cards read as summary +
 * detail of the same model.
 */
type Disposition = "positive" | "context" | "internal" | "excluded";
// Disposition swatches kept in lockstep with OverviewTab's DISP map —
// positive (`#059669`) + internal (`#D97706`) use the darker Hero
// tones so the dots here don't read as a second slightly-different
// green/amber against the same screen.
const DISP_COLOR: Record<Disposition, string> = {
  positive: "#059669",
  context: "#9CA3AF",
  internal: "#D97706",
  excluded: "#EF4444",
};

interface DispositionCellProps {
  disposition: Disposition;
  title: string;
  countLine: string;
  /** Rows to list. Empty array renders nothing inside the cell. */
  rows?: Array<{ field: string; label: string; note?: string }>;
  /**
   * Single text node to render instead of `rows` — used by the "Not
   * included" cell which collapses excluded/waived/failed/unsupported
   * counts into one line.
   */
  body?: React.ReactNode;
  borderRight?: boolean;
  borderBottom?: boolean;
}

function DispositionCell({
  disposition,
  title,
  countLine,
  rows,
  body,
  borderRight,
  borderBottom,
}: DispositionCellProps) {
  const muted = disposition === "excluded";
  return (
    <div
      style={{
        padding: "14px 18px 14px 34px",
        borderRight: borderRight ? "1px solid #E1E3E5" : "0",
        borderBottom: borderBottom ? "1px solid #E1E3E5" : "0",
        position: "relative",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 17,
          left: 18,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: DISP_COLOR[disposition],
        }}
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <h4
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#202223",
            margin: 0,
            lineHeight: 1.3,
          }}
        >
          {title}
        </h4>
        <span style={{ fontSize: 11, color: "#6D7175", fontVariantNumeric: "tabular-nums" }}>
          {countLine}
        </span>
      </div>
      {body ? (
        <div style={{ fontSize: 13, color: muted ? "#6D7175" : "#202223", lineHeight: 1.45 }}>
          {body}
        </div>
      ) : rows && rows.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map((r) => (
            <li
              key={r.field}
              style={{
                fontSize: 13,
                lineHeight: 1.45,
                color: muted ? "#6D7175" : "#202223",
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignItems: "baseline",
              }}
            >
              <span style={{ fontWeight: 500 }}>{r.label}</span>
              {r.note ? (
                <span style={{ color: "#6D7175", fontSize: 12, fontStyle: "italic" }}>
                  {r.note}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
  // `notIncludedRows` (built below) is the canonical source for both
  // the cell's row list AND its count — derived directly from
  // lineItems so it stays consistent with the Evidence-coverage card,
  // which counts the same five submissionMethod buckets.

  /**
   * Collapse the three shopifyStructuredFields (first name / last
   * name / email) into a single inline KV strip. The first two are
   * joined as the customer's full name; missing values render as "—".
   */
  const firstName =
    summary.shopifyStructuredFields.find((f) => f.field === "customer_first_name")?.value ?? null;
  const lastName =
    summary.shopifyStructuredFields.find((f) => f.field === "customer_last_name")?.value ?? null;
  const email =
    summary.shopifyStructuredFields.find((f) => f.field === "customer_email")?.value ?? null;
  const customerName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const dash = t("shopifyFieldsNoneOnFile");

  /**
   * Compose the rows for the four disposition cells. The internal
   * row carries a small italic note clarifying why it stayed
   * internal — matches the design's "internal-only signal for banks"
   * caption.
   */
  const internalNote = t("internalSignalNote");
  const internalDispRows = internalRows.map((r) => ({
    field: r.field,
    label: r.label,
    note: internalNote,
  }));

  /**
   * Rows for the "Not included" cell — actual line items instead of
   * an aggregate count clause. Mirrors the other three cells so the
   * merchant can see WHICH fields fall here, not just how many. Each
   * row carries a small italic note naming the sub-reason
   * (waived / excluded by you / failed upload / no bank-facing slot
   * / on file but not part of the argument). Without this the cell
   * showed "Not included 3 · marked N/A" with no way to identify
   * which three rows it meant.
   */
  const notIncludedRows = lineItems
    .filter(
      (li) =>
        li.submissionMethod === "excluded" ||
        li.submissionMethod === "waived" ||
        li.submissionMethod === "failed_upload" ||
        li.submissionMethod === "not_supported" ||
        li.submissionMethod === "not_included",
    )
    .map((li) => ({
      field: li.field,
      label: li.label,
      note: (() => {
        switch (li.submissionMethod) {
          case "failed_upload":
            return t("notIncludedRowFailedUpload");
          case "excluded":
            return t("notIncludedRowExcluded");
          case "waived":
            return t("notIncludedRowWaived");
          case "not_supported":
            return t("notIncludedRowNotSupported");
          default:
            return t("notIncludedRowOnOrder");
        }
      })(),
    }));
  const notIncludedTotal = notIncludedRows.length;
  // `summary.counts` is still read below for the `factsInPdf` /
  // structured-fields blocks; keep the destructured reference here
  // so the local `counts` binding isn't removed elsewhere.
  void counts;

  return (
    <Card padding="500">
      <BlockStack gap="100">
        <Text as="h2" variant="headingMd">
          {saved ? t("titlePostSave") : t("titlePreSave")}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {t("subtitleCompact")}
        </Text>
      </BlockStack>

      {/* Structured fields inline strip — single tinted row that flows
          edge-to-edge of the card. The strip is "lede + 2 KV pairs",
          not a sub-card, to keep the merchant from confusing identity
          plumbing with evidence content. */}
      <div
        style={{
          margin: "14px -20px 0",
          padding: "12px 20px",
          borderTop: "1px solid #E1E3E5",
          background: "#FAFBFB",
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 28px",
          fontSize: 13,
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            color: "#6D7175",
            fontSize: 11.5,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          {t("structuredFieldsLede")}
        </span>
        <InlineKV k={t("structuredFieldsCustomer")} v={customerName || dash} />
        <InlineKV k={t("structuredFieldsEmail")} v={email ?? dash} />
      </div>

      {/* 2×2 disposition grid — flush to the card edges. Borders are
          drawn cell-side so the four cells stitch together cleanly,
          matching the Evidence coverage legend strip above. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 0,
          margin: "0 -20px -20px",
          borderTop: "1px solid #E1E3E5",
        }}
      >
        <DispositionCell
          disposition="positive"
          title={t("bankArgumentLabel")}
          countLine={t("dispositionPositiveCount", { count: bankArgumentRows.length })}
          rows={bankArgumentRows.map((r) => ({ field: r.field, label: r.label }))}
          borderRight
          borderBottom
        />
        <DispositionCell
          disposition="context"
          title={t("contextOnlyLabel")}
          countLine={t("dispositionContextCount", { count: contextOnlyRows.length })}
          rows={contextOnlyRows.map((r) => ({ field: r.field, label: r.label }))}
          borderBottom
        />
        <DispositionCell
          disposition="internal"
          title={t("keptInternalLabel")}
          countLine={t("dispositionInternalCount", { count: internalRows.length })}
          rows={internalDispRows}
          borderRight
        />
        <DispositionCell
          disposition="excluded"
          title={t("notIncludedLabel")}
          countLine={t("dispositionExcludedCount", { count: notIncludedTotal })}
          rows={notIncludedRows}
          body={notIncludedTotal === 0 ? t("notIncludedEmpty") : undefined}
        />
      </div>
    </Card>
  );
}

function InlineKV({ k, v }: { k: string; v: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline" }}>
      <span style={{ color: "#6D7175", fontSize: 12 }}>{k}</span>
      <span
        style={{
          color: "#202223",
          fontWeight: 500,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12.5,
        }}
      >
        {v}
      </span>
    </span>
  );
}
