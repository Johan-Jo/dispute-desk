/**
 * Dimension 5 — ARTIFACT observation.
 *
 * Spec: docs/plans/label-fact-divergence.plan.md §3.1–3.3.
 *
 * The four existing dimensions (operational lifecycle, merchant attention,
 * evidence strength, external lifecycle) reason about what DisputeDesk is
 * DOING and what the bank has SEEN. None of them can answer the one question
 * that produced seven merchant-visible falsehoods:
 *
 *     "Does a document actually exist, and is it valid?"
 *
 * `resolveLifecycle` treats `evidence_packs.status IN ('ready','save_failed')`
 * as proof of `pack_prepared`. Plan §3.2 removes that inference: a pack row's
 * status is a workflow marker, NOT evidence that a PDF was produced. In prod
 * on 2026-09-05, eight open disputes carried `status='ready'` (three at
 * completeness 97) whose newest defence package had `pdf_path IS NULL`.
 *
 * THE CENTRAL RULE — a failed read is `unknown`, never `absent`.
 * `absent` is a positive claim ("we looked, there is no document"). A dropped
 * connection must never be able to produce it, because `absent` and `present`
 * both license copy while `unknown` licenses none. Callers pass
 * `readOk: false` when the query itself failed.
 */

/** Why a document could not be resolved. Never inferred — always observed. */
export type ArtifactUnknownReason =
  | "read_failed"
  | "ambiguous_identity"
  | "uninterpretable_metadata";

/** Freshness verdict. Owned by the existing freshness rules
 *  (`selectFileablePackage` / `evaluateFreshness`) — NEVER re-derived here.
 *  Plan §3.2: "Use existing freshness and validation owners." */
export type ArtifactFreshness = "fresh" | "stale" | "unknown";

/** Document-validation verdict, from `defence_packages.validation_status`. */
export type ArtifactValidation = "passed" | "failed" | "unknown";

/** Identity of the document being described. Plan §3.1 requires artifact
 *  observations to carry identity so a claim can never be pinned to one
 *  version while the document shown is another. */
export interface ArtifactIdentity {
  packageId: string;
  version: number;
  sourcePackId: string | null;
  /** `defence_packages.content_revision` when recorded. */
  contentRevision: string | null;
}

export type ArtifactObservation =
  | { state: "unknown"; reason: ArtifactUnknownReason }
  | { state: "absent" }
  | {
      state: "present";
      identity: ArtifactIdentity;
      freshness: ArtifactFreshness;
      validation: ArtifactValidation;
      /** e.g. `validation_failed`, `composed:narrative global`. */
      reasonCodes: readonly string[];
    };

/** A defence-package row as observed. Every field is REQUIRED — plan §3.1
 *  forbids optional inputs that silently default to absence. */
export interface ObservedPackageRow {
  id: string;
  version: number;
  sourcePackId: string | null;
  contentRevision: string | null;
  /** `defence_packages.pdf_path`. Null means no recorded artifact. */
  pdfPath: string | null;
  /** `defence_packages.validation_status`: 'ok' | 'failed' | null. */
  validationStatus: string | null;
  failureCode: string | null;
}

export interface ResolveArtifactInput {
  /**
   * Did the read SUCCEED? `false` => `unknown/read_failed`, regardless of
   * `rows`. This is the single most important field in the contract:
   * without it an infrastructure failure renders as "no document".
   */
  readOk: boolean;
  /** Candidate rows for the working document, newest-first. Empty array with
   *  `readOk: true` is a genuine, positive "no package". */
  rows: readonly ObservedPackageRow[];
  /** Freshness verdict from the existing owner for `rows[0]`. Pass
   *  `"unknown"` when the owner could not be consulted — never guess. */
  freshness: ArtifactFreshness;
}

function validationOf(row: ObservedPackageRow): ArtifactValidation {
  if (row.validationStatus === "ok") return "passed";
  if (row.validationStatus === "failed") return "failed";
  return "unknown";
}

/**
 * Resolve the working document. Independent of the latest build attempt and
 * of any prior provider response (plan §3.4) — a failed rebuild must not
 * erase an earlier saved response, and a fresh draft is not a submission.
 */
export function resolveArtifact(input: ResolveArtifactInput): ArtifactObservation {
  // 1. A failed read is unknown. Checked FIRST so no later branch can
  //    convert an infrastructure failure into a positive claim.
  if (!input.readOk) return { state: "unknown", reason: "read_failed" };

  // 2. Successful, empty read is a genuine absence.
  if (input.rows.length === 0) return { state: "absent" };

  // 3. Ambiguous identity: two rows sharing the top version number means we
  //    cannot say WHICH document a claim would describe. Plan §3.4 forbids
  //    picking one arbitrarily.
  const top = input.rows[0];
  if (input.rows.filter((r) => r.version === top.version).length > 1) {
    return { state: "unknown", reason: "ambiguous_identity" };
  }

  // 4. Metadata we cannot interpret is unknown, not absent.
  if (!Number.isFinite(top.version) || top.id.length === 0) {
    return { state: "unknown", reason: "uninterpretable_metadata" };
  }

  // 5. No recorded PDF reference => no working document. This is the check
  //    the eight prod cases needed: `pack.status='ready'` with a null
  //    `pdf_path` is ABSENT, whatever the pack row claims.
  if (top.pdfPath === null || top.pdfPath === "") return { state: "absent" };

  // 6. A recorded artifact. Freshness and validation ride alongside as
  //    SEPARATE verdicts — `present` asserts existence only, never
  //    filing eligibility (plan §3.2).
  return {
    state: "present",
    identity: {
      packageId: top.id,
      version: top.version,
      sourcePackId: top.sourcePackId,
      contentRevision: top.contentRevision,
    },
    freshness: input.freshness,
    validation: validationOf(top),
    reasonCodes: top.failureCode ? [top.failureCode] : [],
  };
}

/**
 * The ONLY predicate permitted to license a "package prepared" claim
 * (plan §4). Requires an identified, existing document whose validation
 * PASSED. `unknown` validation is not enough — plan §4: "Unknown facts
 * produce neutral uncertainty, never a positive readiness claim."
 *
 * Deliberately says nothing about filing eligibility. A prepared document
 * can still be refused by the filing gate on freshness, coverage or safety;
 * that gate remains the sole owner of that decision.
 */
export function canClaimPrepared(observation: ArtifactObservation): boolean {
  return observation.state === "present" && observation.validation === "passed";
}
