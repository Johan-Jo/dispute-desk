/**
 * The canonical evidence model — layer 1: what evidence exists.
 *
 * No scoring policy, no thresholds, no automation decision. Those are
 * `CaseAssessment` and `CaseAutomationDecision`, each carrying its own policy
 * version, so changing `auto_save_min_score` cannot change the meaning or the
 * version of the evidence model. Plan §3.6.
 *
 * TWO LEVELS, and this is the load-bearing decision:
 *
 *   EvidenceDefinition   — what "delivery confirmation" MEANS. Static, one
 *                          per field: identity, cardinality, relevance rules,
 *                          validation, quality, citation policy, aggregation.
 *   CaseEvidenceRecord[] — the actual instances. Fulfillment A, fulfillment B,
 *                          merchant file X, Gorgias message Y.
 *
 * A `FieldEvidenceSummary` aggregates records for one-row surfaces, but it
 * keeps `records` intact and only NAMES a representative. An earlier draft of
 * this model had one item per field; that assumes a singularity the domain
 * does not have (multiple fulfillments, uploads, messages, refunds, competing
 * sources) and would have made the canonical model the fifth delivery-collapse
 * implementation — losing real evidence through aggregation, which is worse
 * than the fragmentation it replaces.
 *
 * NO PAYLOAD FIELD HERE, DELIBERATELY. Normalized, field-discriminated
 * payloads land in P2a. Carrying `Record<string, unknown>` in the meantime
 * would re-open the exact back door this model exists to close: every
 * consumer free to reinterpret raw collector JSON its own way. Until P2a, a
 * record exposes only what the definition already DERIVED from the payload —
 * validity, quality, citation eligibility — so nothing downstream can
 * re-classify.
 */

import type { I18nToken } from "@/lib/i18n/token";
import type { EvidenceFieldKey } from "./domains";
import type {
  CitationState,
  EvidenceQuality,
  RelevanceLevel,
  Validity,
} from "./vocabulary";
import type { SignalId } from "@/lib/argument/canonicalEvidence";
import type { EvidenceFactCategory } from "@/lib/defence/types";
import type { WaivedItemRecord } from "@/lib/types/evidenceItem";
import type { EvidencePayload } from "./payloads";

/* ── Identity ────────────────────────────────────────────────────────── */

/**
 * Stable across rebuilds, derived from source identity — never positional.
 * Today `EvidenceFact.id` is `f${index}` assigned by iteration order
 * (`factClassifier.ts:593`), so the same fact changes id on every rebuild and
 * nothing downstream can reference it. Shape: `${fieldKey}#${sourceKey}`.
 */
export type EvidenceRecordId = string;

/** Where a record physically came from. */
export type EvidenceOrigin =
  | "shopify_order"
  | "shopify_fulfillment"
  | "carrier_api"
  | "gateway_receipt"
  | "shopify_policy"
  | "merchant_upload"
  | "merchant_text"
  | "gorgias"
  | "ipinfo";

export interface EvidenceProvenance {
  origin: EvidenceOrigin;
  /** Shopify GID, Gorgias message id, storage path — whatever identifies it upstream. */
  sourceSystemId: string | null;
  /** `evidence_items.id`. The real DB join, absent from EvidenceFact today. */
  evidenceItemId: string | null;
  collectedAt: string | null;
  /**
   * Competing sources for the same underlying thing — the carrier API and
   * Shopify's native fulfillment status can disagree about one parcel. The
   * superseded record is RETAINED so the disagreement stays inspectable
   * instead of being a coin flip between four collapse implementations.
   */
  supersedes: EvidenceRecordId | null;
}

/* ── Definition ──────────────────────────────────────────────────────── */

export interface AggregationRule {
  representative: "best_quality" | "most_recent" | "first_valid";
  qualityRollup: "best" | "worst";
  /**
   * Declared sibling relation. `delivery_proof.collapsesWith =
   * "shipping_tracking"` replaces four hand-written collapses
   * (`evidenceLineItem.collapseDeliveryRows`,
   * `evidenceBasisRows.collapseDeliveryPair`, `OverviewTab`'s signal dedup,
   * `EvidenceUsedSection`'s surviving-field logic).
   */
  collapsesWith?: EvidenceFieldKey;
}

export interface EvidenceDefinition {
  fieldKey: EvidenceFieldKey;
  /** Whether one dispute can hold more than one record of this field. */
  cardinality: "single" | "multiple";
  /** Scoring dedup group. */
  signalId: SignalId;
  /** Bank-argument grouping. */
  factCategory: EvidenceFactCategory;
  labelToken: I18nToken;
  /** Whether a merchant can supply this at all. `false` ⇒ never nag for it. */
  merchantSuppliable: boolean;
  /**
   * `never` — structurally never bank-facing (device/session telemetry).
   * `conditional` — the collector or a payload gate decides per record
   *   (`ip_location_check` needs a clean match; `fraud_risk_screening` needs
   *   Shopify's own LOW/ACCEPT verdict; `tds_authentication` needs a real
   *   liability shift).
   * `when_valid` — citable whenever the record is valid.
   */
  citationPolicy: "never" | "conditional" | "when_valid";
  aggregation: AggregationRule;
  /**
   * Relevance for a dispute reason. Owned by the reason template and ONLY
   * this — relevance may never decide whether a record exists. Authority
   * rule R3; violating it is the #352552 defect.
   */
  relevance(reason: string | null | undefined): RelevanceLevel;
}

