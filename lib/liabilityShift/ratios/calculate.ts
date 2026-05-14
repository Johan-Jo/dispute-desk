/**
 * Calculate the monthly VAMP / MC ECM / MC EFM snapshot for a shop.
 *
 * Approximation from Shopify data per LSE-5 epic §Calculations. Always
 * presented to merchants as "calculated estimate" — only the acquirer
 * has the authoritative number.
 *
 *   VAMP_ratio = (TC40_fraud + TC15_other) / TC05_settled
 *
 * Approximations:
 *   TC40_fraud  ≈ disputes with reason=fraudulent AND kind=chargeback
 *   TC15_other  ≈ all other disputes (chargeback or inquiry)
 *   TC05_settled ≈ paid orders excluding refunds/voids in the period
 *
 * Counterfactual (`vamp_ratio_without_dd`): same numerator but with
 * DisputeDesk-attributed wins NOT excluded — drives the "without
 * DisputeDesk" trend-line.
 *
 * Idempotent: upserts on (shop_id, period_month).
 */

import { getServiceClient } from "@/lib/supabase/server";
import { VAMP_PER_TRANSACTION_FEE_USD } from "./thresholds";

export interface CalculateRatiosInput {
  shopId: string;
  /** First day of the target month, YYYY-MM-DD. */
  periodMonth: string;
}

export interface CalculateRatiosResult {
  shopId: string;
  periodMonth: string;
  vampRatioCalculated: number;
  vampRatioWithoutDd: number;
  mcEcmRatio: number;
  mcEfmRatio: number;
  ce30ExcludedCount: number;
  fptExcludedCount: number;
  estimatedFeesAvoidedUsd: number;
  estimatedRevenueRecoveredUsd: number;
}

