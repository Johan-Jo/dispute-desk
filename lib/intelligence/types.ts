/**
 * Core types for the Historical Intelligence Engine (design v4).
 * Phase A ships runs + data-quality audit + feature registry + stats.
 */

// ─── Feature registry (design §6) ────────────────────────────────────────────

export type AvailabilityStage =
  | "ORDER_DECISION_TIME"
  | "SHIP_DECISION_TIME"
  | "POST_SHIP_OBSERVATION"
  | "DISPUTE_RESPONSE_TIME"
  | "POST_OUTCOME_ONLY";

/** Which timestamp governs when a feature's value became known. */
export type GoverningTime =
  | "source_event"
  | "ingestion"
  | "classification_generation";

export interface FeatureDescriptor {
  key: string;
  source: string;
  definition: string;
  stage: AvailabilityStage;
  /** How `available_at` is established for a row (column or derivation). */
  availableAtRule: string;
  governingTime: GoverningTime;
  /** Interpretation of a missing value — NEVER a negative fact. */
  missingMeans: string;
  /** May feed a prevention model (requires proven available_at ≤ ship cutoff). */
  preventionModelEligible: boolean;
  /** May feed a response-WIN model (requires proven available_at ≤ scored_at). */
  responseModelEligible: boolean;
  /** Analytical-outcome-only: describable but never a predictive feature. */
  analyticalOutcomeOnly: boolean;
  /** Held descriptive-only until a §14 provenance task is resolved. */
  unverifiedPendingProvenance: boolean;
  /** Retrospective — value reflects a post-decision snapshot. */
  retrospectiveOnly: boolean;
}

// ─── Customer tenure (design §5.1) ───────────────────────────────────────────

export type Tenure =
  | "returning"
  | "first_seen_in_observed_history"
  | "unknown"; // engine never asserts a bare "new" without a full-history signal

// ─── Outcomes (design §7.1) ──────────────────────────────────────────────────

export type FinalOutcome =
  | "won"
  | "partially_won"
  | "lost"
  | "withdrawn"
  | "accepted"
  | "refunded"
  | "canceled"
  | "expired"
  | "closed_other"
  | "workflow_closed_but_outcome_unknown"
  | "pending"
  | "unknown"; // raw DB value; mapped to workflow_closed_but_outcome_unknown

// ─── Confidence (design §7.2) ────────────────────────────────────────────────

export type Confidence = "insufficient" | "low" | "moderate" | "high";

export type EvidenceGrade =
  | "descriptive"
  | "adjusted_observational"
  | "prospectively_validated";

export type RecommendationCategory =
  | "prevention"
  | "response"
  | "automation"
  | "economic_non_response";

/** Persisted recommendation row (design §11), money as decimal-string bigint. */
export interface RecommendationRow {
  id: string;
  analysis_run_id: string;
  shop_id: string;
  category: RecommendationCategory;
  title: string;
  summary: string;
  suggested_action: string;
  affected_order_count: number;
  affected_dispute_count: number;
  affected_disputed_minor: string | null;
  currency: string | null;
  baseline_metric: { name: string; value: number; numerator?: number; denominator?: number };
  estimate_lower_minor: string | null;
  estimate_point_minor: string | null;
  estimate_upper_minor: string | null;
  estimate_period: "historical_total" | "annualized" | null;
  evidence_grade: EvidenceGrade;
  confidence: Confidence;
  confidence_kind: string | null;
  implementation_effort: "low" | "medium" | "high" | null;
  customer_friction_risk: "low" | "medium" | "high" | null;
  limitations: string[];
  assumptions: string[];
  required_data_quality_checks: string[];
  supporting_segment_ids: string[];
  explanation?: string | null;
  explanation_model?: string | null;
  explanation_generated_at?: string | null;
  created_at: string;
}

export type ConfidenceKind =
  | "descriptive_data"
  | "statistical_estimate"
  | "recommendation"
  | "model";

// ─── Data-quality (design §2, §8) ────────────────────────────────────────────

export type DataAreaStatus =
  | "reliable"
  | "usable_with_limitations"
  | "insufficient"
  | "unknown";

export interface DataQualityFacts {
  generated_at: string;
  orders: {
    count: number;
    min_processed_at: string | null;
    max_processed_at: string | null;
    coverage_start: string | null;
    distinct_currencies: number;
    by_year: Record<string, number>;
    pct_null_risk_initial: number | null;
    pct_null_country: number | null;
    pct_null_payment_gateway: number | null;
    pct_null_delivery_status: number | null;
    pct_has_chargeback_true: number | null;
    implausible_dates: number;
  };
  leakage: {
    median_ingest_lag_hours: number | null;
    pct_ingested_within_48h: number | null;
  };
  disputes: {
    count: number;
    min_initiated_at: string | null;
    max_initiated_at: string | null;
    distinct_currencies: number;
    by_year: Record<string, number>;
    pct_orphan_no_order: number | null;
    pct_null_phase: number | null;
    pct_unclassified_reason: number | null;
    pct_null_final_outcome: number | null;
    count_adjudicated: number;
    count_submitted: number;
    pct_network_code_direct_or_derived: number | null;
    count_with_outcome_amount: number;
    orders_with_multiple_disputes: number;
    missing_deadline_count: number;
    count_with_response_opportunity: number;
  };
  evidence: { pack_count: number; item_count: number };
}

export interface DataAreaAssessment {
  area: string;
  status: DataAreaStatus;
  reason: string;
  notes?: string[];
}

export interface DataQualityReport {
  facts: DataQualityFacts;
  areas: DataAreaAssessment[];
  /** Leakage check: is risk-based prevention analysis safe? */
  riskPreventionSupported: boolean;
  /** Limitations to surface on every downstream conclusion. */
  globalLimitations: string[];
}

// ─── Runs (design §19) ───────────────────────────────────────────────────────

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type RunStage =
  | "pending"
  | "auditing"
  | "preparing"
  | "reporting"
  | "recommending"
  | "complete";

export interface AnalysisRunRow {
  id: string;
  shop_id: string;
  status: RunStatus;
  stage: RunStage;
  triggered_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  data_cutoff: string | null;
  source_row_counts: Record<string, number>;
  feature_registry_version: string | null;
  classification_version: string | null;
  methodology_version: string | null;
  data_quality: DataQualityReport | null;
  warnings: string[];
  errors: string[];
  created_at: string;
}
