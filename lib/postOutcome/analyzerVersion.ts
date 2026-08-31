/**
 * Post-outcome analyzer versioning.
 *
 * Plan §13: a new analyzer version creates a NEW analysis; it never overwrites
 * an old one. Idempotency is `(dispute_id, analyzer_version, source_snapshot_sha256)`,
 * so the version is half of what stops a re-run from duplicating work and half
 * of what makes an old conclusion auditable after the rules move.
 *
 * BUMP `ANALYZER_VERSION` on ANY change that could alter the output for an
 * unchanged snapshot: a new or edited deterministic check, a changed
 * classification rule, a changed analysis-level gate, a new finding category, a
 * changed confidence assignment. Do NOT bump for logging, comments, or a
 * refactor that provably cannot move a result.
 *
 * Reason modules version independently (plan §20 Phase 4) so that shipping the
 * PRODUCT_NOT_RECEIVED module does not invalidate every FRAUDULENT analysis.
 */

/** Whole-pipeline analytical behaviour. See bump rules above. */
export const ANALYZER_VERSION = 1;

/**
 * Per-reason module versions. A reason absent from this map has no module yet
 * and yields `reason_specific_status = 'NOT_YET_SUPPORTED'`.
 *
 * Order of arrival is driven by where the analyzable cases actually are
 * (plan §25.3): FRAUDULENT holds 47 of 50, so it ships first. The original plan
 * named PRODUCT_UNACCEPTABLE first; prod holds exactly one such case.
 */
export const REASON_MODULE_VERSIONS: Readonly<Record<string, number>> = {
  FRAUDULENT: 1,
};

export function reasonModuleVersion(reason: string | null): number | null {
  if (!reason) return null;
  return REASON_MODULE_VERSIONS[reason] ?? null;
}

export function hasReasonModule(reason: string | null): boolean {
  return reasonModuleVersion(reason) !== null;
}
