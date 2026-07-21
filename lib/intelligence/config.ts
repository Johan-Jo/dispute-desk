/**
 * Versioned configuration for the Historical Intelligence Engine.
 *
 * Every version string here is pinned into each analysis run for
 * reproducibility (design §19). Bumping a threshold bumps the relevant
 * version so historical runs remain reproducible.
 */

export const FEATURE_REGISTRY_VERSION = "feature_registry_v1";
export const METHODOLOGY_VERSION = "methodology_v1";
export const CONFIDENCE_RUBRIC_VERSION = "confidence_rubric_v1";
/** Classification inputs the engine consumes (design §1.2). Catalog version
 *  from lib/disputes/reasonCodeCatalog.ts CATALOG_VERSION at time of writing. */
export const CLASSIFICATION_VERSION = "reason_catalog_2026-05-01";

/** Statistical sample gates (design §7). Below `minEvents` → suppress. */
export interface SampleGates {
  minExposedPopulation: number;
  minEvents: number;
  minResolvedOutcomes: number;
  maxMissingnessPct: number;
  minHistoricalPeriods: number;
  /** Confidence caps keyed off adjudicated-event count. */
  eventsForHigh: number;
  eventsForModerate: number;
  eventsForLow: number;
}

export const DEFAULT_SAMPLE_GATES: SampleGates = {
  minExposedPopulation: 100,
  minEvents: 10,
  minResolvedOutcomes: 10,
  maxMissingnessPct: 30,
  minHistoricalPeriods: 2,
  eventsForHigh: 100,
  eventsForModerate: 30,
  eventsForLow: 10,
};

/**
 * Customer-history wash-in (design §5.1). An order whose creation is within
 * this window of the shop's coverage boundary cannot be confidently called
 * `first_seen_in_observed_history` — tenure degrades to `unknown`. This does
 * NOT prove newness; it only guards the left-censor boundary.
 */
export const CUSTOMER_HISTORY_WASHIN_DAYS = 30;

/**
 * Data-quality reliability thresholds (design §8). Applied in TS over the
 * SQL audit facts. Percentages are "% missing/unavailable".
 */
export const DATA_QUALITY_THRESHOLDS = {
  reliableMaxMissingPct: 5,
  usableMaxMissingPct: 30,
  minRowsReliable: 100,
  minRowsUsable: 30,
  /** Above this median ingest-lag (hours), risk features are retrospective. */
  riskLeakageMaxLagHours: 48,
};

/**
 * Cost assumptions for the EV framework (design §8). Money-like values are
 * stored as minor units (string) + currency at the run level; effectiveness
 * is INTEGER BASIS POINTS, never a float. Phase A stores defaults only; the
 * EV computation lands in Phase C.
 */
export interface CostAssumptions {
  currency: string | null;
  responseMinutes: number | null;
  loadedHourlyCostMinor: string | null;
  disputeFeeMinor: string | null;
  evidenceGenerationCostMinor: string | null;
  manualReviewCostMinor: string | null;
  signatureUpgradeCostMinor: string | null;
  grossMarginBps: number | null;
  frictionCostMinor: string | null;
  economicSafetyMarginBps: number | null;
}

export const EMPTY_COST_ASSUMPTIONS: CostAssumptions = {
  currency: null,
  responseMinutes: null,
  loadedHourlyCostMinor: null,
  disputeFeeMinor: null,
  evidenceGenerationCostMinor: null,
  manualReviewCostMinor: null,
  signatureUpgradeCostMinor: null,
  grossMarginBps: null,
  frictionCostMinor: null,
  economicSafetyMarginBps: null,
};

export function runVersions() {
  return {
    featureRegistryVersion: FEATURE_REGISTRY_VERSION,
    classificationVersion: CLASSIFICATION_VERSION,
    methodologyVersion: METHODOLOGY_VERSION,
  };
}