/* ── Record ──────────────────────────────────────────────────────────── */

export interface CaseEvidenceRecord {
  recordId: EvidenceRecordId;
  fieldKey: EvidenceFieldKey;
  provenance: EvidenceProvenance;
  validity: Validity;
  /**
   * Meaningful only when `validity.state === "valid"`.
   *
   * P2a note: quality is derived from the SECTION payload, so the two records
   * of a two-parcel shipment currently share a grade. Per-instance grading
   * changes what a case scores, and `categorizeEvidenceField` is the declared
   * authority (R2) for that judgement — inventing a per-instance rule here
   * would be choosing scoring policy inside a refactor. It belongs to P2b,
   * with its transition matrix.
   */
  quality: EvidenceQuality | null;
  citation: CitationState;
  /**
   * Normalized, field-discriminated. Consumers read this instead of raw
   * collector JSON, which is what stops them re-deriving their own answers.
   * `null` only when the raw payload was absent entirely.
   */
  payload: EvidencePayload | null;
}

/* ── Field-level aggregation ─────────────────────────────────────────── */

/**
 * FIVE SEPARATE CONCEPTS. `waived` never implies `available`.
 *
 * Waiving missing evidence means its absence no longer blocks completion; it
 * does not conjure the evidence. Folding them together is how a merchant
 * surface ends up saying "Delivery evidence available" about a dispute where
 * the merchant just dismissed the request.
 */
export interface FieldStatus {
  /**
   * Can THIS ORDER produce this field at all? False when the order has no
   * refund (`refund_record`), is unfulfilled (`delivery_proof`), or was not a
   * card payment (`avs_cvv_match`).
   *
   * A SIXTH concept, distinct from `relevance`. Relevance asks whether the
   * dispute REASON weighs the field; applicability asks whether the ORDER
   * could ever have it. Collapsing them into "missing" costs ~30 completeness
   * points, because `deriveCompletenessMetrics` excludes `unavailable` rows
   * from the denominator — found by measuring against prod, not by reading.
   */
  applicable: boolean;
  /** ≥1 record with `validity.state === "valid"`. Reads record validity ONLY. */
  available: boolean;
  required: boolean;
  waived: WaivedItemRecord | null;
  blocking: boolean;
  /** `available || (waived && !available)` — the completion predicate. */
  satisfied: boolean;
}

export interface FieldEvidenceSummary {
  fieldKey: EvidenceFieldKey;
  relevance: RelevanceLevel;
  /** ALL of them. Nothing is collapsed away. */
  records: CaseEvidenceRecord[];
  /** Chosen per `definition.aggregation`, for surfaces that show one row. */
  representativeId: EvidenceRecordId | null;
  citableIds: EvidenceRecordId[];
  status: FieldStatus;
  /** Rollup across valid records; null when nothing valid is present. */
  quality: EvidenceQuality | null;
  merchantOverride: "force_include" | "force_exclude" | null;
}

/* ── The model ───────────────────────────────────────────────────────── */

/** Non-evidence domains, carried explicitly rather than discarded. */
export interface NonEvidenceFacts {
  coverage: { state: string | null; shopifyProtectStatus: string | null } | null;
  riskSignals: Record<string, unknown> | null;
  disputeMetadata: { reason: string | null; networkReasonCode: string | null } | null;
  operational: {
    collectorErrors: unknown[];
    unregisteredFields: string[];
    /**
     * Retired collector keys seen on this case's sections — recorded, never
     * interpreted. A retired key is NOT an unregistered field (that would read
     * as an accident); it is a value a past collector wrote that must never be
     * evidence again. Reporting it here is what keeps "we stopped reading it"
     * distinguishable from "it silently vanished" (#352552).
     *
     * Operational metadata only: never merchant-facing, never bank-facing,
     * never scored, never cited. See `lib/evidence/model/retiredKeys.ts`.
     */
    retiredFields: string[];
  };
}

export interface CaseEvidenceModel {
  modelVersion: number;
  definitionRegistryVersion: number;
  disputeId: string;
  reason: string | null;
  /** Every registered evidence field, present or not. Membership carries no meaning. */
  fields: Record<EvidenceFieldKey, FieldEvidenceSummary>;
  nonEvidence: NonEvidenceFacts;
  derivedFrom: {
    packId: string | null;
    sectionsHash: string;
    evidenceItemIds: string[];
  };
}

/**
 * Bumped when the derivation changes shape. Persisted with every snapshot.
 *
 * 2 (PR-C3, 2026-08-08) — `avs_cvv_match` payloads carry the normalized
 * verification (network, normalized AVS result, authority, unmapped state,
 * scoring-match and citation state, CVV subfact) instead of two raw letters.
 * A version-1 snapshot has none of those keys; anything reading a persisted
 * model must re-derive rather than assume the new shape.
 */
export const MODEL_VERSION = 2;
