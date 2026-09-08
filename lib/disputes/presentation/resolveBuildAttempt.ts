/**
 * Dimension 6 — LATEST BUILD ATTEMPT.
 *
 * Spec: docs/plans/label-fact-divergence.plan.md §3.3.
 *
 * Separate from `resolveArtifact` (does a document exist?) and from the
 * external lifecycle (what has the bank seen?). This dimension answers only:
 * "what happened on the most recent attempt to build a defence package?"
 *
 * Keeping it separate is what lets a case show BOTH a prior transmitted
 * response AND a newer failed rebuild without either erasing the other
 * (plan §3.4) — the shape of the six blume-box cases where a v4 was filed
 * and a v5 build later failed.
 *
 * The resolution ORDER is normative. `capped` must be tested before generic
 * failure because `daily_cap_reached` is persisted as `status='failed'`; a
 * naive check reports "build failed" for a case that merely hit a budget and
 * will build fine tomorrow (`[[project_llm_cap_defence_package_incident]]`).
 */

import type {
  DefencePackageFailureCode,
  DefencePackageStatus,
  DefencePackageValidationStatus,
} from "@/lib/defence/types";

export type BuildAttemptState =
  | "unknown"
  | "none"
  | "queued"
  | "running"
  | "succeeded"
  | "declined"
  | "not_required"
  | "capped"
  | "failed";

export type BuildAttemptUnknownReason =
  | "read_failed"
  | "incomplete_attempt"
  | "ambiguous_identity";

export interface BuildAttemptIdentity {
  packageId: string | null;
  version: number | null;
  jobId: string | null;
}

export interface BuildAttempt {
  state: BuildAttemptState;
  identity: BuildAttemptIdentity;
  /** Machine-readable cause. For `failed` this is the failure code; for
   *  `declined` / `not_required` the skip cause; for `unknown` the reason. */
  cause: string | null;
  /** True when the cause string was not one this resolver recognises.
   *  Plan §3.3: an unrecognised skip cause must produce a NEUTRAL
   *  explanation — never an asserted coverage or no-argument claim. */
  causeRecognised: boolean;
}

/** An observed `defence_packages` row, newest first. */
export interface ObservedAttemptRow {
  id: string;
  version: number;
  status: DefencePackageStatus;
  validationStatus: DefencePackageValidationStatus | null;
  failureCode: DefencePackageFailureCode | string | null;
  /** True when the row has a recorded PDF and passing validation. */
  hasValidatedArtifact: boolean;
}

/** An observed active job for this dispute, if any. */
export interface ObservedActiveJob {
  id: string;
  /** `jobs.status` — only 'queued' / 'running' are active. */
  status: string;
}

export interface ResolveBuildAttemptInput {
  /** Did the package read succeed? `false` => unknown/read_failed. */
  readOk: boolean;
  /** Did the JOB read succeed? A failed job read cannot prove "no worker
   *  is running", so it must not license an `unknown/incomplete_attempt`
   *  verdict derived from job absence. */
  jobReadOk: boolean;
  rows: readonly ObservedAttemptRow[];
  /** Active job newer than `rows[0]`, when one was observed. A draft row
   *  alone does NOT prove a worker is running (plan §3.3). */
  activeJob: ObservedActiveJob | null;
}

const SKIP_CAUSE_COVERED = "covered_shopify";
const SKIP_CAUSE_NO_FACTS = "no_bank_eligible_facts";

function identityOf(row: ObservedAttemptRow | null, jobId: string | null): BuildAttemptIdentity {
  return { packageId: row?.id ?? null, version: row?.version ?? null, jobId };
}

export function resolveBuildAttempt(input: ResolveBuildAttemptInput): BuildAttempt {
  const none = (state: BuildAttemptState, cause: string | null, recognised = true): BuildAttempt => ({
    state,
    identity: identityOf(null, null),
    cause,
    causeRecognised: recognised,
  });

  // 1. A failed read is unknown for this dimension. Never "none".
  if (!input.readOk) return none("unknown", "read_failed");

  const top = input.rows[0] ?? null;

  // 2. A verified active job outranks a settled row: work is in flight.
  //    Requires a SUCCESSFUL job read — an unread job list proves nothing.
  if (input.jobReadOk && input.activeJob) {
    const s = input.activeJob.status;
    if (s === "running") {
      return { state: "running", identity: identityOf(top, input.activeJob.id), cause: null, causeRecognised: true };
    }
    if (s === "queued") {
      return { state: "queued", identity: identityOf(top, input.activeJob.id), cause: null, causeRecognised: true };
    }
  }

  // 3. Successful, empty read => genuinely no attempt yet.
  if (top === null) return none("none", null);

  // 4. Ambiguous identity: two rows share the newest version.
  if (input.rows.filter((r) => r.version === top.version).length > 1) {
    return { state: "unknown", identity: identityOf(null, null), cause: "ambiguous_identity", causeRecognised: true };
  }

  const id = identityOf(top, null);

  // 5. CAP BEFORE GENERIC FAILURE. `daily_cap_reached` is stored as
  //    status='failed'; testing failure first would mislabel a budget stop
  //    as a build defect, and historical cap does not prove today's budget
  //    is exhausted.
  if (top.failureCode === "daily_cap_reached") {
    return { state: "capped", identity: id, cause: "daily_cap_reached", causeRecognised: true };
  }

  // 6. Explicit failure — including llm_error and pdf_render_failed.
  //    Contradictory records must never produce success.
  if (top.status === "failed" || top.validationStatus === "failed") {
    return {
      state: "failed",
      identity: id,
      cause: (top.failureCode as string | null) ?? "unspecified_failure",
      causeRecognised: top.failureCode != null,
    };
  }

  // 7. Skips carry OPPOSITE merchant meanings and must not be conflated:
  //    covered => we need not argue; no-eligible-facts => we found no
  //    argument for that snapshot.
  if (top.status === "skipped") {
    if (top.failureCode === SKIP_CAUSE_COVERED) {
      return { state: "not_required", identity: id, cause: SKIP_CAUSE_COVERED, causeRecognised: true };
    }
    if (top.failureCode === SKIP_CAUSE_NO_FACTS) {
      return { state: "declined", identity: id, cause: SKIP_CAUSE_NO_FACTS, causeRecognised: true };
    }
    // Unrecognised skip cause: neutral, and flagged as unrecognised so copy
    // cannot assert coverage or absence of arguments.
    return {
      state: "not_required",
      identity: id,
      cause: (top.failureCode as string | null) ?? "unspecified_skip",
      causeRecognised: false,
    };
  }

  // 8. Success requires a COMPLETED, VALIDATED artifact — not merely a
  //    terminal-looking status.
  if (top.hasValidatedArtifact) {
    return { state: "succeeded", identity: id, cause: null, causeRecognised: true };
  }

  // 9. An incomplete draft with no verified active job is UNKNOWN, not a
  //    perpetual "building…" spinner. This is the state that produced the
  //    endless-processing complaints.
  return { state: "unknown", identity: id, cause: "incomplete_attempt", causeRecognised: true };
}

/** States that may license "DisputeDesk is working on it" copy. */
export function isInFlight(a: BuildAttempt): boolean {
  return a.state === "queued" || a.state === "running";
}

/** Plan §4: a blocker or failure suppresses blanket recovery promises. */
export function suppressesAutomaticRecoveryPromise(a: BuildAttempt): boolean {
  return a.state === "failed" || a.state === "capped" || a.state === "declined" || a.state === "unknown";
}
