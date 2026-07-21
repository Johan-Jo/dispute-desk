/**
 * Confidence rubric `confidence_rubric_v1` (design §7.2).
 *
 * Deterministic + versioned: identical inputs → identical output. Confidence
 * has FOUR kinds; only the factors APPLICABLE to a kind are evaluated, so a
 * correctly-computed descriptive total is never dinged to `low` by confounder
 * availability or FDR. Result = the MINIMUM cap across applicable factors.
 */

import type { Confidence, ConfidenceKind } from "../types";
import { DEFAULT_SAMPLE_GATES, CONFIDENCE_RUBRIC_VERSION, type SampleGates } from "../config";

export { CONFIDENCE_RUBRIC_VERSION };

const ORDER: Confidence[] = ["insufficient", "low", "moderate", "high"];
const rank = (c: Confidence) => ORDER.indexOf(c);
const minConf = (a: Confidence, b: Confidence): Confidence => (rank(a) <= rank(b) ? a : b);

export interface ConfidenceFactors {
  events?: number;
  ciWidth?: number; // for binary rates
  missingnessPct?: number;
  temporalStability?: "stable" | "sign_consistent" | "one_unstable" | "reverses";
  classification?: "direct_derived" | "mixed" | "inferred";
  measurementValidity?: "valid" | "minor_proxy" | "proxy_gap" | "invalid";
  fdr?: "q05" | "q10" | "exploratory";
  confounders?: "measured" | "some" | "principal_unmeasured";
}

/** Which factors each confidence kind evaluates (§7.2 applicability table). */
const APPLICABLE: Record<ConfidenceKind, (keyof ConfidenceFactors)[]> = {
  descriptive_data: ["events", "missingnessPct", "measurementValidity"],
  statistical_estimate: [
    "events", "ciWidth", "missingnessPct", "temporalStability",
    "classification", "measurementValidity", "fdr",
  ],
  recommendation: [
    "events", "ciWidth", "missingnessPct", "temporalStability",
    "classification", "measurementValidity", "fdr", "confounders",
  ],
  model: [
    "events", "ciWidth", "missingnessPct", "temporalStability",
    "classification", "measurementValidity", "fdr", "confounders",
  ],
};

function sampleCap(events: number, gates: SampleGates): Confidence {
  if (events < gates.eventsForLow) return "insufficient";
  if (events < gates.eventsForModerate) return "low";
  if (events < gates.eventsForHigh) return "moderate";
  return "high";
}

function ciCap(width: number): Confidence {
  if (width > 0.35) return "insufficient";
  if (width > 0.2) return "low";
  if (width > 0.1) return "moderate";
  return "high";
}

function missingCap(pct: number): Confidence {
  if (pct > 30) return "insufficient";
  if (pct > 15) return "low";
  if (pct > 5) return "moderate";
  return "high";
}

function stabilityCap(s: NonNullable<ConfidenceFactors["temporalStability"]>): Confidence {
  switch (s) {
    case "reverses": return "insufficient";
    case "one_unstable": return "low";
    case "sign_consistent": return "moderate";
    case "stable": return "high";
  }
}

function classificationCap(c: NonNullable<ConfidenceFactors["classification"]>): Confidence {
  switch (c) {
    case "inferred": return "low"; // e.g. 100%-inferred network codes
    case "mixed": return "moderate";
    case "direct_derived": return "high";
  }
}

function measurementCap(m: NonNullable<ConfidenceFactors["measurementValidity"]>): Confidence {
  switch (m) {
    case "invalid": return "insufficient"; // e.g. retrospective risk feature
    case "proxy_gap": return "low";
    case "minor_proxy": return "moderate";
    case "valid": return "high";
  }
}

function fdrCap(f: NonNullable<ConfidenceFactors["fdr"]>): Confidence {
  switch (f) {
    case "exploratory": return "low";
    case "q10": return "moderate";
    case "q05": return "high";
  }
}

function confounderCap(c: NonNullable<ConfidenceFactors["confounders"]>): Confidence {
  switch (c) {
    case "principal_unmeasured": return "low";
    case "some": return "moderate";
    case "measured": return "high";
  }
}

export interface ConfidenceResult {
  confidence: Confidence;
  kind: ConfidenceKind;
  rubricVersion: string;
  caps: Record<string, Confidence>; // per-applicable-factor cap (audit trail)
}

export function scoreConfidence(
  kind: ConfidenceKind,
  factors: ConfidenceFactors,
  gates: SampleGates = DEFAULT_SAMPLE_GATES,
): ConfidenceResult {
  const applicable = APPLICABLE[kind];
  const caps: Record<string, Confidence> = {};

  for (const key of applicable) {
    const val = factors[key];
    if (val === undefined) continue;
    switch (key) {
      case "events": caps.events = sampleCap(val as number, gates); break;
      case "ciWidth": caps.ciWidth = ciCap(val as number); break;
      case "missingnessPct": caps.missingnessPct = missingCap(val as number); break;
      case "temporalStability": caps.temporalStability = stabilityCap(val as never); break;
      case "classification": caps.classification = classificationCap(val as never); break;
      case "measurementValidity": caps.measurementValidity = measurementCap(val as never); break;
      case "fdr": caps.fdr = fdrCap(val as never); break;
      case "confounders": caps.confounders = confounderCap(val as never); break;
    }
  }

  const values = Object.values(caps);
  const confidence = values.length === 0
    ? "insufficient"
    : values.reduce((acc, c) => minConf(acc, c), "high" as Confidence);

  return { confidence, kind, rubricVersion: CONFIDENCE_RUBRIC_VERSION, caps };
}
