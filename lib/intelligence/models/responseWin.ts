/**
 * Response-win model (design §14.2, §12 Phase D). Estimates
 *   P(win | information available at response time)
 * over ADJUDICATED, RESPONDED disputes only — so it estimates
 *   P(win | historically contested & adjudicated),
 * NOT an unbiased win probability for every dispute. That selection-bias caveat
 * is stamped on the report and is non-negotiable.
 *
 * Explainable baseline: L2 logistic regression on leakage-safe features
 * (reason one-hot + phase). Validated by CHRONOLOGICAL backtest (train through
 * year k, test on k+1) — never a random split. Calibration is reported. Built
 * only when evaluateModelFeasibility() says the response model is feasible.
 */

import { fitLogistic, predictProba, brierScore, type LogisticModel } from "./logistic";
import type { DisputeRecordRow } from "../report/baseline";
import { scoreConfidence } from "../stats/confidence";
import type { Confidence } from "../types";

export interface FoldResult {
  trainThroughYear: string;
  testYear: string;
  trainN: number;
  testN: number;
  brier: number;
  observedWinRate: number;
  meanPredicted: number;
}

export interface CalibrationBucket {
  bucket: string; // e.g. "0.0–0.2"
  n: number;
  meanPredicted: number;
  observedWinRate: number;
}

export interface ResponseWinModelReport {
  featureSet: string[];
  reasonVocab: string[];
  folds: FoldResult[];
  overall: { testN: number; brier: number; baseRate: number; meanPredicted: number };
  calibration: CalibrationBucket[];
  evidenceGrade: "adjusted_observational";
  confidence: Confidence;
  targetPopulation: string;
  limitations: string[];
}

const WIN = new Set(["won", "partially_won"]);

function year(r: DisputeRecordRow): string {
  return r.initiated_at ? r.initiated_at.slice(0, 4) : "unknown";
}

function encode(rows: DisputeRecordRow[], reasonVocab: string[]): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  for (const r of rows) {
    const feat: number[] = reasonVocab.map((v) => (r.reason === v ? 1 : 0));
    feat.push(r.phase === "chargeback" ? 1 : 0);
    X.push(feat);
    y.push(WIN.has(r.final_outcome ?? "") ? 1 : 0);
  }
  return { X, y };
}

/** Build + chronologically backtest the response-win model. */
export function buildResponseWinModel(
  allRows: DisputeRecordRow[],
  opts: { minEventsPerFold?: number } = {},
): ResponseWinModelReport {
  const minPerFold = opts.minEventsPerFold ?? 40;
  const rows = allRows
    .filter((r) => r.submitted_at != null && r.final_outcome != null && ["won", "partially_won", "lost"].includes(r.final_outcome))
    .filter((r) => r.initiated_at != null)
    .sort((a, b) => (a.initiated_at! < b.initiated_at! ? -1 : 1));

  // Fixed, deterministic reason vocabulary from the full dataset.
  const reasonVocab = [...new Set(rows.map((r) => r.reason ?? "GENERAL"))].sort();
  const featureSet = [...reasonVocab.map((v) => `reason=${v}`), "phase=chargeback"];

  // Usable years (≥ minPerFold) in order.
  const byYear = new Map<string, DisputeRecordRow[]>();
  for (const r of rows) {
    const yr = year(r);
    if (!byYear.has(yr)) byYear.set(yr, []);
    byYear.get(yr)!.push(r);
  }
  const usableYears = [...byYear.entries()].filter(([, v]) => v.length >= minPerFold).map(([k]) => k).sort();

  const folds: FoldResult[] = [];
  const pooledProbs: number[] = [];
  const pooledY: number[] = [];

  for (let i = 1; i < usableYears.length; i++) {
    const testYear = usableYears[i];
    const trainRows = rows.filter((r) => year(r) < testYear);
    const testRows = byYear.get(testYear)!;
    if (trainRows.length < minPerFold) continue;

    const { X: trainX, y: trainY } = encode(trainRows, reasonVocab);
    const model: LogisticModel = fitLogistic(trainX, trainY, { l2: 1.0, iterations: 500, lr: 0.2 });
    const { X: testX, y: testY } = encode(testRows, reasonVocab);
    const probs = testX.map((x) => predictProba(model, x));

    pooledProbs.push(...probs);
    pooledY.push(...testY);
    folds.push({
      trainThroughYear: usableYears[i - 1],
      testYear,
      trainN: trainRows.length,
      testN: testRows.length,
      brier: brierScore(probs, testY),
      observedWinRate: mean(testY),
      meanPredicted: mean(probs),
    });
  }

  const overall = {
    testN: pooledY.length,
    brier: brierScore(pooledProbs, pooledY),
    baseRate: mean(pooledY),
    meanPredicted: mean(pooledProbs),
  };

  const calibration = calibrate(pooledProbs, pooledY, 5);

  // Confidence: model kind, driven by backtest sample + stability + selection bias.
  const stable = folds.length >= 2 && folds.every((f) => Math.abs(f.meanPredicted - f.observedWinRate) < 0.2);
  const confidence = scoreConfidence("model", {
    events: overall.testN,
    ciWidth: 0.2,
    missingnessPct: 0,
    temporalStability: stable ? "sign_consistent" : "one_unstable",
    classification: "direct_derived",
    measurementValidity: "valid",
    fdr: "q10",
    confounders: "principal_unmeasured", // why merchants contested is unmeasured
  }).confidence;

  return {
    featureSet,
    reasonVocab,
    folds,
    overall,
    calibration,
    evidenceGrade: "adjusted_observational",
    confidence,
    targetPopulation: "P(win | historically contested & adjudicated) — NOT an unbiased win probability for all disputes.",
    limitations: [
      "Trained only on historically responded & adjudicated disputes — strong selection bias; does not transport to unanswered/never-contested disputes.",
      "Explainable baseline (logistic) on reason + phase only; features are associative, not causal.",
      "Chronologically backtested (train→next year); early years excluded for insufficient events.",
      "A prediction is a decision-support signal, never an instruction to skip a dispute.",
    ],
  };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function calibrate(probs: number[], y: number[], bins: number): CalibrationBucket[] {
  const out: CalibrationBucket[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const idx: number[] = [];
    for (let i = 0; i < probs.length; i++) {
      if (probs[i] >= lo && (probs[i] < hi || (b === bins - 1 && probs[i] <= hi))) idx.push(i);
    }
    if (idx.length === 0) continue;
    out.push({
      bucket: `${lo.toFixed(1)}–${hi.toFixed(1)}`,
      n: idx.length,
      meanPredicted: mean(idx.map((i) => probs[i])),
      observedWinRate: mean(idx.map((i) => y[i])),
    });
  }
  return out;
}
