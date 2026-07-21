/**
 * Baseline descriptive report (design §9, §7.1).
 *
 * Reads intel_dispute_records via the tenant-scoped DAL and computes the
 * defined metrics with the CORRECT interval methods:
 *   - Binary case rates (full-win, any-recovery, response) → Wilson.
 *   - Monetary quantities (recovery ratio, avg recovery) → bootstrap.
 * partially_won gets NO fractional credit inside a binomial. Never sums across
 * currencies (single-currency rule from lib/disputes/metrics.ts).
 *
 * Pure computation (buildBaseline) is separated from the DB read so it is
 * unit-testable against fixed records.
 */

import { scopedSelectAll } from "../db/tenantScope";
import { wilsonInterval } from "../stats/wilson";
import { bootstrapInterval, ratioOfSums } from "../stats/bootstrap";
import { scoreConfidence } from "../stats/confidence";
import { moneyFromDecimal, sumMoney, subMoney, zeroMoney, toDecimalString, type Money } from "../money";
import type { BaselineReport, RateMetric, BootstrapMetric } from "./types";
import type { Confidence } from "../types";

export interface DisputeRecordRow {
  dispute_id: string;
  initiated_at: string | null;
  due_at: string | null;
  submitted_at: string | null;
  reason: string | null;
  phase: string | null;
  final_outcome: string | null;
  amount: string | null;
  currency_code: string | null;
  outcome_amount_recovered: string | null;
  is_adjudicated: boolean;
}

const ADJUDICATED = new Set(["won", "partially_won", "lost"]);

export async function computeBaseline(shopId: string): Promise<BaselineReport> {
  const rows = await scopedSelectAll<DisputeRecordRow>(
    "intel_dispute_records",
    shopId,
    "dispute_id,initiated_at,due_at,submitted_at,reason,phase,final_outcome,amount,currency_code,outcome_amount_recovered,is_adjudicated",
    "dispute_id",
  );
  return buildBaseline(rows);
}

/** Pure — deterministic given the records. */
export function buildBaseline(rows: DisputeRecordRow[]): BaselineReport {
  // Dominant currency (single-currency rule). Bucket others out.
  const currencyCounts = new Map<string, number>();
  for (const r of rows) {
    const c = (r.currency_code || "").toUpperCase();
    if (c) currencyCounts.set(c, (currencyCounts.get(c) ?? 0) + 1);
  }
  const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const inCurrency = rows.filter((r) => (r.currency_code || "").toUpperCase() === currency);
  const otherCurrencyDisputeCount = rows.length - inCurrency.length;

  const initiated = rows.map((r) => r.initiated_at).filter(Boolean).sort() as string[];
  const period = { from: initiated[0] ?? null, to: initiated[initiated.length - 1] ?? null };

  // Portfolio totals (single currency only).
  const disputedAmounts: Money[] = [];
  const recoveredAmounts: Money[] = [];
  let disputesWithAmount = 0;
  for (const r of inCurrency) {
    const amt = moneyFromDecimal(r.amount, currency);
    if (amt) { disputedAmounts.push(amt); disputesWithAmount++; }
    const rec = moneyFromDecimal(r.outcome_amount_recovered, currency);
    if (rec) recoveredAmounts.push(rec);
  }
  const totalDisputed = sumMoney(disputedAmounts, currency);
  const totalRecovered = sumMoney(recoveredAmounts, currency);
  const totalNetLoss = subMoney(totalDisputed, totalRecovered);

  const disputesByYear: Record<string, number> = {};
  for (const r of rows) {
    if (!r.initiated_at) continue;
    const yr = r.initiated_at.slice(0, 4);
    disputesByYear[yr] = (disputesByYear[yr] ?? 0) + 1;
  }

  // Denominators (design §7.1).
  const adjudicated = rows.filter((r) => r.final_outcome != null && ADJUDICATED.has(r.final_outcome));
  const responded = rows.filter((r) => r.submitted_at != null);
  const respondedAdjudicated = adjudicated.filter((r) => r.submitted_at != null);
  const withResponseOpportunity = rows.filter((r) => r.initiated_at != null && r.due_at != null);

  const fullWins = respondedAdjudicated.filter((r) => r.final_outcome === "won").length;
  const anyRecovery = respondedAdjudicated.filter(
    (r) => r.final_outcome === "won" || r.final_outcome === "partially_won",
  ).length;

  const rateConfidence = (num: number, den: number, ciWidth: number): Confidence =>
    scoreConfidence("statistical_estimate", {
      events: den,
      ciWidth,
      missingnessPct: 0,
      classification: "direct_derived", // outcomes are ground truth (not inferred)
      measurementValidity: "valid",
      fdr: "q05",
    }).confidence;

  const mkRate = (name: string, num: number, den: number): RateMetric => {
    const w = wilsonInterval(num, den);
    return {
      name, numerator: num, denominator: den,
      point: w.point, lower: w.lower, upper: w.upper, method: "wilson",
      confidence: den === 0 ? "insufficient" : rateConfidence(num, den, w.ciWidth),
    };
  };

  const fullWinRate = mkRate("full_win_rate", fullWins, respondedAdjudicated.length);
  const anyRecoveryRate = mkRate("any_recovery_rate", anyRecovery, respondedAdjudicated.length);
  const rawResponseRate = mkRate("raw_response_rate", responded.length, withResponseOpportunity.length);
  // Actionable eligibility (coverage/fatal-loss at historical time) is not
  // available per-record in Phase B → equals raw with a disclosed note.
  const actionableResponseRate: RateMetric = {
    ...mkRate("actionable_response_rate", responded.length, withResponseOpportunity.length),
    excluded: [{ reason: "coverage/fatal-loss historical eligibility not yet available (§14) — equals raw", count: 0 }],
  };

  // Monetary (bootstrap). Recovery ratio = Σrecovered / Σdisputed over disputes
  // with amounts; resample disputes (paired recovered,disputed).
  const pairs: Array<[number, number]> = [];
  const recoveredPerResponse: number[] = [];
  for (const r of inCurrency) {
    const amt = moneyFromDecimal(r.amount, currency);
    const rec = moneyFromDecimal(r.outcome_amount_recovered, currency);
    if (amt) pairs.push([rec ? Number(rec.amountMinor) : 0, Number(amt.amountMinor)]);
    if (r.submitted_at != null) recoveredPerResponse.push(rec ? Number(rec.amountMinor) : 0);
  }
  const monetaryRecoveryRate = bootstrapRatio(pairs, 7);
  const avgRecoveryPerResponse = bootstrapMeanMoney(recoveredPerResponse, currency, 8);

  const limitations = [
    "Rates over adjudicated, responded disputes only; withdrawn/closed_other/unknown/pending excluded (counted separately).",
    "Responded-vs-unanswered differences are selection-biased and non-causal.",
    "Monetary figures exclude disputes without a recorded outcome amount (shown as coverage).",
  ];
  if (otherCurrencyDisputeCount > 0) {
    limitations.push(`${otherCurrencyDisputeCount} disputes in other currencies are excluded from monetary totals.`);
  }

  return {
    currency,
    otherCurrencyDisputeCount,
    period,
    portfolio: {
      totalDisputes: rows.length,
      totalDisputedAmount: { name: "total_disputed", amountMinor: toDecimalString(totalDisputed), currency },
      totalRecovered: { name: "total_recovered", amountMinor: toDecimalString(totalRecovered), currency },
      totalNetLoss: { name: "total_net_loss", amountMinor: toDecimalString(totalNetLoss), currency },
      adjudicatedCount: adjudicated.length,
      respondedCount: responded.length,
      disputesWithAmount,
      disputesByYear,
    },
    rates: { fullWinRate, anyRecoveryRate, rawResponseRate, actionableResponseRate },
    monetary: { monetaryRecoveryRate, avgRecoveryPerResponse },
    limitations,
  };
}

