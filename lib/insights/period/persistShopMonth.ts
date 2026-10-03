/**
 * The only TypeScript writer of `ratio_snapshots` (CI invariant: no other
 * file calls `persist_shop_month` or writes the table directly).
 *
 * Builds the month's payload from `computeShopMonth` and hands it to the
 * `persist_shop_month` SQL function, which locks, hashes, logs and upserts in
 * one transaction — so a row and its revision log can never disagree.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { THRESHOLDS_VERSION, VAMP_PER_TRANSACTION_FEE_USD } from "@/lib/insights/programmeThresholds";
import type { ProgrammeBlock } from "./computeProgrammeBlock";
import { canMarkStable, monthCoverage, type StabilityShop } from "./canMarkStable";

/** v2 = card-rail chargebacks initiated in the month, inquiries excluded,
 *  rounded once (PR2). PR3a adds operational metrics + checkpoints (v3). */
export const METRICS_VERSION = 2;

/** The row payload: keys are `ratio_snapshots` column names. Legacy columns
 *  carry the v2 meaning (documented in docs/technical.md). */
export function monthPayload(
  block: ProgrammeBlock,
  coverage: "full" | "partial",
): Record<string, unknown> {
  return {
    coverage,
    settled_count: block.cardSettledCount,
    tc40_count: block.cardFraudChargebackCount,
    tc15_count: block.cardChargebackCount - block.cardFraudChargebackCount,
    vamp_ratio_calculated: block.vampRatioCalculated,
    vamp_ratio_without_dd: block.vampRatioWithoutDd,
    ce30_excluded_count: block.ce30ExcludedCount,
    fpt_excluded_count: block.fptExcludedCount,
    // No Mastercard-only denominator until card-brand denominators (PR5).
    mc_settled_count: 0,
    mc_ecm_chargeback_count: block.mcChargebackCount,
    mc_ecm_ratio: block.ecmRatio,
    mc_efm_fraud_count: block.mcFraudChargebackCount,
    estimated_fees_avoided_usd:
      (block.ce30ExcludedCount + block.fptExcludedCount) * VAMP_PER_TRANSACTION_FEE_USD,
    estimated_revenue_recovered_usd: block.revenueRecoveredUsd,
    card_chargeback_count: block.cardChargebackCount,
    visa_chargeback_count: block.visaChargebackCount,
    mc_chargeback_count: block.mcChargebackCount,
    unknown_network_chargeback_count: block.unknownNetworkChargebackCount,
    unresolved_rail_dispute_count: block.unresolvedRailDisputeCount,
    unknown_settled_count: block.unknownSettledCount,
    ecm_denominator_count: block.cardSettledPrevCount,
    card_dispute_ratio: block.cardDisputeRatio,
    card_dispute_share: block.cardDisputeShare,
    vamp_floor_met: block.vampFloorMet,
    ecm_floor_met: block.ecmFloorMet,
    card_framing_applies: block.cardFramingApplies,
  };
}

export interface PersistResult {
  changed: boolean;
  revision: number;
  stableAt: string | null;
}

export async function persistShopMonth(
  sb: SupabaseClient,
  args: {
    shopId: string;
    shop: StabilityShop;
    month: string;
    block: ProgrammeBlock;
    reason: string;
    now: Date;
  },
): Promise<PersistResult> {
  const { data, error } = await sb.rpc("persist_shop_month", {
    p_shop_id: args.shopId,
    p_period_month: args.month,
    p_values: monthPayload(args.block, monthCoverage(args.shop, args.month)),
    p_reason: args.reason,
    p_mark_stable: canMarkStable(args.shop, args.month, args.now),
    p_metrics_version: METRICS_VERSION,
    p_thresholds_version: THRESHOLDS_VERSION,
  });
  if (error) throw new Error(`persist_shop_month ${args.month}: ${error.message}`);
  const r = data as { changed: boolean; revision: number; stable_at: string | null };
  return { changed: r.changed, revision: r.revision, stableAt: r.stable_at };
}

/**
 * Roll a month back to an earlier logged state by writing it as a NEW
 * revision (history is never rewritten). Revision 0 is the pre-v2 backup,
 * which predates `coverage`; it is restored as coverage 'full'.
 */
export async function restoreRevision(
  sb: SupabaseClient,
  args: { shopId: string; month: string; revision: number; reason: string },
): Promise<PersistResult> {
  const { data, error } = await sb
    .from("ratio_snapshot_revisions")
    .select("values, metrics_version, thresholds_version")
    .eq("shop_id", args.shopId)
    .eq("period_month", args.month)
    .eq("revision", args.revision)
    .maybeSingle();
  if (error) throw new Error(`read revision ${args.revision}: ${error.message}`);
  if (!data) throw new Error(`no revision ${args.revision} for ${args.month}`);
  const logged = data.values as Record<string, unknown>;
  const values = { ...logged, coverage: logged.coverage ?? "full" };
  const { data: r, error: rpcErr } = await sb.rpc("persist_shop_month", {
    p_shop_id: args.shopId,
    p_period_month: args.month,
    p_values: values,
    p_reason: args.reason,
    p_mark_stable: false,
    p_metrics_version: data.metrics_version,
    p_thresholds_version: data.thresholds_version,
  });
  if (rpcErr) throw new Error(`restore ${args.month}: ${rpcErr.message}`);
  const out = r as { changed: boolean; revision: number; stable_at: string | null };
  return { changed: out.changed, revision: out.revision, stableAt: out.stable_at };
}
