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
  /** Phase 2: evaluations of every fact predicate against the approved
   *  facts. Consumed by strategy ranking (Phase 3) and templated thesis
   *  tokens (Phase 4). Always populated; predicates that don't apply
   *  evaluate to false. */
  predicateEvaluations: Record<FactPredicateId, boolean>;
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

// ── Reason-code family (Layer 1, ABOVE modules) ─────────────────────
//
// Families group modules into cross-cutting evidence-strategy clusters.
// One family per module today (1:1); families carry an overlay prompt
// that may be empty in Phase 1 and fills in as cross-module rules
// emerge. Strategy submodules (Phase 3+) live below families and gate
// on fact predicates.

export type ReasonCodeFamilyKey =
  | "unauthorized_fraud"
  | "item_not_received"
  | "product_not_as_described"
  | "credit_not_processed"
  | "duplicate_processing"
  | "cancelled_recurring"
  | "processing_error"
  | "authorization_error"
  | "fallback";

export interface ReasonCodeFamily {
  key: ReasonCodeFamilyKey;
  displayName: string;
  /** Modules that belong to this family. May be empty (e.g. processing_error
   *  has no dedicated module yet — codes in this family route to
   *  fallbackModuleKey until one is written). */
  moduleKeys: ReasonCodeModuleKey[];
  /** Network reason codes that belong to this family but have no dedicated
   *  module yet. Routed through fallbackModuleKey. */
  unmodeledCodes: string[];
  /** Explicit route for unmodeledCodes — resolveReasonCodeModule never
   *  returns null for any code that resolves to a family. */
  fallbackModuleKey: ReasonCodeModuleKey;
  /** Cached as its own system block when non-empty. Phase 1 ships these
   *  empty; they fill in as cross-module guidance emerges. */
  overlayPromptBody: string;
  /** Categories the family-wide overlay refuses to cite. Phase 1: empty;
   *  reserve for cross-module avoidance rules. */
  familyAvoid: EvidenceFactCategory[];
  /** Hard-prohibited bank-framing phrases. The validator rejects any
   *  match in bank-facing prose for modules routed to this family, in
   *  all contexts. Use for words the merchant should never echo from
   *  the network's reason-code rubric (e.g. "card absent", "other
   *  fraud", "friendly fraud"). v2.2+. */
  prohibitedBankPhrases: readonly RegExp[];
  /** Predicate-gated phrases. Each entry's `pattern` is rejected only
   *  when the `requires` predicate evaluates `false` against
   *  `approvedFacts`. Use for words that are neutral descriptors when
   *  the supporting facts are on record but become bank-framing
   *  substitution when they aren't (e.g. "online transaction",
   *  "ecommerce transaction" gated by an on-record channel signal).
   *  v2.2+. */
  guardedBankPhrases: readonly { pattern: RegExp; requires: FactPredicateId }[];
  version: number;
}

