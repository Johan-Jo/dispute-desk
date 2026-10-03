/**
 * When a closed month may become `final` — eligible for the email and the
 * page's default view (docs/plans/insights-single-source.plan.md §2.3).
 *
 * Final does not mean immutable: later corrections are logged revisions.
 *
 * The import's completion date does NOT bound stability. Months before it
 * were covered by the backfill, months after it by live ingest; an earlier
 * draft required completed_at ≥ month end, which no month after the import
 * could ever meet (blume-box completed 2026-07-21).
 */

import { finalOn } from "./months";

export interface StabilityShop {
  historical_import_status: string | null;
  historical_import_completed_at: string | null;
  historical_import_since_date: string | null;
}

/** 'partial' when the import started after the month began: a full-month
 *  ratio from part of a month would be wrong, so it never becomes final. */
export function monthCoverage(shop: StabilityShop, month: string): "full" | "partial" {
  const since = shop.historical_import_since_date;
  return since != null && since.slice(0, 10) > month ? "partial" : "full";
}

export function canMarkStable(shop: StabilityShop, month: string, now: Date): boolean {
  return (
    now.getTime() >= new Date(finalOn(month)).getTime() &&
    shop.historical_import_status === "complete" &&
    shop.historical_import_completed_at != null &&
    monthCoverage(shop, month) === "full"
  );
}
