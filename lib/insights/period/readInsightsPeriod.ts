/**
 * One month of Insights as the page (and, from PR4, the email) shows it,
 * read from the stored month record. Closed months are never recomputed on
 * read: a closed month without a complete record is `not_available`, said
 * out loud. Only the statement month (not yet recomputed) and the current
 * month-to-date are computed live, and labelled as such.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Checkpoint } from "@/lib/insights/checkpoints.types";
import type { ProgrammeMonth } from "./computeProgrammeBlock";
import type { OperationalMetrics } from "./computeOperationalMetrics";
import { computeShopMonth } from "./computeShopMonth";
import { finalOn } from "./months";
import { MONTH_COLUMNS, rowToProgrammeMonth } from "./readProgrammeMonth";
import { MIN_READABLE_METRICS_VERSION } from "./persistShopMonth";

export type PeriodState = "final" | "provisional" | "mtd";

export type InsightsPeriod =
  | {
      status: "ok";
      periodMonth: string;
      periodState: PeriodState;
      finalOn: string;
      /** Null when computed live (no record yet). */
      revision: number | null;
      revisedAt: string | null;
      programme: Extract<ProgrammeMonth, { status: "ok" }>;
      operational: OperationalMetrics;
      checkpoints: Checkpoint[];
    }
  | { status: "not_available" | "not_fully_imported" | "error"; periodMonth: string };

export type PeriodKind = "statement" | "closed" | "mtd";

export async function readInsightsPeriod(
  sb: SupabaseClient,
  shopId: string,
  month: string,
  kind: PeriodKind,
): Promise<InsightsPeriod> {
  try {
    if (kind !== "mtd") {
      const { data, error } = await sb
        .from("ratio_snapshots")
        .select(`${MONTH_COLUMNS}, revised_at, operational_metrics, checkpoints`)
        .eq("shop_id", shopId)
        .eq("period_month", month)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as Record<string, unknown> | null;
      if (row?.coverage === "partial") return { status: "not_fully_imported", periodMonth: month };
      const complete =
        row &&
        Number(row.metrics_version ?? 1) >= MIN_READABLE_METRICS_VERSION &&
        row.operational_metrics != null &&
        row.checkpoints != null;
      if (complete) {
        const programme = rowToProgrammeMonth(row) as Extract<ProgrammeMonth, { status: "ok" }>;
        return {
          status: "ok",
          periodMonth: month,
          periodState: programme.periodState,
          finalOn: finalOn(month),
          revision: Number(row.revision ?? 0),
          revisedAt: (row.revised_at as string | null) ?? null,
          programme,
          operational: row.operational_metrics as OperationalMetrics,
          checkpoints: row.checkpoints as Checkpoint[],
        };
      }
      // A closed month is never computed on read.
      if (kind === "closed") return { status: "not_available", periodMonth: month };
    }

    const live = await computeShopMonth(sb, shopId, month);
    return {
      status: "ok",
      periodMonth: month,
      periodState: kind === "mtd" ? "mtd" : "provisional",
      finalOn: finalOn(month),
      revision: null,
      revisedAt: null,
      programme: { status: "ok", periodState: "provisional", finalOn: finalOn(month), ...live.programme },
      operational: live.operational,
      checkpoints: live.checkpoints,
    };
  } catch (err) {
    console.error("[insights] period read failed:", err instanceof Error ? err.message : err);
    return { status: "error", periodMonth: month };
  }
}
