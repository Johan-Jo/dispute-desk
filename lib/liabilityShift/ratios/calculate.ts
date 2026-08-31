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
import { classifyRail } from "@/lib/insights/railSegmentation";

/** Payment methods that settle on a card network and therefore appear in
 *  Visa/Mastercard settlement records. Kept in sync with `classifyRail`. */
const CARD_RAIL_METHODS = [
  "card",
  "apple_pay",
  "google_pay",
  "shop_pay",
  "shopify_pay",
];

export interface CalculateRatiosInput {
  shopId: string;
  /** First day of the target month, YYYY-MM-DD. */
  periodMonth: string;
}

export interface CalculateRatiosResult {
  shopId: string;
  periodMonth: string;
  /** NULL when the period has no card volume — the programme does not
   *  measure this merchant. Never 0, which would read as a clean pass. */
  vampRatioCalculated: number | null;
  vampRatioWithoutDd: number | null;
  mcEcmRatio: number | null;
  mcEfmRatio: number | null;
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

  // Settled count from shopify_orders for the month. Date filter uses
  // `created_at_shopify` (the order's createdAt in Shopify). The
  // `financial_status` column stores Shopify's enum UPPERCASE
  // (PAID / REFUNDED / PARTIALLY_REFUNDED / VOIDED). We count both
  // PAID and PARTIALLY_REFUNDED in the settled denominator — a partial
  // refund still represents a settled card-network transaction
  // (matches Visa TC05 settled semantics).
  // CARD RAIL ONLY. TC05 is a Visa settlement record: a PayPal or Klarna
  // order is never one, so counting them here inflated the denominator with
  // transactions Visa cannot see. Combined with the numerator fix below this
  // makes the ratio mean what its name claims.
  const { count: settledCount = 0 } = await sb
    .from("shopify_orders")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .gte("created_at_shopify", periodStartIso)
    .lt("created_at_shopify", periodEndIso)
    .in("financial_status", ["PAID", "PARTIALLY_REFUNDED"])
    .in("payment_method", CARD_RAIL_METHODS);

  const { data: allDisputes } = await sb
    .from("disputes")
    .select(
      "id, reason, phase, amount, network_reason_code, final_outcome, initiated_at, order_gid",
    )
    .eq("shop_id", shopId)
    .gte("initiated_at", periodStartIso)
    .lt("initiated_at", periodEndIso);

  // Keep only card-rail disputes. TC40 and TC15 are Visa transaction codes;
  // a PayPal buyer-protection claim or a Klarna dispute is neither, and
  // counting them made "VAMP" a number with a Visa label and no Visa
  // content. Measured before this fix: Mein Maison showed 2.79% VAMP off a
  // book that is ~99% PayPal, and cay-collective 0.55% off one that is 100%
  // Klarna.
  //
  // A dispute whose order we cannot resolve is EXCLUDED, not assumed card.
  // Assuming card is what produced the original misread; an unresolvable
  // dispute is a coverage gap, and a gap must not inflate a compliance
  // ratio the merchant may act on.
  const disputeGids = (allDisputes ?? [])
    .map((d) => (d as { order_gid: string | null }).order_gid)
    .filter((g): g is string => !!g);
  const railByGid = new Map<string, string | null>();
  for (let i = 0; i < disputeGids.length; i += 200) {
    const { data: orderRows } = await sb
      .from("shopify_orders")
      .select("shopify_order_id, payment_method")
      .eq("shop_id", shopId)
      .in("shopify_order_id", disputeGids.slice(i, i + 200));
    for (const r of (orderRows ?? []) as Array<{
      shopify_order_id: string;
      payment_method: string | null;
    }>) {
      railByGid.set(r.shopify_order_id, r.payment_method);
    }
  }
  const disputes = (allDisputes ?? []).filter((d) => {
    const gid = (d as { order_gid: string | null }).order_gid;
    return gid ? classifyRail(railByGid.get(gid) ?? null) === "card" : false;
  });

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

  // Returns null — NOT 0 — for an empty denominator. "This merchant has no
  // card volume" and "this merchant has no card disputes" are different
  // statements, and rendering the first as a confident green 0.00% VAMP pill
  // asserts compliance with a programme that is not measuring them at all.
  const safeRatio = (n: number, d: number) => (d > 0 ? n / d : null);
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
