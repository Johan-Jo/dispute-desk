/**
 * Post-outcome analysis — the controlled vocabularies.
 *
 * Plan: `docs/plans/post-outcome-evidence-analysis.plan.md` §4, §8, §9, §10, §17.
 *
 * Every list here is closed. The synthesis layer (plan §12) may only emit values
 * drawn from these arrays, and the schema validator rejects anything else. That
 * is the mechanism that stops a language model inventing a finding category, or
 * quietly upgrading its own confidence, in a surface whose entire value is that
 * its claims are bounded by what the record proves.
 *
 * These are analytical/internal values. They are NOT merchant-facing copy and
 * must never be rendered raw to a merchant — the admin page is internal-only
 * (plan §17), and merchant-facing strings go through the i18n token path.
 */

/* ─────────────────────────── Provider and network ─────────────────────────── */

/**
 * The system that OWNS the dispute workflow. Never inferred from the card
 * network, and never the other way round (plan §4.3).
 */
export const PAYMENT_PROVIDERS = [
  "SHOPIFY_PAYMENTS",
  "KLARNA",
  "PAYPAL",
  "OTHER",
  "UNKNOWN",
] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

/** The underlying card network, only when reliably determined. */
export const CARD_NETWORKS = [
  "VISA",
  "MASTERCARD",
  "AMEX",
  "DISCOVER",
  "OTHER",
  "UNKNOWN",
] as const;
export type CardNetwork = (typeof CARD_NETWORKS)[number];

/**
 * What DisputeDesk could actually see of the provider's case file.
 *
 * `platform_save_confirmation` is deliberately separate from
 * `submission_confirmation_access` and MUST NOT be derived from it in either
 * direction (plan §4.3, decision of 2026-08-30).
 *
 * A save confirmation proves the platform stored our evidence and read it back.
 * It proves nothing about forwarding to the issuer or the network. In prod,
 * four packages carry `shopify_response.verified = true` AND
 * `defence_packages.status = 'submitted'` while `submission_state` is still
 * `saved_to_shopify` with a NULL `submitted_at` — Shopify never reported
 * forwarding them. Collapsing the two capabilities would score those as sent.
 */
export interface ProviderCapabilities {
  /** Can retrieve the buyer's/provider's specific allegation. */
  claimDetailAccess: boolean;
  /** Can retrieve the provider-side evidence record. */
  providerEvidenceReadAccess: boolean;
  /** Can write/update evidence through the provider. */
  providerEvidenceWriteAccess: boolean;
  /** Platform confirmed evidence was STORED and read back. Storage only. */
  platformSaveConfirmation: boolean;
  /** Can prove what and when the provider FORWARDED to the issuer/network. */
  submissionConfirmationAccess: boolean;
  /** Receives a reliable final outcome. */
  outcomeAccess: boolean;
  /** Receives the provider's/adjudicator's actual decision rationale. */
  adjudicationReasonAccess: boolean;
}

export const PROVIDER_ACCESS_LEVELS = [
  "FULL_CASE_FILE",
  "PARTIAL_CASE_FILE",
  "OUTCOME_ONLY",
  "NO_PROVIDER_CASE_ACCESS",
  "UNKNOWN",
] as const;
export type ProviderAccessLevel = (typeof PROVIDER_ACCESS_LEVELS)[number];

/**
 * Where a forwarding claim came from. `PLATFORM_SAVE_ONLY` is listed so the
 * snapshot can record "we have a save confirmation and nothing more" as a
 * positive fact rather than as an absence.
 */
export const SUBMISSION_CONFIRMATION_SOURCES = [
  /** Shopify's own `evidenceSentOn`. Trusted forwarding confirmation. */
  "SHOPIFY_EVIDENCE_SENT_ON",
  /** A provider-side submission log with an ID. None exist today. */
  "PROVIDER_LOG",
  /** Merchant assertion only. Never sufficient for FULL_POST_OUTCOME. */
  "MANUAL_MERCHANT_REPORT",
  /** Save/readback confirmed, forwarding NOT confirmed. */
  "PLATFORM_SAVE_ONLY",
  "NONE",
] as const;
export type SubmissionConfirmationSource =
  (typeof SUBMISSION_CONFIRMATION_SOURCES)[number];

