/**
 * Grounded Defence Package PDF Builder — shared types.
 *
 * The boundary between system-owned facts and the LLM:
 *
 *   raw Shopify payloads  →  classifyFacts  →  EvidenceFact[]  →  narrativeWriter (LLM)
 *                                                              →  DefencePackageDocument (PDF)
 *                                                              →  admin run detail
 *
 * Nothing downstream of `classifyFacts` may consume raw Shopify JSON.
 *
 * See plan at C:\Users\johan\.claude\plans\cozy-zooming-popcorn.md.
 */

import type { EvidenceCategory, SignalId } from "@/lib/argument/canonicalEvidence";
import type { CaseStrengthLevel } from "@/lib/argument/types";

// ── Package row ──────────────────────────────────────────────────────

export type DefencePackageStatus =
  | "draft"
  | "stale"
  | "final"
  | "submitted"
  | "superseded"
  | "failed"
  | "skipped";

export type PackageMode = "full" | "narrow";

export type DefencePackageGeneratedBy = "system" | "merchant" | "admin";

export type DefencePackageValidationStatus = "ok" | "failed" | "skipped";

export type DefencePackageFailureCode =
  | "covered_shopify"
  | "no_bank_eligible_facts"
  | "validation_failed"
  | "llm_error"
  | "pdf_render_failed"
  | "daily_cap_reached";

