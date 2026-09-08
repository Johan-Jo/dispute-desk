/**
 * Claim assertions — the predicate set the monitor checks in production.
 *
 * Spec: docs/plans/label-fact-divergence.plan.md §7.
 *
 * §7 is explicit that a SQL-only monitor does not satisfy the requirement:
 * the check must run the real resolvers over the real facts, because what we
 * need to know is not "is a column odd" but "would a merchant be shown
 * something untrue". This module is the shared contract — the cron and the
 * render tests assert against the same predicates.
 *
 * Two categories, deliberately separate (§7):
 *
 *   DIVERGENCE — the projection contradicts the facts. Always a bug in us.
 *   STRANDED   — the projection is HONEST but the case is operationally
 *                stuck: an open deadline, no viable response, no pending
 *                recovery. Not a label bug; an operational one.
 *
 * Conflating them is how the eight prod cases stayed invisible: once the
 * labels are corrected, an honestly-displayed failed package is still a case
 * nobody can file.
 */

import { canClaimPrepared, type ArtifactObservation } from "./resolveArtifact";
import { suppressesAutomaticRecoveryPromise, type BuildAttempt } from "./resolveBuildAttempt";
import { mayPromiseAutomaticWork, type AutomationPromise } from "./resolveAvailability";

export type FindingKind = "divergence" | "stranded";

export interface Finding {
  kind: FindingKind;
  /** Stable code for dedupe (§7: dedupe by case, assertion/cause, artifact). */
  code: string;
  detail: string;
}

export interface CaseProjection {
  disputeId: string;
  artifact: ArtifactObservation;
  attempt: BuildAttempt;
  automation: AutomationPromise;
  /** What the surface would actually claim, as resolved. */
  claimsPrepared: boolean;
  claimsAutomaticRecovery: boolean;
  /** Operational context for the stranded check. */
  deadlinePassed: boolean | null;
  hasPriorTransmittedResponse: boolean;
}

/**
 * Assert a projected case. Empty array = the projection is defensible.
 *
 * Every check compares a CLAIM against the PREDICATE that licenses it —
 * never one column against another.
 */
export function assertProjection(p: CaseProjection): Finding[] {
  const findings: Finding[] = [];

  // ── Divergence ──────────────────────────────────────────────────────

  if (p.claimsPrepared && !canClaimPrepared(p.artifact)) {
    findings.push({
      kind: "divergence",
      code: "prepared_without_document",
      detail: `claims prepared but artifact=${p.artifact.state}`,
    });
  }

  if (p.claimsAutomaticRecovery && !mayPromiseAutomaticWork(p.automation)) {
    findings.push({
      kind: "divergence",
      code: "recovery_promised_without_automation",
      detail: `claims automatic recovery but automation=${p.automation.kind}`,
    });
  }

  if (p.claimsAutomaticRecovery && suppressesAutomaticRecoveryPromise(p.attempt)) {
    findings.push({
      kind: "divergence",
      code: "recovery_promised_over_blocker",
      detail: `claims automatic recovery but latest attempt=${p.attempt.state}`,
    });
  }

  // A prepared claim must never rest on an unknown. Called out separately
  // from `prepared_without_document` so an infrastructure failure is not
  // reported as a data defect.
  if (p.claimsPrepared && p.artifact.state === "unknown") {
    findings.push({
      kind: "divergence",
      code: "claim_on_unknown_read",
      detail: `claims prepared while the artifact read failed (${p.artifact.reason})`,
    });
  }

  // ── Stranded (honest, but nobody can act) ───────────────────────────

  const noViableResponse =
    p.artifact.state !== "present" &&
    (p.attempt.state === "failed" ||
      p.attempt.state === "capped" ||
      p.attempt.state === "unknown");

  if (
    noViableResponse &&
    p.deadlinePassed === false &&
    !p.hasPriorTransmittedResponse &&
    !mayPromiseAutomaticWork(p.automation)
  ) {
    findings.push({
      kind: "stranded",
      code: "open_deadline_no_viable_response",
      detail:
        `open deadline, artifact=${p.artifact.state}, attempt=${p.attempt.state}, ` +
        `automation=${p.automation.kind}, no prior response`,
    });
  }

  return findings;
}

/** §7 dedupe key: case + assertion + artifact revision. */
export function findingKey(disputeId: string, f: Finding, artifactRevision: string | null): string {
  return `${disputeId}|${f.code}|${artifactRevision ?? "no-rev"}`;
}
