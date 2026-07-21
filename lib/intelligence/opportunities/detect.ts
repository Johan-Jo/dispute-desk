/**
 * Descriptive opportunity detection (design §9, §10). Produces a SMALL number
 * of well-powered, honestly-graded recommendations from deterministic facts —
 * never causal, always sample-gated, evidence_grade = "descriptive".
 *
 * Phase B intentionally ships only response/observational opportunities that
 * follow directly from the data. Risk-based prevention is SUPPRESSED whenever
 * the data-quality report says risk features are retrospective (leakage).
 */

import { evaluateGates } from "../stats/sampleGates";
import { scoreConfidence } from "../stats/confidence";
import { moneyFromDecimal, sumMoney, scaleByBasisPoints, zeroMoney, toDecimalString, type Money } from "../money";
import type { DisputeRecordRow } from "../report/baseline";
import type { BaselineReport } from "../report/types";
import type { DataQualityReport, Confidence, RecommendationCategory, EvidenceGrade } from "../types";

export interface RecommendationDraft {
  category: RecommendationCategory;
  title: string;
  summary: string;
  suggestedAction: string;
  affectedOrderCount: number;
  affectedDisputeCount: number;
  affectedDisputedMinor: string | null;
  currency: string;
  baselineMetric: { name: string; value: number; numerator?: number; denominator?: number };
  estimateLowerMinor: string | null;
  estimatePointMinor: string | null;
  estimateUpperMinor: string | null;
  estimatePeriod: "historical_total" | "annualized";
  evidenceGrade: EvidenceGrade;
  confidence: Confidence;
  confidenceKind: string;
  implementationEffort: "low" | "medium" | "high";
  customerFrictionRisk: "low" | "medium" | "high";
  limitations: string[];
  assumptions: string[];
  requiredDataQualityChecks: string[];
  supportingSegmentIds: string[];
}

