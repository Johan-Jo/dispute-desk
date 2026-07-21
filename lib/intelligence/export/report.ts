/**
 * Exportable Historical Dispute Intelligence Report (design §27, §18
 * Methodology). Pure markdown formatter over a completed run + its
 * recommendations. Faithful to the structured data — no new numbers, always
 * shows limitations, methodology, and versions.
 */

import type { AnalysisRunRow, RecommendationRow } from "../types";

interface RunWithExtras extends AnalysisRunRow {
  baseline?: unknown;
  feasibility?: { anyModelBuilt: boolean; summary: string; verdicts: { model: string; feasible: boolean; reason: string }[] } | null;
  model_report?: { targetPopulation: string; overall: { testN: number; brier: number; baseRate: number } } | null;
}

export function buildMarkdownReport(
  run: RunWithExtras,
  recommendations: RecommendationRow[],
  shopLabel: string,
): string {
  const dq = run.data_quality;
  const b = run.baseline as {
    currency?: string;
    portfolio?: { totalDisputes: number; totalDisputedAmount: { amountMinor: string }; totalRecovered: { amountMinor: string }; totalNetLoss: { amountMinor: string }; adjudicatedCount: number };
    rates?: { fullWinRate: { point: number; lower: number; upper: number; numerator: number; denominator: number }; anyRecoveryRate: { point: number }; rawResponseRate: { point: number } };
  } | null;

  const L: string[] = [];
  L.push(`# Historical Dispute Intelligence Report`);
  L.push(``);
  L.push(`**Merchant:** ${shopLabel}  `);
  L.push(`**Run:** ${run.id}  `);
  L.push(`**Generated:** ${run.completed_at ?? run.created_at}  `);
  L.push(`**Versions:** features ${run.feature_registry_version ?? "?"} · classification ${run.classification_version ?? "?"} · methodology ${run.methodology_version ?? "?"}`);
  L.push(``);
  L.push(`> Analytical decision support. This report does not submit, skip, or decide any dispute.`);
  L.push(``);

  if (dq) {
    L.push(`## Data quality`);
    L.push(`- Orders: ${dq.facts.orders.count.toLocaleString()} (coverage from ${dq.facts.orders.coverage_start ?? "?"} — earlier history not proven absent)`);
    L.push(`- Disputes: ${dq.facts.disputes.count.toLocaleString()} · adjudicated ${dq.facts.disputes.count_adjudicated}`);
    L.push(`- Risk-based prevention: **${dq.riskPreventionSupported ? "supported (pending provenance)" : "NOT supported — retrospective/leakage"}**`);
    for (const lim of dq.globalLimitations) L.push(`- ${lim}`);
    L.push(``);
  }

  if (b?.portfolio && b.rates) {
    const cur = b.currency ?? "";
    L.push(`## Portfolio`);
    L.push(`- Total disputed: ${cur} ${b.portfolio.totalDisputedAmount.amountMinor}`);
    L.push(`- Recovered: ${cur} ${b.portfolio.totalRecovered.amountMinor} · Net loss: ${cur} ${b.portfolio.totalNetLoss.amountMinor}`);
    L.push(`- Full-win rate: ${(b.rates.fullWinRate.point * 100).toFixed(1)}% (95% CI ${(b.rates.fullWinRate.lower * 100).toFixed(1)}–${(b.rates.fullWinRate.upper * 100).toFixed(1)}%, n=${b.rates.fullWinRate.numerator}/${b.rates.fullWinRate.denominator})`);
    L.push(`- Any-recovery rate: ${(b.rates.anyRecoveryRate.point * 100).toFixed(1)}% · Raw response rate: ${(b.rates.rawResponseRate.point * 100).toFixed(1)}%`);
    L.push(``);
  }

  L.push(`## Opportunities (${recommendations.length})`);
  if (recommendations.length === 0) L.push(`- None passed the sample gates (expected with small N).`);
  for (const r of recommendations) {
    L.push(`### ${r.title}`);
    L.push(`*${r.category} · ${r.evidence_grade} · confidence ${r.confidence}*`);
    L.push(``);
    L.push(r.summary);
    L.push(`**Action:** ${r.suggested_action}`);
    if (r.estimate_point_minor && r.currency) {
      L.push(`**Estimated impact:** ${r.currency} ${r.estimate_lower_minor}–${r.estimate_upper_minor} (point ${r.estimate_point_minor}, ${r.estimate_period})`);
    }
    if (r.limitations.length) L.push(`**Limitations:** ${r.limitations.join(" ")}`);
    if (r.explanation) { L.push(``); L.push(`> ${r.explanation.replace(/\n/g, "\n> ")}`); }
    L.push(``);
  }

  if (run.feasibility) {
    L.push(`## Model feasibility`);
    L.push(run.feasibility.summary);
    for (const v of run.feasibility.verdicts) L.push(`- **${v.model}**: ${v.feasible ? "built" : "not built"} — ${v.reason}`);
    L.push(``);
  }
  if (run.model_report) {
    L.push(`### Response-win model`);
    L.push(`- Target: ${run.model_report.targetPopulation}`);
    L.push(`- Backtest test-N ${run.model_report.overall.testN}, Brier ${run.model_report.overall.brier.toFixed(3)}, base win rate ${(run.model_report.overall.baseRate * 100).toFixed(1)}%`);
    L.push(``);
  }

  L.push(`## Methodology`);
  L.push(`- Deterministic SQL/stat computation; an LLM may only explain validated results, never recompute.`);
  L.push(`- Binary rates use Wilson intervals; monetary quantities use bootstrap. Partial wins are not credited inside a binomial.`);
  L.push(`- Observational comparisons (e.g. responded vs unanswered) are selection-biased and non-causal.`);
  L.push(`- Evidence grades: descriptive / adjusted_observational / prospectively_validated. Retrospective findings cannot be prospectively validated.`);
  return L.join("\n");
}