export interface ReasonCodeGuidance {
  key: ReasonCodeModuleKey;
  /** Bank-facing network reference label — the rule-book identifier of
   *  the reason code (e.g. "Visa 10.4 / Mastercard 4837"). Appears in
   *  the PDF's Case Details metadata row. Never used as a merchant
   *  argument. v2.2+ removed product/claim nouns from this string;
   *  merchant-facing wording lives in `claimType` instead. */
  displayName: string;
  /** Merchant-facing claim category label (e.g. "Unauthorized
   *  transaction claim"). What the cardholder is alleging, in the
   *  merchant's own words. Appears in the PDF cover composite line
   *  and as a dedicated Case Details row. Distinct from
   *  `displayName`, which is the bank's reference label. v2.2+. */
  claimType: string;
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
  /** Phase 1 family overlay (cross-cutting reminders, e.g. "the reason
   *  code is the bank's claim, not a fact"). Emitted as a separate
   *  cached system block ONLY when non-empty — keeps the prompt-cache
   *  prefix stable when overlays are still empty in early phases. */
  familyOverlay?: string | null;
  /** Payment-method overlay (BNPL: Klarna, Affirm, other local methods).
   *  Cross-cutting guidance layered on top of the reason module when the
   *  dispute was NOT paid by card: frame to a BNPL/local dispute, lean on
   *  delivery/refund proof, and NEVER cite card-network artifacts (AVS,
   *  CVV, 3-D Secure, CE 3.0, FPT, cardholder authentication, issuer
   *  fraud score, card-network liability shift, representment). Emitted
   *  as a separate cached system block only when non-empty. See
   *  lib/defence/paymentOverlays.ts. */
  paymentOverlay?: string | null;
  /** Phase 3 strategy bundle (selected via predicate gates). Emitted as
   *  a separate cached system block when non-empty; promptBodys are
   *  joined in family-canonical order. */
  strategies?: StrategySubmodule[];
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

// ── Strategy submodules (Phase 3+) ───────────────────────────────────
//
// Strategies live BELOW families. A family's `rankStrategies()` selects
// 1–3 candidates based on predicate gates over approvedFacts, and their
// concatenated promptBodys form the 4th cached system block.

export type StrategySubmoduleKey = string;

export interface StrategySubmodule {
  key: StrategySubmoduleKey;
  familyKey: ReasonCodeFamilyKey;
  displayName: string;
  /** Predicate gates. A strategy is eligible when:
   *    - every id in `all` evaluates true (default: empty list passes)
   *    - at least one id in `any` evaluates true (default: empty list passes)
   *    - every id in `none` evaluates false (default: empty list passes)
   *  isFallback: true strategies bypass the gate entirely. */
  predicates: {
    all?: FactPredicateId[];
    any?: FactPredicateId[];
    none?: FactPredicateId[];
  };
  isFallback: boolean;
  /** Tiebreaker within a family. Family-canonical order (the order
   *  strategies are declared in lib/defence/strategies/<family>.ts)
   *  wins; priority only matters when two strategies share canonical
   *  position. Higher priority wins. */
  priority: number;
  promptBody: string;
  version: number;
}

// ── Fact predicates (Phase 2) ────────────────────────────────────────

export type FactPredicateId =
  | "delivery_confirmed"
  | "signature_captured"
  | "digital_access_used"
  | "digital_access_granted"
  | "service_delivered"
  | "service_completed_or_delivered"
  | "customer_received_goods_or_service"
  | "three_d_secure_present"
  | "liability_shift_present"
  | "avs_and_cvv_match"
  | "avs_or_cvv_value_present"
  | "billing_match_confirmed"
  | "prior_customer"
  | "policy_disclosed"
  | "policy_accepted"
  | "refund_processed"
  | "subscription_terms_present"
  | "customer_communication_on_record"
  | "is_card_absent_dispute"
  | "fulfilment_status_fulfilled"
  | "fulfilment_status_unfulfilled"
  | "safe_to_claim_fulfilment"
  | "duplicate_distinct_markers"
  | "order_record_present"
  | "transaction_channel_online_present";

export interface FactPredicate {
  id: FactPredicateId;
  description: string;
  evaluate: (facts: EvidenceFact[]) => boolean;
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
  /** Phase 1.5+: which layer of the composed document produced the
   *  failure. Pre-Phase-1.5 narrative-only validation reports
   *  "narrative"; composed-document failures tag the offending sub-text
   *  ("thesis" | "llm" | "fallback") so failure_reason can route
   *  human attention to the right place. */
  layer?: "narrative" | "thesis" | "llm" | "fallback";
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
  /** Phase 2: the named predicate that backs this guard. The guard's
   *  `predicate` lambda is a thin reference to
   *  FACT_PREDICATES[predicateId].evaluate. Strategy gates (Phase 3)
   *  and thesis tokens (Phase 4) consume predicates by id, so the
   *  same evidence check is enforced everywhere. */
  predicateId: FactPredicateId;
  /** Returns true when approvedFacts satisfy the claim. Identical to
   *  FACT_PREDICATES[predicateId].evaluate — duplicated here for
   *  call-site convenience. */
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

// ── Templated thesis (Phase 4+) ──────────────────────────────────────
//
// Thesis blockquotes are no longer static strings keyed by (section ×
// module). They are templates with named tokens, each token gated on
// a fact predicate. When any required token resolves null, the entire
// thesis renders as the empty string — the renderer drops the
// blockquote rather than leak an unsupported claim.

export type ThesisTokenName = string;

export interface ThesisToken {
  name: ThesisTokenName;
  description: string;
  /** When set, the token may ONLY resolve when this predicate is true.
   *  null = the token always resolves from facts without a guard. */
  predicateId: FactPredicateId | null;
  /** Pure function over approvedFacts. Internal-only facts are never
   *  passed in — extractors physically cannot see them. */
  extract: (facts: EvidenceFact[]) => string | null;
}

export interface ThesisTemplate {
  key: string;
  sectionKey: NarrativeSectionKey;
  /** When familyKey="any", the template applies to any family; when set
   *  to a specific family key, it only matches that family. Fallback
   *  chain: (section, family, mode) → (section, family, "any") →
   *  (section, "any", "any"). */
  familyKey: ReasonCodeFamilyKey | "any";
  packageMode: PackageMode | "any";
  /** Grammar:
   *    - `{{tokenName}}` is substituted from `token.extract`.
   *    - `[[ … {{token}} … ]]` is an optional clause. If ANY token
   *      inside it resolves null, the WHOLE clause is stripped from
   *      the output. Plain text outside `[[…]]` is always rendered IF
   *      all `requiredTokens` resolve.
   *    - If any `requiredTokens` resolves null, the template returns "".
   *      ([[…]] clauses only contain optional tokens by definition.)
   */
  template: string;
  requiredTokens: ThesisTokenName[];
  optionalTokens: ThesisTokenName[];
}

// ── Composed document blocks (Phase 1.5+) ────────────────────────────
//
// The unit that validateComposedDocument operates on. Each block is the
// full prose contribution for one section: an optional thesis blockquote,
// the LLM-authored body, and an optional fallback paragraph (used when
// the LLM correctly refused to overclaim but a deterministic safe
// sentence is still appropriate, e.g. FulfillmentFallback).
//
// Validation runs the SAME forbidden-phrase + claim-guard machinery on
// each sub-text independently, tagging failures with the originating
// layer. Phase 4's templated thesis writes thesisText from approved
// facts; Phase 1.5 just synthesises blocks from what the current
// renderer already emits, to land the safety contract before the
// rewrite.

export interface ComposedDocumentBlock {
  sectionKey: NarrativeSectionKey;
  heading: string;
  thesisText: string;
  llmText: string;
  fallbackText: string;
  usedFactIds: string[];
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
