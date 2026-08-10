/**
 * `CaseAssessmentSnapshot` — the persisted, versioned form of layer 2.
 *
 * Agent A owns the derivation. This file owns only the SHAPE that agents B and
 * C may depend on, so their work can start before the derivation exists.
 *
 * RELATIONSHIP TO `lib/evidence/model/assessment.ts`. That module already
 * derives a `CaseAssessment` in-process. The snapshot is its persisted form
 * plus freshness. Agent A may reshape the internals of the derivation freely;
 * this shape moves only through a coordinator contract revision.
 *
 * STRENGTH AND COMPLETENESS ARE SEPARATE CONCEPTS AND STAY SEPARATE. They were
 * conflated across four call sites with four different gate sets, which is how
 * a "more evidence" change could silently move an auto-file decision. One
 * snapshot may carry both; nothing may derive one from the other.
 */

import type { CaseStrengthResult } from "@/lib/argument/types";
import type { I18nToken } from "@/lib/i18n/token";
import type { SubmissionReadiness } from "@/lib/types/evidenceItem";
import type { SnapshotFreshness, StalenessReason } from "./freshness";

/**
 * Completeness, as its own contract.
 *
 * `score` is the number the auto-save gate reads. Two things about it are
 * load-bearing and both are measured, not assumed:
 *
 *   1. The gate reads the PERSISTED column, it does not recompute
 *      (`pipeline.ts:804-811`). 67 of 115 prod packs carried a score the
 *      current engine no longer reproduces, so "what does the gate do today"
 *      can only be answered from persisted values.
 *   2. A NULL score is 0, not "skip" (`?? 0`), and a NULL readiness drops the
 *      gate onto the LEGACY blocker-count path (`?? undefined`). Both are
 *      pinned by test and must survive the migration.
 */
export interface CompletenessSnapshot {
  score: number;
  evidenceStrengthScore: number;
  /**
   * `null` is NOT "unknown" — it is the LEGACY GATE ARM, and it is
   * representable on purpose (revision 1, Agent A's friction 1).
   *
   * Production reads `pack.submission_readiness ?? undefined`, and an absent
   * readiness selects a *different arm* of `evaluateAutoSaveGate`: the legacy
   * blocker-count path rather than the readiness path. The first cut of this
   * shape made `readiness` non-optional, which made that arm unrepresentable
   * and forced a parallel type next to the contract — exactly the divergence
   * the contract exists to prevent. So the third state lives here, named.
   */
  readiness: SubmissionReadiness | null;
  blockers: string[];
}

/**
 * Which gate already decided the case, when one has.
 *
 * NOT a boolean (revision 1, Agent C's friction 1). Coverage and fatal-loss are
 * not interchangeable: coverage BEATS fatal-loss, they produce different reason
 * codes, and the fatal-loss reason must never reach bank-facing text while a
 * coverage status may be shown to the merchant. A boolean collapses a
 * distinction that has to survive all the way to the issuer boundary.
 */
export type GateDecision = "coverage" | "fatal_loss" | null;

export interface CaseAssessmentSnapshot {
  caseId: string;
  /** Bumped when the SHAPE changes. Distinct from `freshness.policyVersion`. */
  assessmentVersion: number;
  strength: CaseStrengthResult;
  completeness: CompletenessSnapshot;
  /**
   * Which gate decided the case, if either did. Carried so downstream layers
   * read one typed value instead of re-deriving two gates. Coverage beats
   * fatal-loss; neither is ever widened here (`COVERED_STATUSES` stays exactly
   * `{PROTECTED, ACTIVE}`).
   */
  gateDecision: GateDecision;
  /**
   * How many `review_required` items the case still carries (revision 1, Agent
   * C's friction 2).
   *
   * `review_required_present` is an `AutomationReasonCode`, but automation may
   * not import argument-plan internals and `MerchantReviewItem` lives on a
   * merchant projection — so without this the automation layer could name the
   * state and not observe it. A count, not the items: automation needs to know
   * *whether*, never *what*.
   */
  reviewRequiredCount: number;
  /**
   * The evidence-model version this assessment was derived from. Distinct from
   * `freshness.policyVersion` (the scoring policy). Both are needed: a reader of
   * a persisted row must be able to say which model produced it without
   * re-deriving (revision 1, Agent A's friction 5).
   */
  modelVersion: number;
  freshness: SnapshotFreshness;
}

/**
 * What a merchant surface is allowed to receive.
 *
 * Deliberately NOT the full snapshot: the three tabs must not be able to
 * reconstruct readiness or re-band strength, because that is precisely what
 * they do today and what the migration deletes. A projection may filter, sort
 * and summarise; it may never reclassify.
 *
 * `needsRecalculation` is a first-class state, not a null. A stale number
 * rendered as current is worse than no number: the merchant acts on it.
 */
export interface MerchantAssessmentProjection {
  caseId: string;
  needsRecalculation: boolean;
  /**
   * WHY it needs recalculating, null when it does not (revision 1, Agent A's
   * friction 2). `evaluateFreshness` already distinguishes three reasons and
   * they route differently in the UI — "never computed" asks the merchant to
   * wait, "inputs changed" asks them to rebuild. Collapsing them into the
   * boolean above threw that away one layer after computing it.
   */
  recalculationReason: StalenessReason | null;
  /** Null exactly when `needsRecalculation` is true. */
  strengthBand: CaseStrengthResult["overall"] | null;
  completenessScore: number | null;
  readiness: SubmissionReadiness | null;
  reviewItems: MerchantReviewItem[];
}

/**
 * One `review_required` item, as the merchant sees it.
 *
 * `reasonToken` is an I18nToken key, never English — `lib/**` may not emit
 * resolved copy, and the leaf renderer takes the branded `Localized` type so a
 * raw literal cannot satisfy the prop.
 *
 * `blocksNormalFiling` is the honest statement of consequence: while any review
 * item remains, the package is `deadline_only`. The merchant is told that in
 * words (plan §4.1) rather than left to infer it from a badge.
 */
export interface MerchantReviewItem {
  recordId: string;
  fieldKey: string;
  /**
   * `I18nToken`, not a bare key string (revision 1, Agent A's friction 3).
   * Every other merchant-facing token in `lib/**` is an `I18nToken`, and a bare
   * string cannot carry params — so the first reason that needs a count or a
   * field label would have forced English into `lib/` or a second token shape.
   */
  reasonToken: I18nToken;
  blocksNormalFiling: boolean;
}
