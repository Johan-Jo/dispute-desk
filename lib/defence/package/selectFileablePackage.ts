/**
 * `selectFileablePackage` — the ONE answer to "what, if anything, may be filed"
 * (CP-B §4).
 *
 * WHAT IT SUBSUMES. `packageSafety` (C-11, in production since 2026-08-08) is
 * consulted today at the save job, the manual save route, the deadline cron's
 * candidate selection and the workspace readiness projection. This selector
 * REPLACES those four call sites; it does not sit beside them. The measured
 * behaviour that must survive: **212 of 280 package versions blocked**, matching
 * the pre-release census exactly. A different count on the same population is a
 * defect until explained — so the content verdict here is
 * `assessPackageCandidateSafety` itself, called on the same two persisted
 * columns, not a re-implementation of its rules.
 *
 * THREE OUTCOMES, AND THE THIRD IS THE POINT. `ambiguous` exists because the
 * alternative — "take the newest" — is how a superseded package reaches an
 * issuer. When two candidates share the highest version, filing stops and a
 * human is told.
 *
 * LATEST CANDIDATE ONLY. Both production selectors take `order by version desc
 * limit 1`, and C-11's doctrine is explicit that a selector must never fall back
 * from a new safe-or-failed candidate to an older safe one. This module judges
 * the highest version and nothing else; there is deliberately no "newest SAFE
 * version" search.
 *
 * A DEADLINE RELAXES NOTHING (P-6). The only outcome the deadline trigger may
 * change is `deadline_only_not_yet_due`. Coverage, a hard block, staleness, a
 * missing safe argument, ambiguity and a failed validation refuse on both
 * triggers, and `deadlineExecutionConditions` restates that as the five
 * conjunctive conditions `mayExecuteAtDeadline` takes.
 */

import {
  evaluateFreshness,
  type CaseArgumentPlanSnapshot,
  type CaseAssessmentSnapshot,
  type CaseAutomationDecisionSnapshot,
  type DeadlineExecutionConditions,
  type DocumentValidationResult,
  type FileableSelection,
  type InputHash,
  type NotFileableReason,
  type SelectionTrigger,
  type SnapshotFreshness,
  type StalenessReason,
} from "@/lib/pipeline/contracts";
import { assessPackageCandidateSafety } from "../packageSafety";

/**
 * One persisted `defence_packages` row, narrowed to what the decision needs.
 *
 * `factsJson` / `narrativeJson` are passed through UNPARSED, exactly as stored:
 * the C-11 predicate fails closed on any shape it has not measured, and parsing
 * them here would move that judgement out of its owner.
 */
export interface FileablePackageCandidate {
  packageId: string;
  packageVersion: number;
  /** `pdf_path` — the generated artifact this selection stands behind. */
  artifactId: string | null;
  /** `defence_packages.status`. Only `final` may be filed. */
  status: string | null;
  /** `defence_packages.validation_status`. Only `ok` may be filed. */
  validationStatus: string | null;
  supersededById: string | null;
  factsJson: unknown;
  narrativeJson: unknown;
  /** Persisted plan verdict. `deadlineOnly` from the plan the package was built from. */
  planDeadlineOnly?: boolean;
  /** Deterministic post-composition validation. Null = never run ⇒ refused. */
  documentValidation: DocumentValidationResult | null;
}

export interface CurrentFreshnessInputs {
  policyVersion: number;
  assessmentInputHash: InputHash;
  planInputHash: InputHash;
  decisionInputHash: InputHash;
}

export interface SelectFileablePackageInput {
  caseId: string;
  trigger: SelectionTrigger;
  candidates: readonly FileablePackageCandidate[];
  assessment: CaseAssessmentSnapshot | null;
  plan: CaseArgumentPlanSnapshot | null;
  decision: CaseAutomationDecisionSnapshot | null;
  current: CurrentFreshnessInputs;
}

/** Reason codes that decide the case before the argument is consulted. */
const CONCEDED_CODES = new Set(["coverage_active", "fatal_loss"]);
/** Reason codes that refuse on BOTH triggers, deadline included. */
const HARD_BLOCK_CODES = new Set(["hard_block", "strength_insufficient"]);
/** Automation actions that make a package deadline-only regardless of the plan. */
const DEADLINE_ONLY_ACTIONS = new Set(["hold_for_deadline", "park_for_review"]);

const FILEABLE_STATUS = "final";
const OK_VALIDATION = "ok";

function none(
  trigger: SelectionTrigger,
  reason: NotFileableReason,
  staleness?: StalenessReason,
): FileableSelection {
  return staleness
    ? { outcome: "none", trigger, reason, staleness }
    : { outcome: "none", trigger, reason };
}

/**
 * Staleness across the three canonical layers, in decision order.
 *
 * A missing snapshot is `snapshot_absent`, not a pass: a package built before
 * any of these layers existed is exactly the post-R4 legacy shape, and the
 * kickoff decision is that such packages go stale and non-fileable rather than
 * being grandfathered.
 */
function stalenessOf(
  input: SelectFileablePackageInput,
): StalenessReason | null {
  const layers: Array<[SnapshotFreshness | null | undefined, InputHash]> = [
    [input.decision?.freshness, input.current.decisionInputHash],
    [input.assessment?.freshness, input.current.assessmentInputHash],
    [input.plan?.freshness, input.current.planInputHash],
  ];
  for (const [snapshot, currentInputHash] of layers) {
    const verdict = evaluateFreshness({
      snapshot,
      currentInputHash,
      currentPolicyVersion: input.current.policyVersion,
    });
    if (!verdict.fresh) return verdict.reason;
  }
  return null;
}

