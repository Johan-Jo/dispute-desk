/**
 * CP-A — completeness, derived INDEPENDENTLY of strength.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────
 *
 * Nothing in this file may read a strength band, a score, a hero variant or
 * a gate verdict, and nothing that derives strength may read this module's
 * output. One `CaseAssessmentSnapshot` carries both; neither is derived from
 * the other.
 *
 * That is not tidiness. `calculateCaseStrength` had four call sites passing
 * four different gate sets, and completeness rode along in the same objects —
 * so a change made for "more evidence should score better" could move an
 * auto-file disposition, and a change to a gate could move a completeness
 * number, with no test able to say which. Separating them makes each change
 * attributable to exactly one cause.
 *
 * ── THE THREE FAITHFUL GATE DETAILS ───────────────────────────────────
 *
 * `pipeline.ts` reads the PERSISTED columns, never a recomputation, and
 * coerces three NULLs in three DIFFERENT directions. All three are load-
 * bearing and all three are already pinned by test elsewhere:
 *
 *   completeness_score  NULL → 0          (`?? 0`)
 *   blockers            NULL → []         (`?? []`)
 *   submission_readiness NULL → undefined (`?? undefined`)
 *
 * The third is the subtle one and the reason `readPersistedCompletenessForGate`
 * exists at all. `evaluateAutoSaveGate` branches on
 * `submissionReadiness !== undefined`: a present readiness means "hard-block
 * only when `blocked`", while an ABSENT readiness drops onto the LEGACY path
 * where ANY blocker count > 0 blocks. Coercing NULL to `"ready"` (the
 * obvious-looking fix) would silently auto-file every legacy pack that has
 * blockers; coercing it to `"blocked"` would freeze them all. Neither is what
 * production does, and the migration must not change it.
 *
 * CONTRACT REVISION 1 closed this. `CompletenessSnapshot.readiness` is now
 * `SubmissionReadiness | null`, and `null` IS the legacy arm — named, typed and
 * representable. The parallel `PersistedGateCompleteness` shape this file
 * carried before the revision is gone; `readPersistedCompletenessForGate`
 * returns the contract type. The `null → undefined` step now happens at the ONE
 * place it means something, the `evaluateAutoSaveGate` call itself.
 */

import type { SubmissionReadiness } from "@/lib/types/evidenceItem";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { deriveCompletenessMetrics } from "@/lib/automation/completeness";
import type { CompletenessSnapshot } from "@/lib/pipeline/contracts";
import { completenessChecklistFromModel } from "./assessment";
import type { CaseEvidenceModel } from "./types";

/**
 * Completeness from the canonical model.
 *
 * Takes a `CaseEvidenceModel` and NOTHING else — no gates, no strength, no
 * payload source, no reason family. If a future change needs one of those to
 * compute completeness, that is a signal the two concepts are being conflated
 * again, and the change belongs in a plan rather than in this signature.
 *
 * Reuses `deriveCompletenessMetrics` rather than restating the weights, on
 * the same adapter discipline as `deriveCaseAssessment`: a difference between
 * this and the persisted fleet can then only come from the ROW SET, which is
 * exactly what the calibration harness measures.
 */
export function deriveCompletenessSnapshot(
  model: CaseEvidenceModel,
): DerivedCompletenessSnapshot {
  return completenessFromChecklist(completenessChecklistFromModel(model));
}

/**
 * A completeness snapshot that was DERIVED, not read back.
 *
 * The contract's `readiness: SubmissionReadiness | null` exists for the legacy
 * PERSISTED arm — a row written before readiness existed. A derivation always
 * produces one of the four members, so narrowing it here keeps callers from
 * inventing a fallback for a state this path cannot reach. `null` stays exactly
 * where it is true: `readPersistedCompletenessForGate`.
 */
export type DerivedCompletenessSnapshot = CompletenessSnapshot & {
  readiness: SubmissionReadiness;
};

/**
 * Completeness from an already-built v2 checklist.
 *
 * Exported for the surfaces that hold a reconciled `checklist_v2` but no
 * canonical model — the manual-upload route and the workspace read path.
 * Same engine, same numbers; the only reason it is a separate entry point is
 * that those callers must not be forced to reconstruct a model they do not
 * have, because a reconstructed model is a second derivation.
 */
