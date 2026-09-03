/**
 * May an AUTOMATIC rebuild generate a new package for this case? ONE owner.
 *
 * ── THE INCIDENT ──────────────────────────────────────────────────────
 *
 * On 2026-08-11 a `build_pack` was enqueued for a case whose newest package
 * was `failed` / `validation_failed` — a rejection a human had not resolved.
 * `maybeEnqueueDefencePackage` has no opinion about failed rows: it skips only
 * an idempotent draft match, marks a diverging draft stale, and otherwise
 * inserts `latest.version + 1`. So it inserted v4 and enqueued a regeneration,
 * which failed the same way.
 *
 * The case had been protected by a MANUAL instruction not to touch it. The
 * instruction was followed for one batch, then a change to how the batch was
 * selected surfaced the case again and the protection did not travel with it.
 * That is the argument for this module: a rule that lives in someone's head is
 * not a guard, and the operator who needs it is the one who has forgotten it.
 *
 * ── WHAT BLOCKS ───────────────────────────────────────────────────────
 *
 * The repository has ONE terminal failure status — `failed`
 * (`DefencePackageStatus`). `validation_failed` is not a status; it is a
 * `DefencePackageFailureCode` recorded ALONGSIDE `status = "failed"`, and
 * `validation_status = "failed"` is the third column the same event writes.
 * All three describe one outcome, and this module reads the status model as it
 * is rather than inventing a parallel interpretation: any of the three saying
 * "this generation failed" blocks, because a row that disagrees with itself is
 * exactly the shape a guard must not wave through.
 *
 * ── WHAT DOES NOT BLOCK ───────────────────────────────────────────────
 *
 * No previous package, or a latest package in any non-failed state — `draft`,
 * `stale`, `final`, `submitted`, `superseded`, `skipped`. `stale` in
 * particular is the ordinary "inputs moved, rebuild me" state and must keep
 * flowing, or the pre-activation rebuild stops entirely.
 *
 * An OLDER failed version never blocks. The question is only ever about the
 * latest: a case that failed at v3 and was successfully regenerated at v4 has
 * had its rejection resolved.
 *
 * ── WHAT THIS MODULE DOES NOT DO ──────────────────────────────────────
 *
 * It does not delete, retry, rewrite or supersede anything, and it carries no
 * force flag. Clearing a human-gated rejection is a human action, and adding a
 * bypass in the same change that adds the guard would make the guard optional
 * from the day it shipped.
 */

import type { DefencePackageStatus } from "./types";

/** The only terminal failure status in `DefencePackageStatus`. */
const BLOCKING_STATUS: DefencePackageStatus = "failed";

export type GenerationBlockReason =
  /** `defence_packages.status = 'failed'`. */
  | "latest_package_failed"
  /** `validation_status = 'failed'` — the deterministic validator rejected it. */
  | "latest_package_validation_failed";

export interface LatestPackageRow {
  id?: string | null;
  version?: number | null;
  status?: string | null;
  validation_status?: string | null;
  failure_code?: string | null;
  /** The generator version that produced the failure. */
  prompt_version?: number | null;
  /** The validator version in force when it failed. NULL = pre-versioning. */
  validator_version?: number | null;
  /** The composition (thesis-template) version in force when it failed.
   *  NULL = pre-versioning. */
  composition_version?: number | null;
  /** The evidence the failure was produced from. */
  evidence_hash?: string | null;
}

/**
 * What the world looks like NOW, for comparison against the failed row.
 *
 * Passed in rather than imported so this module stays pure and the callers —
 * which have already computed the current evidence hash — do not pay for a
 * second derivation.
 */
export interface CurrentGenerationInputs {
  promptVersion: number;
  validatorVersion: number;
  /** `COMPOSITION_VERSION` — the deterministic composed-prose rules. */
  compositionVersion: number;
  /** The hash of the evidence a rebuild would run against. */
  evidenceHash: string | null;
}

/** Which input moved since the failure. Empty when nothing did. */
export type GenerationRetryBasis =
  | "prompt_version_changed"
  | "validator_version_changed"
  | "composition_version_changed"
  | "evidence_changed";

export interface GenerationGuardVerdict {
  /** True when an automatic generation must not proceed. */
  blocked: boolean;
  /** Structured, for the audit row and telemetry. Null when not blocked. */
  reason: GenerationBlockReason | null;
  /** The version that blocked, so an operator can find it without a query. */
  blockingVersion: number | null;
  blockingPackageId: string | null;
  /** The recorded failure code, when the row carries one. Never inferred. */
  failureCode: string | null;
  /**
   * Why a FAILED latest package was nonetheless allowed through. Empty when
   * the row did not fail, or when it failed and stays blocked.
   */
  retryBasis: GenerationRetryBasis[];
}

const ALLOWED: GenerationGuardVerdict = {
  blocked: false,
  reason: null,
  blockingVersion: null,
  blockingPackageId: null,
  failureCode: null,
  retryBasis: [],
};

