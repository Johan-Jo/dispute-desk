/**
 * Model-feasibility evaluation (design §12 Phase D, §14). Phase D is CONDITIONAL:
 * a model is built ONLY if its predefined gates pass. This harness decides —
 * from the feature registry + the actual data — whether each model type is
 * feasible, and refuses (documents "unsupported") otherwise. It NEVER fabricates
 * a model.
 *
 * Gates (config): enough model-eligible features, enough adjudicated events,
 * class balance, and enough chronological folds each with a minimum event count
 * (so a time-based backtest is possible). Risk-based prevention is infeasible
 * whenever no ODT/SDT feature is model-eligible (the Blume Box reality — risk is
 * retrospective and order-time fields are unverified, §14).
 */

import { FEATURE_REGISTRY } from "../features/registry";
import type { DisputeRecordRow } from "../report/baseline";

export interface ModelGates {
  minEligibleFeatures: number;
  minAdjudicatedEvents: number;
  minFolds: number; // chronological periods
  minEventsPerFold: number;
  minMinorityClassFraction: number; // class-balance floor
}

export const DEFAULT_MODEL_GATES: ModelGates = {
  minEligibleFeatures: 3,
  minAdjudicatedEvents: 200,
  minFolds: 3,
  minEventsPerFold: 40,
  minMinorityClassFraction: 0.15,
};

export type ModelType = "prevention" | "response_win_pooled" | "response_win_by_category";

export interface ModelVerdict {
  model: ModelType;
  feasible: boolean;
  reason: string;
  eligibleFeatures: string[];
  metrics: {
    adjudicatedEvents: number;
    foldsWithMinEvents: number;
    minorityClassFraction: number | null;
  };
  gateFailures: string[];
  /** What ships instead when infeasible. */
  fallback: "descriptive_only" | "model";
}

export interface FeasibilityReport {
  gates: ModelGates;
  verdicts: ModelVerdict[];
  /** True only if ANY model passed — for Blume Box this is expected false. */
  anyModelBuilt: boolean;
  summary: string;
}

function preventionEligibleFeatures(): string[] {
  return FEATURE_REGISTRY.filter(
    (f) =>
      f.preventionModelEligible &&
      !f.unverifiedPendingProvenance &&
      !f.retrospectiveOnly &&
      !f.analyticalOutcomeOnly &&
      (f.stage === "ORDER_DECISION_TIME" || f.stage === "SHIP_DECISION_TIME"),
  ).map((f) => f.key);
}

function responseEligibleFeatures(): string[] {
  return FEATURE_REGISTRY.filter(
    (f) =>
      f.responseModelEligible &&
      !f.unverifiedPendingProvenance &&
      !f.retrospectiveOnly &&
      !f.analyticalOutcomeOnly &&
      f.stage !== "POST_OUTCOME_ONLY",
  ).map((f) => f.key);
}

export function evaluateModelFeasibility(
  rows: DisputeRecordRow[],
  gates: ModelGates = DEFAULT_MODEL_GATES,
): FeasibilityReport {
  const adjudicated = rows.filter(
    (r) => r.final_outcome != null && ["won", "partially_won", "lost"].includes(r.final_outcome),
  );
  const respondedAdj = adjudicated.filter((r) => r.submitted_at != null);

  // Chronological folds: adjudicated events per year.
  const byYear = new Map<string, number>();
  for (const r of respondedAdj) {
    if (!r.initiated_at) continue;
    const yr = r.initiated_at.slice(0, 4);
    byYear.set(yr, (byYear.get(yr) ?? 0) + 1);
  }
  const foldsWithMinEvents = [...byYear.values()].filter((n) => n >= gates.minEventsPerFold).length;

  // Class balance: minority of {win, not-win} among responded adjudicated.
  const wins = respondedAdj.filter((r) => r.final_outcome === "won" || r.final_outcome === "partially_won").length;
  const total = respondedAdj.length;
  const minorityClassFraction = total > 0 ? Math.min(wins, total - wins) / total : null;

  const preventionFeatures = preventionEligibleFeatures();
  const responseFeatures = responseEligibleFeatures();

  const verdicts: ModelVerdict[] = [];

  // Prevention model.
  {
    const failures: string[] = [];
    if (preventionFeatures.length < gates.minEligibleFeatures)
      failures.push(`only ${preventionFeatures.length} model-eligible ODT/SDT feature(s) (need ${gates.minEligibleFeatures}) — risk retrospective + order-time fields unverified (§14)`);
    verdicts.push({
      model: "prevention",
      feasible: failures.length === 0,
      reason: failures.length === 0 ? "gates passed" : "no leakage-safe order-time features available",
      eligibleFeatures: preventionFeatures,
      metrics: { adjudicatedEvents: adjudicated.length, foldsWithMinEvents, minorityClassFraction },
      gateFailures: failures,
      fallback: failures.length === 0 ? "model" : "descriptive_only",
    });
  }

  // Response-win pooled.
  {
    const failures: string[] = [];
    if (responseFeatures.length < gates.minEligibleFeatures)
      failures.push(`only ${responseFeatures.length} model-eligible response feature(s) (need ${gates.minEligibleFeatures}); evidence/submission are analytical-outcome-only, network code unverified`);
    if (respondedAdj.length < gates.minAdjudicatedEvents)
      failures.push(`${respondedAdj.length} adjudicated responded events (need ${gates.minAdjudicatedEvents})`);
    if (foldsWithMinEvents < gates.minFolds)
      failures.push(`only ${foldsWithMinEvents} chronological fold(s) with ≥${gates.minEventsPerFold} events (need ${gates.minFolds})`);
    if (minorityClassFraction != null && minorityClassFraction < gates.minMinorityClassFraction)
      failures.push(`class imbalance: minority fraction ${(minorityClassFraction * 100).toFixed(1)}% < ${(gates.minMinorityClassFraction * 100).toFixed(0)}%`);
    verdicts.push({
      model: "response_win_pooled",
      feasible: failures.length === 0,
      reason: failures.length === 0 ? "gates passed — model may be built (with selection-bias caveats)" : "underpowered / too few leakage-safe features",
      eligibleFeatures: responseFeatures,
      metrics: { adjudicatedEvents: respondedAdj.length, foldsWithMinEvents, minorityClassFraction },
      gateFailures: failures,
      fallback: failures.length === 0 ? "model" : "descriptive_only",
    });
  }

  // Response-win by category — strictly harder (segment cells).
  {
    const failures = [
      "category-specific cells fall below the adjudicated-event gate after segmentation",
    ];
    verdicts.push({
      model: "response_win_by_category",
      feasible: false,
      reason: "segment sample sizes insufficient for per-category calibration",
      eligibleFeatures: responseFeatures,
      metrics: { adjudicatedEvents: respondedAdj.length, foldsWithMinEvents, minorityClassFraction },
      gateFailures: failures,
      fallback: "descriptive_only",
    });
  }

  const anyModelBuilt = verdicts.some((v) => v.feasible);
  const summary = anyModelBuilt
    ? `${verdicts.filter((v) => v.feasible).map((v) => v.model).join(", ")} feasible; others fall back to descriptive.`
    : "No model passed its feasibility gates — all modeling is unsupported for this shop; descriptive outputs (Phases B–C) are retained. Any response-win model would also estimate P(win | historically contested & adjudicated), not an unbiased win probability.";

  return { gates, verdicts, anyModelBuilt, summary };
}
