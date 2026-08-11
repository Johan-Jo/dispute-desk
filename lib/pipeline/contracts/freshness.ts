/**
 * Snapshot freshness — the one shape every canonical layer carries.
 *
 * WHY IT IS SHARED. Assessment, argument plan and automation decision are
 * computed at different moments by different writers. Without one freshness
 * shape each layer would invent its own "is this still current" rule, which is
 * the fragmentation this pipeline exists to end — and a stale package that
 * *looks* current is the one failure mode that can put a false assertion in
 * front of an issuer.
 *
 * THREE FIELDS, AND WHAT EACH IS FOR.
 *
 *   inputHash    — everything result-bearing that went in. Changing any input
 *                  that can change the result MUST change this. It is the only
 *                  staleness signal; a timestamp is not one.
 *   policyVersion— the rules applied. A policy bump invalidates snapshots even
 *                  when inputs are identical.
 *   computedAt   — audit and diagnostics ONLY. Never a staleness input. See
 *                  the time-invariance rule in `automationDecision.ts`.
 *
 * R4 WARNING (`docs/evidence-model/p4/legacy-removal-inventory.md`).
 * `EvidenceFact.id` is positional and `computeEvidenceHash` sorts on it, so a
 * record-id migration changes every hash once, fleet-wide. The kickoff
 * decision handles that by scope — current open, unsubmitted cases are rebuilt
 * before wave two; legacy packages are NOT grandfathered and are expected to go
 * stale and non-fileable. Do not add a grandfathering escape hatch here.
 */

/** Opaque by construction. Never parse it, never order by it, never compare parts. */
export type InputHash = string;

export interface SnapshotFreshness {
  /** Hash over every result-bearing input. The only staleness signal. */
  inputHash: InputHash;
  /** Version of the rules applied when this snapshot was computed. */
  policyVersion: number;
  /** ISO-8601. Audit only — never an input to freshness. */
  computedAt: string;
}

export type StalenessReason =
  | "input_hash_mismatch"
  | "policy_version_superseded"
  | "snapshot_absent";

export type FreshnessVerdict =
  | { fresh: true }
  | { fresh: false; reason: StalenessReason };

/**
 * The single freshness predicate. Every layer calls this; nobody re-implements
 * "is it current" with a date comparison.
 *
 * `snapshot` absent is a distinct answer from a hash mismatch: absent means
 * "never computed" (recalculate), mismatch means "computed against something
 * that has since changed" (rebuild). Both block filing; they route differently
 * in the UI, so they must not collapse into one boolean.
 */
export function evaluateFreshness(args: {
  snapshot: SnapshotFreshness | null | undefined;
  currentInputHash: InputHash;
  currentPolicyVersion: number;
}): FreshnessVerdict {
  const { snapshot, currentInputHash, currentPolicyVersion } = args;
  if (!snapshot) return { fresh: false, reason: "snapshot_absent" };
  if (snapshot.policyVersion !== currentPolicyVersion) {
    return { fresh: false, reason: "policy_version_superseded" };
  }
  if (snapshot.inputHash !== currentInputHash) {
    return { fresh: false, reason: "input_hash_mismatch" };
  }
  return { fresh: true };
}