/** True while the case still holds an unresolved review item or a parked decision. */
export function isDeadlineOnly(input: {
  plan: CaseArgumentPlanSnapshot | null;
  decision: CaseAutomationDecisionSnapshot | null;
  candidate?: FileablePackageCandidate | null;
}): boolean {
  if (input.plan?.deadlineOnly) return true;
  if (input.candidate?.planDeadlineOnly) return true;
  return input.decision !== null && DEADLINE_ONLY_ACTIONS.has(input.decision.action);
}

export function selectFileablePackage(
  input: SelectFileablePackageInput,
): FileableSelection {
  const { trigger } = input;
  const reasonCodes = input.decision?.reasonCodes ?? [];

  // 1. Coverage / concession decides the case before anything else, and beats
  //    fatal-loss. Never auto-file a covered pack; a deadline does not change it.
  if (input.assessment?.gateDecided || reasonCodes.some((c) => CONCEDED_CODES.has(c))) {
    return none(trigger, "coverage_or_concession");
  }

  // 2. A hard block refuses on both triggers (P-6: a deadline relaxes none of
  //    the five conditions).
  if (reasonCodes.some((c) => HARD_BLOCK_CODES.has(c))) {
    return none(trigger, "hard_block");
  }

  // 3. Staleness. Checked before the argument because a stale plan's verdict is
  //    a statement about inputs that have since changed.
  const staleness = stalenessOf(input);
  if (staleness) return none(trigger, "stale", staleness);

  // 4. No safe argument — the honest outcome, on both triggers. An absent plan
  //    is the same answer: nothing has authorised any issuer-facing claim.
  if (!input.plan || input.plan.noSafeArgument !== null || input.plan.included.length === 0) {
    return none(trigger, "no_safe_argument");
  }

  // 5. Candidate resolution — the latest version only, never a fallback.
  if (input.candidates.length === 0) return none(trigger, "no_package");
  const maxVersion = Math.max(...input.candidates.map((c) => c.packageVersion));
  const atMax = input.candidates.filter((c) => c.packageVersion === maxVersion);

  // 6. Two candidates and no rule that picks between them. An ERROR that
  //    alerts, never a silent choice.
  if (atMax.length > 1) {
    return {
      outcome: "ambiguous",
      trigger,
      candidateIds: atMax.map((c) => c.packageId).sort(),
    };
  }

  const candidate = atMax[0];

  // 7. Superseded. A row that names a successor is never the row to file.
  if (candidate.supersededById !== null || candidate.status === "superseded") {
    return none(trigger, "superseded");
  }

  // 8. CONTENT — the C-11 predicate, on the same two persisted columns it reads
  //    in production today. This is the subsumption: same input, same verdict.
  const safety = assessPackageCandidateSafety({
    factsJson: candidate.factsJson,
    narrativeJson: candidate.narrativeJson,
  });
  if (!safety.safe) return none(trigger, "validation_failed");

  // 9. Deterministic post-composition validation. Absent is refused, not
  //    tolerated: "never run" is not evidence of passing.
  if (!candidate.documentValidation || !candidate.documentValidation.passed) {
    return none(trigger, "validation_failed");
  }
  if (candidate.validationStatus !== OK_VALIDATION) {
    return none(trigger, "validation_failed");
  }

  // 10. Lifecycle. A draft is not a fileable package; see the CONTRACT FRICTION
  //     note in this epic's report — `NotFileableReason` has no member for it.
  if (candidate.status !== FILEABLE_STATUS) return none(trigger, "no_package");

  // 11. The artifact this selection would stand behind must exist.
  if (!candidate.artifactId || candidate.artifactId.trim().length === 0) {
    return none(trigger, "artifact_missing");
  }

  // 12. The ONE outcome a deadline may change.
  if (trigger === "normal" && isDeadlineOnly({ plan: input.plan, decision: input.decision, candidate })) {
    return none(trigger, "deadline_only_not_yet_due");
  }

  return {
    outcome: "selected",
    trigger,
    package: {
      packageId: candidate.packageId,
      packageVersion: candidate.packageVersion,
      artifactId: candidate.artifactId,
    },
  };
}

/**
 * P-6's five conditions, derived from the same inputs the selector used.
 *
 * Written as the explicit object rather than a boolean so a refusal can name
 * WHICH condition failed — an executor that can only say "not allowed" produces
 * exactly the un-diagnosable filing behaviour this replaces. Feed the result to
 * `mayExecuteAtDeadline`; do not re-implement the conjunction.
 */
export function deadlineExecutionConditions(
  input: SelectFileablePackageInput,
): DeadlineExecutionConditions {
  const selection = selectFileablePackage({ ...input, trigger: "deadline" });
  const reasonCodes = input.decision?.reasonCodes ?? [];
  const stale = stalenessOf(input);
  return {
    hasCurrentCanonicalDecision: input.decision !== null && stale === null,
    hasCurrentValidatedSafePackage: selection.outcome === "selected",
    noHardBlock:
      !reasonCodes.some((c) => HARD_BLOCK_CODES.has(c)) &&
      !reasonCodes.some((c) => CONCEDED_CODES.has(c)) &&
      input.assessment?.gateDecided !== true,
    notStale: stale === null,
    noAmbiguity: selection.outcome !== "ambiguous",
  };
}
