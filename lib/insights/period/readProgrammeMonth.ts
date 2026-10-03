/**
 * The statement month as every Insights route serves it: from the stored
 * month row (`ratio_snapshots`, written only by `persist_shop_month`), so the
 * page, the Liability-shift card and — from PR4 — the emails show the same
 * recorded figures.
 *
 * A month with no v2 row yet (the cron has not reached it) falls back to the
 * live `computeProgrammeBlock`, labelled provisional. Read errors become an
 * explicit `{status:"error"}`, never a blank card.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { ecmSeverity, roundRatio, vampSeverity } from "@/lib/insights/programmeThresholds";
import { programmeMonthFor, type ProgrammeMonth } from "./computeProgrammeBlock";
import { finalOn } from "./months";
import { METRICS_VERSION } from "./persistShopMonth";

const COLUMNS =
  "period_month, settled_count, tc40_count, vamp_ratio_calculated, vamp_ratio_without_dd, ce30_excluded_count, fpt_excluded_count, mc_ecm_ratio, mc_efm_fraud_count, estimated_revenue_recovered_usd, card_chargeback_count, visa_chargeback_count, mc_chargeback_count, unknown_network_chargeback_count, unresolved_rail_dispute_count, unknown_settled_count, ecm_denominator_count, card_dispute_ratio, card_dispute_share, vamp_floor_met, ecm_floor_met, card_framing_applies, coverage, stable_at, revision, metrics_version";

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const int = (v: unknown): number => Number(v ?? 0);

/** Map a stored v2 row to the routes' shape. Severities are re-derived from
 *  the stored (already rounded) ratios and counts — never from recomputed
 *  ratios. */
export function rowToProgrammeMonth(row: Row): ProgrammeMonth {
  const month = String(row.period_month).slice(0, 10);
  const ratio = num(row.card_dispute_ratio);
  const ecm = num(row.mc_ecm_ratio);
  const card = int(row.settled_count);
  const unknown = int(row.unknown_settled_count);
  return {
    status: "ok",
    periodState: row.stable_at ? "final" : "provisional",
    finalOn: finalOn(month),
    periodMonth: month,
    cardSettledCount: card,
    cardSettledPrevCount: int(row.ecm_denominator_count),
    unknownSettledCount: unknown,
    cardChargebackCount: int(row.card_chargeback_count),
    cardFraudChargebackCount: int(row.tc40_count),
    visaChargebackCount: int(row.visa_chargeback_count),
    mcChargebackCount: int(row.mc_chargeback_count),
    mcFraudChargebackCount: int(row.mc_efm_fraud_count),
    unknownNetworkChargebackCount: int(row.unknown_network_chargeback_count),
    unresolvedRailDisputeCount: int(row.unresolved_rail_dispute_count),
    ce30ExcludedCount: int(row.ce30_excluded_count),
    fptExcludedCount: int(row.fpt_excluded_count),
    revenueRecoveredUsd: Number(row.estimated_revenue_recovered_usd ?? 0),
    cardDisputeRatio: ratio,
    vampRatioCalculated: num(row.vamp_ratio_calculated),
    vampRatioWithoutDd: num(row.vamp_ratio_without_dd),
    ecmRatio: ecm,
    ecmIsLowerBound: true,
    vampFloorMet: row.vamp_floor_met === true,
    ecmFloorMet: row.ecm_floor_met === true,
    vampSeverity: ratio === null ? null : vampSeverity(ratio, int(row.visa_chargeback_count)),
    ecmSeverity: ecm === null ? null : ecmSeverity(ecm, int(row.mc_chargeback_count), true),
    cardDisputeShare: num(row.card_dispute_share),
    cardFramingApplies: row.card_framing_applies === true,
    unknownPaymentShare: card + unknown > 0 ? roundRatio(unknown / (card + unknown)) : null,
  };
}

export async function readProgrammeMonth(
  sb: SupabaseClient,
  shopId: string,
  month: string,
  now: Date,
): Promise<ProgrammeMonth> {
  const { data, error } = await sb
    .from("ratio_snapshots")
    .select(COLUMNS)
    .eq("shop_id", shopId)
    .eq("period_month", month)
    .maybeSingle();
  if (error) {
    console.error("[insights] month row read failed:", error.message);
    return { status: "error", periodMonth: month };
  }
  const row = data as Row | null;
  if (row && Number(row.metrics_version ?? 1) >= METRICS_VERSION) {
    return rowToProgrammeMonth(row);
  }
  // Not materialised yet: the same computation, live, never labelled final.
  const live = await programmeMonthFor(sb, shopId, month, now);
  return live.status === "ok" ? { ...live, periodState: "provisional" } : live;
}