/**
 * The single predicate. Takes the LATEST package row, or null when the case
 * has none.
 *
 * Deliberately takes a row rather than a case id: the three call sites have
 * already loaded it, and a second query here would be a second answer to
 * "which package is latest" — the class of duplication `selectFileablePackage`
 * exists to end.
 */
export function evaluateGenerationGuard(
  latest: LatestPackageRow | null | undefined,
  current?: CurrentGenerationInputs,
): GenerationGuardVerdict {
  if (!latest) return ALLOWED;

  const status = typeof latest.status === "string" ? latest.status.trim().toLowerCase() : null;
  const validation =
    typeof latest.validation_status === "string"
      ? latest.validation_status.trim().toLowerCase()
      : null;

  const failureCode = typeof latest.failure_code === "string" ? latest.failure_code : null;
  const base = {
    blockingVersion: typeof latest.version === "number" ? latest.version : null,
    blockingPackageId: typeof latest.id === "string" ? latest.id : null,
    failureCode,
  };

  const failed = status === BLOCKING_STATUS || validation === "failed";
  if (!failed) return ALLOWED;

  /* ── WOULD A REBUILD BE A NEW ATTEMPT, OR THE SAME ONE AGAIN? ────────
   *
   * The hazard this guard was built for (2026-08-11) is a REGENERATION LOOP:
   * rebuilding a failed package under the rules that failed it produces the
   * same failure, wastes an LLM call, and buries the original error under a
   * new row. That hazard is real and this still blocks it.
   *
   * What the original revision could not express is the other half: a package
   * that failed under rules WE HAVE SINCE CHANGED is not the same attempt, and
   * refusing it leaves a case dead after the defect is fixed. Measured
   * 2026-08-12, that cost `#12936` three weeks past its deadline and `#353605`
   * its deadline outright — both blocked while the fixes that would have saved
   * them shipped.
   *
   * The original comment framed the block as protecting a "human-gated
   * rejection". No such state exists in the data: all fourteen blocked rows
   * were `validation_failed`, a machine verdict, and nothing in
   * `DefencePackageStatus` records human intent. The honest predicate is about
   * CHANGE, not motive.
   *
   * Any one of three inputs moving makes this a new attempt:
   *   - the generator (`prompt_version`)
   *   - the validator (`validator_version`) — the one that mattered, since a
   *     detector fix leaves the prompt untouched
   *   - the composition rules (`composition_version`) — added 2026-09-03 for
   *     the same reason one rung down. `ecbb03aa` fixed a composed failure by
   *     editing one thesis template: no prompt, no validator, no evidence
   *     moved, so the guard read "same attempt" and all 27 cases the defect
   *     had killed stayed dead after the fix shipped, 9 past deadline. A rule
   *     the composed verdict depends on must be a rule the guard can see.
   *   - the evidence (`evidence_hash`)
   *
   * A NULL on the row means "not recorded", which is not evidence of sameness:
   * it is treated as changed, so packages built before versioning get exactly
   * one attempt under current rules. The rebuild then writes all three, and a
   * second failure with everything matching blocks — so the loop is bounded at
   * one, not reopened.
   *
   * With no `current` supplied the guard keeps its original behaviour and
   * blocks, so a caller that cannot answer the question does not get a pass.
   */
  if (current) {
    const retryBasis: GenerationRetryBasis[] = [];
    if (latest.prompt_version == null || latest.prompt_version !== current.promptVersion) {
      retryBasis.push("prompt_version_changed");
    }
    if (latest.validator_version == null || latest.validator_version !== current.validatorVersion) {
      retryBasis.push("validator_version_changed");
    }
    if (
      latest.composition_version == null ||
      latest.composition_version !== current.compositionVersion
    ) {
      retryBasis.push("composition_version_changed");
    }
    if (
      current.evidenceHash != null &&
      (latest.evidence_hash == null || latest.evidence_hash !== current.evidenceHash)
    ) {
      retryBasis.push("evidence_changed");
    }
    if (retryBasis.length > 0) {
      return { ...ALLOWED, retryBasis };
    }
  }

  if (status === BLOCKING_STATUS) {
    return { blocked: true, reason: "latest_package_failed", ...base, retryBasis: [] };
  }
  /* The validator's own verdict, read even when `status` disagrees. A row that
   * says `validation_status = 'failed'` while its status says otherwise is a
   * half-written failure, and resuming generation over it would be acting on
   * the half that happens to be convenient. */
  return { blocked: true, reason: "latest_package_validation_failed", ...base, retryBasis: [] };
}

/** The audit/telemetry payload for a blocked attempt. */
export function generationBlockPayload(
  verdict: GenerationGuardVerdict,
): Record<string, unknown> {
  return {
    skipped: true,
    skip_reason: verdict.reason,
    blocking_package_id: verdict.blockingPackageId,
    blocking_version: verdict.blockingVersion,
    failure_code: verdict.failureCode,
    /* Named so an operator reading the trail knows the resolution is theirs.
     * There is no flag here that clears it. */
    resolution: "human_action_required",
  };
}