/** Wire shape of a `defence_packages` row. Matches the migration column-for-column. */
export interface DefencePackage {
  id: string;
  disputeId: string;
  shopId: string;
  sourcePackId: string;
  orderId: string | null;
  version: number;
  status: DefencePackageStatus;
  packageMode: PackageMode | null;
  generatedAt: string;
  generatedBy: DefencePackageGeneratedBy;
  pdfPath: string | null;
  pdfStorageBucket: string;
  evidenceHash: string;
  llmModel: string | null;
  promptFamily: string | null;
  promptVersion: number | null;
  reasonCodeModule: string | null;
  outputSchemaVersion: number;
  validationStatus: DefencePackageValidationStatus | null;
  validationErrors: ValidationError[];
  narrativeJson: DefenceNarrativeOutput | null;
  factsJson: EvidenceFact[] | null;
  submittedAt: string | null;
  submittedBy: string | null;
  shopifyResponse: Record<string, unknown> | null;
  supersededById: string | null;
  failureCode: DefencePackageFailureCode | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Evidence Fact ────────────────────────────────────────────────────

/** Strength tier — mirrors the canonical-evidence registry. */
export type EvidenceFactStrength = EvidenceCategory;

/** Semantic grouping a fact belongs to. Drives reason-code prioritization
 *  and the Evidence Basis section ordering. Aligned with SignalId from
 *  the canonical registry, plus a few defence-package-specific buckets. */
export type EvidenceFactCategory =
  | SignalId
  | "delivery_proof"
  | "shipping_tracking"
  | "digital_access_log"
  | "service_access"
  | "customer_communication"
  | "policy_acceptance"
  | "policy_refund"
  | "policy_shipping"
  | "policy_cancellation"
  | "refund_record"
  | "duplicate_explanation"
  | "subscription_terms"
  | "billing_match"
  | "payment_authentication"
  | "prior_customer_history"
  | "order_record"
  | "manual_evidence";

export interface EvidenceFact {
  /** Stable id used for `usedFactIds` referential checks. */
  id: string;
  category: EvidenceFactCategory;
  label: string;
  /** Structured value — the only place the LLM sees specifics.
   *  Numeric/string/iso-timestamp values are fine; raw Shopify JSON is not. */
  value: Record<string, unknown>;
  /** Free-text source descriptor (e.g. "shopify_order", "manual_upload"). */
  source: string;
  /** Optional pointer back to the source row (e.g. `evidence_items.id`). */
  sourceRef: string | null;
  strength: EvidenceFactStrength;
  bankEligible: boolean;
  merchantVisible: boolean;
  internalOnly: boolean;
  /** Defaults to `bankEligible && !submissionRisk`. Ops can override per
   *  manual evidence row. Setting true when `submissionRisk=true` is an
   *  explicit acknowledgement that the merchant wants this surfaced. */
  includeInBankNarrative: boolean;
  /** When true, the LLM and PDF must omit this fact unless
   *  `includeInBankNarrative` is also true. Set by the classifier for
   *  IP mismatches, fraud-risk HIGH/MEDIUM, AVS/CVV failure, missing
   *  delivery on a fulfilled order, proxy/VPN warnings, etc. */
  submissionRisk: boolean;
  confidence: number | null;
}

export interface MissingEvidence {
  category: EvidenceFactCategory;
  label: string;
  reason: string;
  merchantRecommendation: string;
  bankVisible: false;
}

// ── Manual evidence ──────────────────────────────────────────────────

export interface ManualEvidenceRecord {
  id: string;
  packageId: string;
  evidenceItemId: string;
  filename: string;
  fileUrl: string | null;
  fileType: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  description: string | null;
  bankEligible: boolean;
  includeInPackage: boolean;
  includeInBankNarrative: boolean;
  evidenceCategory: EvidenceFactCategory | null;
}

// ── Classifier output ────────────────────────────────────────────────

export interface FactClassificationResult {
  approved: EvidenceFact[];
  internalOnly: EvidenceFact[];
  submissionRisk: EvidenceFact[];
  missing: MissingEvidence[];
  manual: ManualEvidenceRecord[];
  packageMode: PackageMode;
  /** True when classification short-circuits — caller writes status=skipped. */
  eligible: boolean;
  ineligibilityReason: DefencePackageFailureCode | null;
}

// ── Reason-code module ───────────────────────────────────────────────

export type ReasonCodeModuleKey =
  | "visa_10_4_fraud"
  | "inr_product_not_received"
  | "product_unacceptable"
  | "credit_not_processed"
  | "duplicate_processing"
  | "canceled_recurring"
  | "generic_fallback";

export interface ReasonCodeGuidance {
  key: ReasonCodeModuleKey;
  displayName: string;
  /** Network reason codes (Visa + MC) this module covers. */
  reasonCodeKeys: string[];
  /** Module-specific system prompt body (rendered into the second cached
   *  system block — the first is the static base prompt). */
  promptBody: string;
  /** Fact categories the LLM should foreground for this reason code. */
  prioritize: EvidenceFactCategory[];
  /** Categories the LLM must not cite as supporting this reason code. */
  avoid: EvidenceFactCategory[];
  /** Phrases the LLM must never produce for this reason code. */
  mustNotClaim: string[];
  /** Categories required for a `full` (vs `narrow`) package mode. Missing
   *  any of these forces `narrow`. */
  criticalCategories: EvidenceFactCategory[];
  /** Whitelist of fact categories the LLM may reference at all under
   *  this reason code. */
  allowedFactCategories: EvidenceFactCategory[];
  version: number;
}

// ── Narrative I/O ────────────────────────────────────────────────────

/** Section keys mirror the deterministic PDF section order. */
export type NarrativeSectionKey =
  | "executiveSummary"
  | "transactionOverviewArgument"
  | "chronologyArgument"
  | "paymentAuthenticationArgument"
  | "fulfillmentArgument"
  | "communicationArgument"
  | "policyArgument"
  | "manualEvidenceArgument"
  | "conclusion";

export interface NarrativeSection {
  text: string;
  usedFactIds: string[];
}

export interface OmittedSection {
  sectionKey: NarrativeSectionKey;
  reason: string;
}

/** What we send to the LLM. Strict — no raw Shopify JSON, ever. */
export interface NarrativeInput {
  packageId: string;
  disputeId: string;
  /** Network reason code (Visa "10.4", MC "4837", etc.). */
  reasonCode: string | null;
  reasonCodeModule: ReasonCodeGuidance;
  packageMode: PackageMode;
  caseStrength: CaseStrengthLevel;
  approvedFacts: EvidenceFact[];
  manualEvidence: ManualEvidenceRecord[];
  /** Sent as forbidden references so the LLM knows what *not* to mention
   *  even though the payload doesn't include their values. The model sees
   *  only the ids + categories, never the underlying values. */
  internalOnlyFactIds: string[];
  /** Sent for omission decisions only. Never quoted in narrative. */
  missingEvidence: MissingEvidence[];
}

/** What the LLM returns. Validated by `validateNarrative`. */
export interface DefenceNarrativeOutput {
  executiveSummary: NarrativeSection;
  transactionOverviewArgument: NarrativeSection;
  chronologyArgument: NarrativeSection;
  paymentAuthenticationArgument: NarrativeSection;
  fulfillmentArgument: NarrativeSection;
  communicationArgument: NarrativeSection;
  policyArgument: NarrativeSection;
  manualEvidenceArgument: NarrativeSection;
  conclusion: NarrativeSection;
  omittedSections: OmittedSection[];
  /** Free-text warnings from the model — informational; validation may
   *  promote them to errors. */
  warnings: string[];
}

// ── Validation ───────────────────────────────────────────────────────

export type ValidationErrorRule =
  | "forbidden_phrase"
  | "unsupported_claim"
  | "unknown_fact_id"
  | "omitted_section_inconsistent"
  | "narrow_mode_aggressive_conclusion"
  | "internal_only_fact_referenced"
  | "missing_required_section";

export interface ValidationError {
  section: NarrativeSectionKey | "global";
  rule: ValidationErrorRule;
  message: string;
  /** Substring that triggered the failure, when applicable. */
  evidenceText?: string;
  /** Fact predicate that was required but absent, when applicable. */
  requiredFact?: string;
  /** Fact ids we actually checked against (for forensic traceability). */
  checkedFactIds?: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

// ── Claim guards ─────────────────────────────────────────────────────

/** A guard that fires when the narrative contains `pattern` and the
 *  approvedFacts don't satisfy `predicate`. */
export interface ClaimGuard {
  id: string;
  /** What the guard is checking for. */
  description: string;
  /** Match against narrative section text. */
  pattern: RegExp;
  /** Sections this guard applies to. Empty = all sections. */
  appliesToSections: NarrativeSectionKey[] | "all";
  /** Returns true when approvedFacts satisfy the claim. */
  predicate: (approvedFacts: EvidenceFact[]) => boolean;
  /** Human-readable predicate text for error messages and admin display. */
  requiredFact: string;
}

export interface GuardFailure {
  guardId: string;
  section: NarrativeSectionKey;
  matchedText: string;
  requiredFact: string;
  checkedFactIds: string[];
}

// ── Evidence Basis row ───────────────────────────────────────────────

export interface EvidenceBasisRow {
  factId: string;
  category: EvidenceFactCategory;
  label: string;
  /** Terse value rendered next to the label (e.g. "MATCH", "Sent 2026-05-12"). */
  value: string;
}

// ── Run telemetry ────────────────────────────────────────────────────

export interface DefencePackageRun {
  id: string;
  packageId: string | null;
  shopId: string | null;
  promptVersion: number | null;
  model: string | null;
  packageMode: PackageMode | null;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number | null;
  validationStatus: "ok" | "failed" | "skipped" | "error" | null;
  dailyBucket: string;
  createdAt: string;
}