/** Percentile-bootstrap the ratio Σa/Σb by resampling paired observations. */
function bootstrapRatio(pairs: Array<[number, number]>, seed: number): BootstrapMetric {
  if (pairs.length === 0) {
    return { name: "monetary_recovery_rate", point: 0, lower: 0, upper: 0, method: "bootstrap", sampleSize: 0, confidence: "insufficient" };
  }
  // Deterministic resampling via the bootstrap PRNG over indices.
  const indices = pairs.map((_, i) => i);
  const boot = bootstrapInterval(indices, {
    seed, iterations: 2000,
    statistic: (resampledIdx) => ratioOfSums(resampledIdx.map((i) => pairs[i])),
  });
  const conf = scoreConfidence("statistical_estimate", {
    events: pairs.length, ciWidth: boot.upper - boot.lower, missingnessPct: 0,
    classification: "direct_derived", measurementValidity: "valid", fdr: "q05",
  }).confidence;
  return { name: "monetary_recovery_rate", point: boot.point, lower: boot.lower, upper: boot.upper, method: "bootstrap", sampleSize: pairs.length, confidence: conf };
}

function bootstrapMeanMoney(minorValues: number[], _currency: string, seed: number): BootstrapMetric {
  if (minorValues.length === 0) {
    return { name: "avg_recovery_per_response", point: 0, lower: 0, upper: 0, method: "bootstrap", sampleSize: 0, confidence: "insufficient" };
  }
  const boot = bootstrapInterval(minorValues, { seed, iterations: 2000 });
  const conf = scoreConfidence("statistical_estimate", {
    events: minorValues.length, ciWidth: 0, missingnessPct: 0,
    classification: "direct_derived", measurementValidity: "valid", fdr: "q05",
  }).confidence;
  // point/lower/upper are in minor units.
  return { name: "avg_recovery_per_response", point: boot.point, lower: boot.lower, upper: boot.upper, method: "bootstrap", sampleSize: minorValues.length, confidence: conf };
}
