/**
 * The only formatter for Insights numbers (page, emails, digest view).
 * Raw values are stored; formatting happens here, per locale, so a stored
 * month never freezes one language's number format and the email and the
 * page render the same raw number the same way.
 */

import type { CheckpointValue } from "@/lib/insights/checkpoints.types";

/** A ratio (0.00149) as a percent string ("0.15%"). */
export function formatRatio(ratio: number | null | undefined, locale: string, digits = 2): string {
  if (ratio === null || ratio === undefined) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio);
}

/** A percent value in percent units (0.15 = 0.15%). */
export function formatPercentUnits(v: number, locale: string, digits: number): string {
  return formatRatio(v / 100, locale, digits);
}

export function formatCount(n: number | null | undefined, locale: string): string {
  return n === null || n === undefined ? "—" : new Intl.NumberFormat(locale).format(n);
}

/** Hours as "18.0 h" under a day, else days ("1.6 d"). */
export function formatHours(h: number | null | undefined, locale: string): string {
  if (h === null || h === undefined) return "—";
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return h < 24 ? `${nf.format(h)} h` : `${nf.format(h / 24)} d`;
}

/** "2026-09-01" → "September 2026" in the locale. Mid-month UTC noon, so no
 *  viewer time zone shifts the month. */
export function formatMonth(iso: string, locale: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, m! - 1, 15, 12)),
  );
}

export function formatCheckpointValue(v: CheckpointValue, locale: string): string | number {
  if (typeof v !== "object") return v;
  switch (v.format) {
    case "month":
      return formatMonth(v.value, locale);
    case "hours":
      return formatHours(v.value, locale);
    default:
      return formatPercentUnits(v.value, locale, Number(v.format.slice(3)));
  }
}

export function formatCheckpointValues(
  values: Record<string, CheckpointValue>,
  locale: string,
): Record<string, string | number> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, formatCheckpointValue(v, locale)]));
}