export function detectOpportunities(
  rows: DisputeRecordRow[],
  baseline: BaselineReport,
  dq: DataQualityReport,
): RecommendationDraft[] {
  const drafts: RecommendationDraft[] = [];
  const currency = baseline.currency;

  // ── Opportunity 1: unanswered disputes that had a response opportunity ──
  // Descriptive: these are contestable cases with a known deadline and no
  // recorded submission. Estimated recoverable uses the observed any-recovery
  // rate (CI) applied to their disputed amount — labeled selection-biased.
  const unanswered = rows.filter(
    (r) => r.submitted_at == null && r.initiated_at != null && r.due_at != null,
  );
  if (unanswered.length > 0) {
    const gate = evaluateGates({
      exposedPopulation: baseline.rates.rawResponseRate.denominator,
      events: unanswered.length,
      resolvedOutcomes: baseline.portfolio.adjudicatedCount,
      missingnessPct: 0,
      historicalPeriods: Object.keys(baseline.portfolio.disputesByYear).length,
    });
    if (gate.verdict !== "suppress") {
      let disputed = zeroMoney(currency);
      for (const r of unanswered) {
        const a = moneyFromDecimal(r.amount, currency);
        if (a) disputed = sumMoney([disputed, a], currency);
      }
      // Conservative → optimistic recoverable band from the any-recovery-rate CI.
      const anyRec = baseline.rates.anyRecoveryRate;
      const lowBps = Math.round(anyRec.lower * 10000);
      const midBps = Math.round(anyRec.point * 10000);
      const upBps = Math.round(anyRec.upper * 10000);
      const conf = scoreConfidence("recommendation", {
        events: unanswered.length,
        ciWidth: anyRec.upper - anyRec.lower,
        missingnessPct: 0,
        temporalStability: "sign_consistent",
        classification: "direct_derived",
        measurementValidity: "valid",
        fdr: "q05",
        confounders: "principal_unmeasured", // why they went unanswered is unmeasured
      }).confidence;
      drafts.push({
        category: "response",
        title: "Unanswered disputes with a response opportunity",
        summary: `${unanswered.length} disputes had a known deadline but no recorded submission. Historically, responded & adjudicated disputes recovered at ${(anyRec.point * 100).toFixed(1)}% (any-recovery rate).`,
        suggestedAction: "Ensure every dispute with a valid deadline gets a submitted evidence pack; review the workflow gaps that left these unanswered.",
        affectedOrderCount: unanswered.length,
        affectedDisputeCount: unanswered.length,
        affectedDisputedMinor: toDecimalString(disputed),
        currency,
        baselineMetric: { name: "any_recovery_rate", value: anyRec.point, numerator: anyRec.numerator, denominator: anyRec.denominator },
        estimateLowerMinor: toDecimalString(scaleByBasisPoints(disputed, lowBps)),
        estimatePointMinor: toDecimalString(scaleByBasisPoints(disputed, midBps)),
        estimateUpperMinor: toDecimalString(scaleByBasisPoints(disputed, upBps)),
        estimatePeriod: "historical_total",
        evidenceGrade: "descriptive",
        confidence: conf,
        confidenceKind: "recommendation",
        implementationEffort: "low",
        customerFrictionRisk: "low",
        limitations: [
          "Applies a portfolio recovery rate to unanswered disputes — selection bias: unanswered cases may be systematically weaker.",
          "Not a causal estimate; responding would not necessarily recover at the observed rate.",
        ],
        assumptions: ["Historical any-recovery rate is a rough proxy for these cases' recoverability."],
        requiredDataQualityChecks: ["dispute_outcomes", "response_analysis"],
        supportingSegmentIds: gate.verdict === "exploratory" ? ["exploratory:unanswered"] : ["unanswered_with_opportunity"],
      });
    }
  }

  // ── Opportunity 2: net-loss concentration by dispute reason (descriptive) ──
  const byReason = new Map<string, { count: number; net: Money }>();
  for (const r of rows) {
    if ((r.currency_code || "").toUpperCase() !== currency) continue;
    const reason = r.reason || "GENERAL";
    const amt = moneyFromDecimal(r.amount, currency);
    const rec = moneyFromDecimal(r.outcome_amount_recovered, currency);
    const net = amt ? (rec ? Number(amt.amountMinor) - Number(rec.amountMinor) : Number(amt.amountMinor)) : 0;
    const cur = byReason.get(reason) ?? { count: 0, net: zeroMoney(currency) };
    cur.count += 1;
    cur.net = sumMoney([cur.net, { amountMinor: BigInt(Math.max(0, net)), currency }], currency);
    byReason.set(reason, cur);
  }
  const topReason = [...byReason.entries()].sort((a, b) => Number(b[1].net.amountMinor - a[1].net.amountMinor))[0];
  if (topReason && topReason[1].count >= 10) {
    const [reason, agg] = topReason;
    const conf = scoreConfidence("descriptive_data", {
      events: agg.count, missingnessPct: 0, measurementValidity: "valid",
    }).confidence;
    drafts.push({
      category: "response",
      title: `Losses concentrate in "${reason}" disputes`,
      summary: `${agg.count} "${reason}" disputes account for the largest share of net loss (${agg.net.currency} ${toDecimalString(agg.net)}). This is where evidence quality matters most.`,
      suggestedAction: `Prioritize evidence completeness and review for "${reason}" disputes; audit templates for this reason.`,
      affectedOrderCount: agg.count,
      affectedDisputeCount: agg.count,
      affectedDisputedMinor: toDecimalString(agg.net),
      currency,
      baselineMetric: { name: "net_loss_by_reason", value: Number(agg.net.amountMinor), numerator: agg.count },
      estimateLowerMinor: null, estimatePointMinor: null, estimateUpperMinor: null,
      estimatePeriod: "historical_total",
      evidenceGrade: "descriptive",
      confidence: conf,
      confidenceKind: "descriptive_data",
      implementationEffort: "medium",
      customerFrictionRisk: "low",
      limitations: ["Descriptive concentration, not a causal claim about why these lose.", "Uses coarse dispute reason (network codes are inferred here)."],
      assumptions: [],
      requiredDataQualityChecks: ["dispute_outcomes"],
      supportingSegmentIds: [`reason:${reason}`],
    });
  }

  // Risk-based prevention is SUPPRESSED when data quality flags leakage.
  if (!dq.riskPreventionSupported) {
    // Intentionally emit nothing for risk-based prevention (documented in report limitations).
  }

  return drafts;
}
