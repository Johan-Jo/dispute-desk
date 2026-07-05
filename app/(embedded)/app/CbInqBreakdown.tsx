"use client";

import { useTranslations } from "next-intl";
import type { CbInqSplit } from "./dashboardHelpers";

/**
 * Modest "N cb · N inq" breakdown line (Dashboard v3).
 *
 * `cb` = chargebacks (funds already withdrawn, amber). `inq` = inquiries
 * (no funds withdrawn yet, blue). Rendered as a small subdued footer under
 * operational cards, KPI tiles, dispute-category rows, and outcome rows so
 * merchants can see how much of each number is inquiries vs true
 * chargebacks — the single functional addition of the v3 dashboard.
 *
 * `format` controls how each side's value is rendered:
 *   - "count" (default): raw integer (e.g. "2 cb · 24 inq")
 *   - "money":  pass a `formatValue` that turns the number into a currency
 *     string; the split's cb/inq are treated as amounts, not counts.
 * Returns null when both sides are zero so empty cards stay clean.
 */
const INQ = "#4C6EF5";
const CB = "#E0A800";
const SEP = "#C9CDD2";
const TEXT = "#6D7175";
const BOLD = "#4B5058";

export function CbInqBreakdown({
  split,
  formatValue,
  size = "sm",
}: {
  split: CbInqSplit | undefined;
  /** When provided, cb/inq are rendered through this (e.g. currency). */
  formatValue?: (v: number) => string;
  size?: "xs" | "sm";
}) {
  const t = useTranslations("dashboard");
  if (!split) return null;
  if (split.cb === 0 && split.inq === 0) return null;

  const fontSize = size === "xs" ? "11px" : "11.5px";
  const dot = (color: string) => (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );
  const val = (v: number) => (formatValue ? formatValue(v) : String(v));

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize,
        color: TEXT,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {dot(CB)}
      <span>
        <b style={{ color: BOLD, fontWeight: 600 }}>{val(split.cb)}</b>{" "}
        {t("cbShort")}
      </span>
      <span style={{ color: SEP, margin: "0 1px" }}>·</span>
      {dot(INQ)}
      <span>
        <b style={{ color: BOLD, fontWeight: 600 }}>{val(split.inq)}</b>{" "}
        {t("inqShort")}
      </span>
    </span>
  );
}

/**
 * One-line legend for the Performance Overview header:
 * "● cb = chargeback   ● inq = inquiry". Purely explanatory.
 */
export function CbInqKey() {
  const t = useTranslations("dashboard");
  const item = (color: string, label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        fontSize: "12px",
        color: TEXT,
      }}
    >
      {item(CB, t("cbLegend"))}
      {item(INQ, t("inqLegend"))}
    </span>
  );
}