export function completenessFromChecklist(
  checklist: ChecklistItemV2[],
): DerivedCompletenessSnapshot {
  const metrics = deriveCompletenessMetrics(checklist);
  return {
    score: metrics.completenessScore,
    evidenceStrengthScore: metrics.evidenceStrengthScore,
    readiness: metrics.submissionReadiness,
    blockers: metrics.blockers,
  };
}

/* ── the persisted gate reader ─────────────────────────────────────── */

/** The persisted columns, as PostgREST hands them back. */
export interface PersistedPackCompletenessRow {
  completeness_score?: number | null;
  blockers?: unknown;
  submission_readiness?: string | null;
  /**
   * There is no `evidence_strength_score` COLUMN — the number is persisted
   * inside `pack_json.completeness.evidenceStrengthScore`. It is read here only
   * so the contract field is populated from the real persisted value rather
   * than fabricated; `evaluateAutoSaveGate` never consults it.
   */
  pack_json?: unknown;
}

/**
 * Turn a gate-shaped readiness back into what `evaluateAutoSaveGate` accepts.
 *
 * The contract says `null` = legacy arm; the gate spells that arm `undefined`.
 * This is the ONE conversion point, so nobody re-derives the mapping at a call
 * site and picks `"ready"` because it looks tidier.
 */
export function readinessForGate(
  readiness: SubmissionReadiness | null,
): SubmissionReadiness | undefined {
  return readiness ?? undefined;
}

function persistedEvidenceStrengthScore(packJson: unknown): number {
  const completeness = (packJson as { completeness?: unknown } | null | undefined)
    ?.completeness as { evidenceStrengthScore?: unknown } | undefined;
  const value = completeness?.evidenceStrengthScore;
  return typeof value === "number" ? value : 0;
}

/**
 * The single faithful reader. `pipeline.ts` calls THIS instead of repeating the
 * three coercions inline (Agent C owns that call site).
 *
 * Every coercion below has a comment naming what breaks if it is "cleaned
 * up", because each of the three looks like an obvious simplification and
 * none of them is.
 */
export function readPersistedCompletenessForGate(
  row: PersistedPackCompletenessRow | null | undefined,
): CompletenessSnapshot {
  return {
    // NULL → 0, never "skip". A pack with no score is maximally incomplete,
    // so it fails `score < auto_save_min_score` and parks. Treating NULL as
    // "no opinion" would auto-file every unscored pack.
    score: row?.completeness_score ?? 0,
    evidenceStrengthScore: persistedEvidenceStrengthScore(row?.pack_json),
    // NULL → []. The legacy arm counts blockers, and `undefined.length`
    // throws; an empty list means "nothing known to block".
    //
    // ONE DELIBERATE DIFFERENCE from `pipeline.ts`'s `(pack.blockers as
    // string[]) ?? []`: a non-array JSON value (an object written by some
    // older writer) is coerced to `[]` here, where the cast would pass it
    // through. The gate outcome is IDENTICAL either way — the legacy arm
    // asks `blockers.length > 0`, and `undefined > 0` is false exactly as
    // `[].length > 0` is — so this narrows a lie in the type without moving
    // a disposition. Pinned by test.
    blockers: Array.isArray(row?.blockers) ? (row?.blockers as string[]) : [],
    // NULL → null, which is the LEGACY blocker-count arm of
    // `evaluateAutoSaveGate` (spelled `undefined` at the gate boundary, via
    // `readinessForGate`). Not "ready", not "blocked". See the header.
    readiness: normalizeReadiness(row?.submission_readiness),
  };
}

/**
 * A persisted readiness string → the enum, or `null`.
 *
 * An UNRECOGNISED value also becomes `null` rather than being passed
 * through: the gate's readiness arm compares against exactly four members,
 * and an unknown fifth would silently satisfy `!== "blocked"` and clear the
 * gate. Falling back to the legacy blocker count is the conservative answer
 * and matches what production does with a NULL.
 */
function normalizeReadiness(value: unknown): SubmissionReadiness | null {
  if (
    value === "ready" ||
    value === "ready_with_warnings" ||
    value === "blocked" ||
    value === "submitted"
  ) {
    return value;
  }
  return null;
}