export async function calculateRatiosForMonth(
  input: CalculateRatiosInput,
): Promise<CalculateRatiosResult> {
  const sb = getServiceClient();
  const { periodMonth, shopId } = input;
  const periodStart = new Date(`${periodMonth}T00:00:00Z`);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodStart.getUTCMonth() + 1);
  const periodStartIso = periodStart.toISOString();
  const periodEndIso = periodEnd.toISOString();

  // Settled count from disputes' parent orders — proxy via shopify_orders count
  // for the month, financial_status = paid, no refund. The chargeback_rate
  // module already has the canonical approximation; we mirror its query
  // shape here for self-containedness.
  const { count: settledCount = 0 } = await sb
    .from("shopify_orders")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .gte("created_at", periodStartIso)
    .lt("created_at", periodEndIso)
    .eq("financial_status", "paid");

  const { data: disputes } = await sb
    .from("disputes")
    .select("id, reason, phase, amount, network_reason_code, final_outcome, initiated_at")
    .eq("shop_id", shopId)
    .gte("initiated_at", periodStartIso)
    .lt("initiated_at", periodEndIso);

  let tc40 = 0;
  let tc15 = 0;
  let mcEcmChargebacks = 0;
  let mcEfmFraud = 0;
  let mcSettled = 0;
  let ce30ExcludedCount = 0;
  let fptExcludedCount = 0;
  let revenueRecoveredUsd = 0;

  // Pull won disputes' submission_logs to attribute exclusions.
  const wonDisputeIds = (disputes ?? [])
    .filter((d) => d.final_outcome === "won")
    .map((d) => d.id);
  const attributionByDispute = new Map<string, "ce_30" | "fpt" | null>();
  if (wonDisputeIds.length > 0) {
    const { data: packs } = await sb
      .from("evidence_packs")
      .select("id, dispute_id, package_type")
      .in("dispute_id", wonDisputeIds);
    for (const p of packs ?? []) {
      if (p.dispute_id) {
        if (p.package_type === "ce_30") attributionByDispute.set(p.dispute_id, "ce_30");
        else if (p.package_type === "fpt") attributionByDispute.set(p.dispute_id, "fpt");
      }
    }
  }

  for (const d of disputes ?? []) {
    const isFraud = (d.reason ?? "").toLowerCase().includes("fraud");
    const isChargeback = d.phase === "chargeback";
    if (isFraud && isChargeback) tc40 += 1;
    else tc15 += 1;

    // Mastercard partitioning is best-effort: use network_reason_code prefix.
    const isMastercard = (d.network_reason_code ?? "").startsWith("48");
    if (isMastercard) {
      mcSettled += 1; // approximation — we're counting MC disputes; settled total is in the parent query
      if (isChargeback) mcEcmChargebacks += 1;
      if (isFraud) mcEfmFraud += 1;
    }

    // Exclude wins attributed to LSE programs from the VAMP numerator.
    if (d.final_outcome === "won") {
      const via = attributionByDispute.get(d.id);
      if (via === "ce_30") {
        ce30ExcludedCount += 1;
        if (isFraud && isChargeback) tc40 -= 1;
        else tc15 -= 1;
        revenueRecoveredUsd += Number(d.amount ?? 0);
      } else if (via === "fpt") {
        fptExcludedCount += 1;
        if (isFraud && isChargeback) tc40 -= 1;
        else tc15 -= 1;
        revenueRecoveredUsd += Number(d.amount ?? 0);
      }
    }
  }

  const safeRatio = (n: number, d: number) => (d > 0 ? n / d : 0);
  const vampRatio = safeRatio(tc40 + tc15, settledCount ?? 0);
  // Counterfactual: re-add the excluded wins to the numerator.
  const vampWithoutDd = safeRatio(
    tc40 + tc15 + ce30ExcludedCount + fptExcludedCount,
    settledCount ?? 0,
  );
  // MC ratios use the same denominator (total settled). Mastercard-only
  // would require partitioning the parent query by network — defer to a
  // calibration pass once we have outcome data.
  const mcEcmRatio = safeRatio(mcEcmChargebacks, settledCount ?? 0);
  const mcEfmRatio = safeRatio(mcEfmFraud, settledCount ?? 0);

  const estimatedFeesAvoidedUsd =
    (ce30ExcludedCount + fptExcludedCount) * VAMP_PER_TRANSACTION_FEE_USD;

  // Upsert snapshot.
  await sb.from("ratio_snapshots").upsert(
    {
      shop_id: shopId,
      period_month: periodMonth,
      settled_count: settledCount ?? 0,
      tc40_count: Math.max(0, tc40),
      tc15_count: Math.max(0, tc15),
      vamp_ratio_calculated: vampRatio,
      vamp_ratio_without_dd: vampWithoutDd,
      ce30_excluded_count: ce30ExcludedCount,
      fpt_excluded_count: fptExcludedCount,
      rdr_excluded_count: 0, // RDR is out of LSE scope; placeholder for future
      mc_settled_count: mcSettled,
      mc_ecm_chargeback_count: mcEcmChargebacks,
      mc_ecm_ratio: mcEcmRatio,
      mc_efm_fraud_count: mcEfmFraud,
      mc_efm_ratio: mcEfmRatio,
      estimated_fees_avoided_usd: estimatedFeesAvoidedUsd,
      estimated_revenue_recovered_usd: revenueRecoveredUsd,
      calculated_at: new Date().toISOString(),
    },
    { onConflict: "shop_id,period_month" },
  );

  return {
    shopId,
    periodMonth,
    vampRatioCalculated: vampRatio,
    vampRatioWithoutDd: vampWithoutDd,
    mcEcmRatio,
    mcEfmRatio,
    ce30ExcludedCount,
    fptExcludedCount,
    estimatedFeesAvoidedUsd,
    estimatedRevenueRecoveredUsd: revenueRecoveredUsd,
  };
}

/** Format YYYY-MM-DD for the first of the month containing `date`. */
export function monthStart(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