/** How the package was tied to the saved platform evidence (plan §4.4 cond. 2). */
export const PACKAGE_EVIDENCE_TIES = [
  /** `shopify_response.evidenceGid` matches `disputes.dispute_evidence_gid`. */
  "EVIDENCE_GID_MATCH",
  /** Several submitted packages; the forwarded one is not identifiable. */
  "AMBIGUOUS_MULTIPLE_PACKAGES",
  "NONE",
] as const;
export type PackageEvidenceTie = (typeof PACKAGE_EVIDENCE_TIES)[number];

/* ──────────────────────────── Analysis levels ─────────────────────────────── */

export const ANALYSIS_LEVELS = [
  "FULL_POST_OUTCOME",
  "PACKAGE_INTEGRITY_ONLY",
  "OUTCOME_METADATA_ONLY",
  "NOT_ANALYZABLE",
] as const;
export type AnalysisLevel = (typeof ANALYSIS_LEVELS)[number];

/** Only these levels may produce evidence-effectiveness conclusions (plan §4.4). */
export const EVIDENCE_EFFECTIVENESS_LEVELS: ReadonlySet<AnalysisLevel> = new Set([
  "FULL_POST_OUTCOME",
]);

export const ANALYSIS_STATUSES = [
  "PENDING",
  "BUILDING_SNAPSHOT",
  "RUNNING_CHECKS",
  "COMPLETED",
  "FAILED",
  "DATA_INTEGRITY_BLOCKED",
  "SUPERSEDED",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/**
 * Whether the reason-specific module ran.
 *
 * `NOT_YET_SUPPORTED` and `NOT_RECONSTRUCTABLE` are different statements and
 * must not be collapsed: the first means "no module exists for this reason
 * yet", the second means "the module exists but this case's facts are absent
 * from the snapshot". Only the first is fixed by shipping more code.
 */
export const REASON_SPECIFIC_STATUSES = [
  "SUPPORTED",
  "NOT_YET_SUPPORTED",
  "NOT_RECONSTRUCTABLE",
  "BLOCKED",
] as const;
export type ReasonSpecificStatus = (typeof REASON_SPECIFIC_STATUSES)[number];

/* ───────────────────────────── Finding taxonomy ───────────────────────────── */

export const FINDING_CATEGORIES = [
  "EFFECTIVE_CONFIGURATION_CANDIDATE",
  "WIN_WITH_INTEGRITY_DEFECT",
  "UNWINNABLE_OR_ADVERSE_FACTS",
  "MISSING_ACQUIRABLE_EVIDENCE",
  "AVAILABLE_EVIDENCE_OMITTED",
  "INCORRECT_EVIDENCE_INTERPRETATION",
  "UNSUPPORTED_OR_OVERSTATED_ASSERTION",
  "WRONG_NETWORK_OR_REASON_LOGIC",
  "WEAK_OR_IRRELEVANT_PRESENTATION",
  "PROCEDURAL_OR_SUBMISSION_FAILURE",
  "DATA_INTEGRITY_FAILURE",
  "NO_MATERIAL_GAP_OBSERVED",
  "INDETERMINATE",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/**
 * Categories that assert something about why a case SUCCEEDED. Gated on a won
 * outcome AND an analysis level that permits evidence-effectiveness claims.
 *
 * This gate is why the single prod win produces no candidate: that case is
 * PACKAGE_INTEGRITY_ONLY (saved, never confirmed forwarded), so its package
 * plausibly never reached an adjudicator. Learning a "winning configuration"
 * from a package nobody read is precisely the error the gate exists to stop.
 */
export const WIN_ONLY_CATEGORIES: ReadonlySet<FindingCategory> = new Set([
  "EFFECTIVE_CONFIGURATION_CANDIDATE",
  "WIN_WITH_INTEGRITY_DEFECT",
]);

export const CONFIDENCE_LEVELS = ["DEFINITE", "HIGH", "MODERATE", "LOW"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const SEVERITY_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

export const ACTION_CLASSES = [
  "EVIDENCE_ACQUISITION",
  "PIPELINE_RELIABILITY",
  "RULE_ENGINE",
  "EVIDENCE_MAPPING",
  "NARRATIVE_TEMPLATE",
  "MERCHANT_OPERATIONS",
  "DATA_QUALITY",
  "NO_ACTION",
] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

/* ───────────────────── Evidence and assertion classification ──────────────── */

export const EVIDENCE_CLASSIFICATIONS = [
  "INCLUDED_ACCURATELY",
  "INCLUDED_INACCURATELY",
  "AVAILABLE_BUT_OMITTED",
  "AVAILABLE_BUT_NOT_APPROVED",
  "PENDING_AND_CORRECTLY_EXCLUDED",
  "ARRIVED_AFTER_SUBMISSION",
  "UNAVAILABLE",
  "AVAILABILITY_UNKNOWN",
  "IRRELEVANT_TO_REASON",
] as const;
export type EvidenceClassification = (typeof EVIDENCE_CLASSIFICATIONS)[number];

export const ASSERTION_CLASSIFICATIONS = [
  "SUPPORTED_AND_RELEVANT",
  "SUPPORTED_BUT_IRRELEVANT",
  "UNSUPPORTED",
  "CONTRADICTED_BY_EVIDENCE",
  "OFF_SCOPE_NETWORK_RULE",
  "OVERSTATED",
  "NOT_MACHINE_VERIFIABLE",
] as const;
export type AssertionClassification = (typeof ASSERTION_CLASSIFICATIONS)[number];

/* ──────────────────────────── Review and outcome ──────────────────────────── */

export const REVIEW_DISPOSITIONS = [
  "CONFIRMED",
  "EDITED",
  "REJECTED",
  "INDETERMINATE",
] as const;
export type ReviewDisposition = (typeof REVIEW_DISPOSITIONS)[number];

export const REVIEW_STATES = [
  "PENDING_REVIEW",
  ...REVIEW_DISPOSITIONS,
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** The only outcomes this feature analyses. `accepted` is not decided-by-adjudicator. */
export const ANALYZABLE_OUTCOMES = ["won", "lost"] as const;
export type AnalyzableOutcome = (typeof ANALYZABLE_OUTCOMES)[number];

/* ───────────────────────────── Runtime guards ─────────────────────────────── */

function memberOf<T extends readonly string[]>(list: T) {
  const set = new Set<string>(list);
  return (value: unknown): value is T[number] =>
    typeof value === "string" && set.has(value);
}

export const isPaymentProvider = memberOf(PAYMENT_PROVIDERS);
export const isCardNetwork = memberOf(CARD_NETWORKS);
export const isProviderAccessLevel = memberOf(PROVIDER_ACCESS_LEVELS);
export const isAnalysisLevel = memberOf(ANALYSIS_LEVELS);
export const isAnalysisStatus = memberOf(ANALYSIS_STATUSES);
export const isReasonSpecificStatus = memberOf(REASON_SPECIFIC_STATUSES);
export const isFindingCategory = memberOf(FINDING_CATEGORIES);
export const isConfidenceLevel = memberOf(CONFIDENCE_LEVELS);
export const isSeverityLevel = memberOf(SEVERITY_LEVELS);
export const isActionClass = memberOf(ACTION_CLASSES);
export const isEvidenceClassification = memberOf(EVIDENCE_CLASSIFICATIONS);
export const isAssertionClassification = memberOf(ASSERTION_CLASSIFICATIONS);
export const isReviewDisposition = memberOf(REVIEW_DISPOSITIONS);
export const isAnalyzableOutcome = memberOf(ANALYZABLE_OUTCOMES);
export const isSubmissionConfirmationSource = memberOf(
  SUBMISSION_CONFIRMATION_SOURCES,
);
export const isPackageEvidenceTie = memberOf(PACKAGE_EVIDENCE_TIES);

/* ─────────────────────────── Causal-language guard ────────────────────────── */

/**
 * Phrases that assert a cause the record cannot support (plan §9).
 *
 * The bank does not tell us why it ruled. Any finding that says it did is
 * fabricated, however plausible. This list is checked by the schema validator
 * against every synthesised string before it is persisted, so the failure mode
 * is a rejected finding rather than a confident lie on an internal dashboard
 * that later drives a rule change.
 */
export const FORBIDDEN_CAUSAL_PATTERNS: readonly RegExp[] = [
  /\bthe bank rejected this because\b/i,
  /\bthe issuer rejected (this|it) because\b/i,
  /\bwould have won\b/i,
  /\bwe would have won\b/i,
  /\bthis lost because\b/i,
  /\bcaused the (loss|rejection|decision)\b/i,
  /\bexpected win[- ]rate lift\b/i,
  /\bguaranteed (win|success)\b/i,
];

/** Returns the patterns a string violates. Empty array means clean. */
export function findCausalLanguageViolations(text: string): RegExp[] {
  return FORBIDDEN_CAUSAL_PATTERNS.filter((pattern) => pattern.test(text));
}
