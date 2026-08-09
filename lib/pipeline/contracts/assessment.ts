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
import type { SubmissionReadiness } from "@/lib/types/evidenceItem";
import type { SnapshotFreshness } from "./freshness";

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
  readiness: SubmissionReadiness;
  blockers: string[];
}

export interface CaseAssessmentSnapshot {
  caseId: string;
  /** Bumped when the SHAPE changes. Distinct from `freshness.policyVersion`. */
  assessmentVersion: number;
  strength: CaseStrengthResult;
  completeness: CompletenessSnapshot;
  /**
   * True when coverage (Shopify Protect) or a fatal-loss trigger has already
   * decided the case. Carried so downstream layers read one flag instead of
   * re-deriving two gates. Coverage beats fatal-loss; neither is ever widened
   * here (`COVERED_STATUSES` stays exactly `{PROTECTED, ACTIVE}`).
   */
  gateDecided: boolean;
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
  reasonToken: string;
  blocksNormalFiling: boolean;
}
