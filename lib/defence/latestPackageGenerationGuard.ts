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
}

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
}

const ALLOWED: GenerationGuardVerdict = {
  blocked: false,
  reason: null,
  blockingVersion: null,
  blockingPackageId: null,
  failureCode: null,
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

  if (status === BLOCKING_STATUS) {
    return { blocked: true, reason: "latest_package_failed", ...base };
  }
  /* The validator's own verdict, read even when `status` disagrees. A row that
   * says `validation_status = 'failed'` while its status says otherwise is a
   * half-written failure, and resuming generation over it would be acting on
   * the half that happens to be convenient. */
  if (validation === "failed") {
    return { blocked: true, reason: "latest_package_validation_failed", ...base };
  }

  return ALLOWED;
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
