/**
 * EvidenceUsedSection — unified evidence card for the Evidence tab.
 *
 * Matches the Dispute Page Evidence Tab redesign: one card carrying
 * up to four disposition sections, each marked by a coloured chip that
 * names the bucket and the count. Same green/grey/amber/red disposition
 * model used by the Overview tab's coverage card + submission summary,
 * so the two tabs read as one system.
 *
 * Four buckets (rendered top-to-bottom, empty buckets collapse):
 *   1. Used as positive bank argument   — `usedAsPositiveBankEvidence`
 *   2. Context only                     — in PDF, not relied on as proof
 *   3. Kept internal                    — internal-only signals (assessment,
 *                                          not submitted; banks treat as
 *                                          weakening)
 *   4. On file — not included           — present on the order but not
 *                                          part of the bank-facing argument
 *
 * The standalone "Internal-only signals" card is folded in as bucket 3
 * so the merchant sees one source of truth for what's where; the
 * previous duplication (IP & Location appearing in both "On file" and
 * the standalone card) is gone.
 *
 * Each row carries ONE pill — the strength contribution. The bucket
 * IS the disposition, so the per-row "Package status" + "Bank argument
 * status" badges from the previous version are removed as redundant.
 */

"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type {
  EvidenceRowViewModel,
  InternalSignalViewModel,
} from "../useEvidenceSections";
import type { EvidenceLineItem } from "@/lib/argument/evidenceLineItem";
import { EvidenceRow, InternalSignalRow } from "./EvidenceRow";

type Disposition = "positive" | "context" | "internal" | "excluded";

const DISPOSITION_COLORS: Record<
  Disposition,
  { dot: string; chipBg: string; chipText: string }
> = {
  positive: { dot: "#22C55E", chipBg: "#DCFCE7", chipText: "#065F46" },
  context: { dot: "#9CA3AF", chipBg: "#F3F4F6", chipText: "#374151" },
  internal: { dot: "#F59E0B", chipBg: "#FEF3C7", chipText: "#78350F" },
  excluded: { dot: "#EF4444", chipBg: "#FEE2E2", chipText: "#991B1B" },
};

function bucketForRow(
  row: EvidenceRowViewModel,
  lineItem: EvidenceLineItem | undefined,
): "positive" | "context" | "excluded" {
  if (lineItem) {
    if (lineItem.usedAsPositiveBankEvidence) return "positive";
    if (lineItem.includedInDefencePackage) return "context";
    return "excluded";
  }
  // Fallback when evidenceLineItems hasn't loaded yet — match the
  // historical split: strong/moderate → positive, supporting →
  // excluded. The context bucket stays empty in the fallback path so
  // we under-claim rather than over-claim where it goes.
  return row.strength === "supporting" ? "excluded" : "positive";
}

/**
 * One disposition section: the chip header + helper + the rows.
 * Sections are separated from each other by a top border on every
 * section except the first, mirroring the design's `.EvSection +
 * .EvSection { border-top }` rule.
 */
function DispositionSection({
  disposition,
  title,
  helper,
  count,
  children,
  isFirst,
}: {
  disposition: Disposition;
  title: string;
  helper: string;
  count: number;
  children: React.ReactNode;
  isFirst: boolean;
}) {
  const colors = DISPOSITION_COLORS[disposition];
  return (
    <div
      style={{
        paddingTop: isFirst ? 0 : 12,
        marginTop: isFirst ? 0 : 16,
        borderTop: isFirst ? "0" : "1px solid #E1E3E5",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 4,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            background: colors.chipBg,
            color: colors.chipText,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: colors.dot,
            }}
          />
          {title}{" "}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{count}</span>
        </span>
      </div>
      <p
        style={{
          fontSize: 12.5,
          color: "#6D7175",
          lineHeight: 1.4,
          margin: "0 0 12px",
        }}
      >
        {helper}
      </p>
      {children}
    </div>
  );
}

export function EvidenceUsedSection({
  items,
  lineItems,
  internalSignals,
}: {
  items: EvidenceRowViewModel[];
  lineItems: EvidenceLineItem[];
  /**
   * Internal-only signals — surfaced as the third disposition bucket
   * instead of as a separate card below. Empty array collapses the
   * bucket out of the visual.
   */
  internalSignals: InternalSignalViewModel[];
}) {
  const t = useTranslations("disputes.evidenceTab.sections.used");

  const lineItemsByField = useMemo(() => {
    const m = new Map<string, EvidenceLineItem>();
    for (const li of lineItems) m.set(li.field, li);
    return m;
  }, [lineItems]);

  const buckets: Record<
    "positive" | "context" | "excluded",
    EvidenceRowViewModel[]
  > = { positive: [], context: [], excluded: [] };
  for (const item of items) {
    const li = lineItemsByField.get(item.field);
    buckets[bucketForRow(item, li)].push(item);
  }

  const positiveFields = buckets.positive.map((r) => r.title);
  const explainer =
    buckets.positive.length > 0
      ? t("explainerHasBankFacing", { fields: positiveFields.join(", ") })
      : t("explainerNoBankFacing");

  const renderRows = (rows: EvidenceRowViewModel[]) =>
    rows.map((item) => (
      <EvidenceRow
        key={item.id}
        item={item}
        lineItem={lineItemsByField.get(item.field)}
      />
    ));

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E1E3E5",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#202223",
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {t("title")}
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "#6D7175",
            lineHeight: 1.5,
            margin: "4px 0 0",
          }}
        >
          {explainer}
        </p>
      </div>

      {buckets.positive.length > 0 ? (
        <DispositionSection
          disposition="positive"
          title={t("groupUsedInBankArgument")}
          helper={t("groupUsedInBankArgumentCaption")}
          count={buckets.positive.length}
          isFirst
        >
          {renderRows(buckets.positive)}
        </DispositionSection>
      ) : null}

      {buckets.context.length > 0 ? (
        <DispositionSection
          disposition="context"
          title={t("groupContextOnly")}
          helper={t("groupContextOnlyCaption")}
          count={buckets.context.length}
          isFirst={buckets.positive.length === 0}
        >
          {renderRows(buckets.context)}
        </DispositionSection>
      ) : null}

      {internalSignals.length > 0 ? (
        <DispositionSection
          disposition="internal"
          title={t("groupKeptInternal")}
          helper={t("groupKeptInternalCaption")}
          count={internalSignals.length}
          isFirst={
            buckets.positive.length === 0 && buckets.context.length === 0
          }
        >
          {internalSignals.map((signal) => (
            <InternalSignalRow key={signal.id} signal={signal} />
          ))}
        </DispositionSection>
      ) : null}

      {buckets.excluded.length > 0 ? (
        <DispositionSection
          disposition="excluded"
          title={t("groupNotIncluded")}
          helper={t("groupNotIncludedCaption")}
          count={buckets.excluded.length}
          isFirst={
            buckets.positive.length === 0 &&
            buckets.context.length === 0 &&
            internalSignals.length === 0
          }
        >
          {renderRows(buckets.excluded)}
        </DispositionSection>
      ) : null}
    </div>
  );
}
