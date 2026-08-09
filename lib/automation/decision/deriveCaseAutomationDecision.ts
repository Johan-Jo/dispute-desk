/**
 * `deriveCaseAutomationDecision` — the ONE automation decision.
 *
 * Every entry point (the pack pipeline, the defence build, the reconcile pass,
 * the held-state resolver, the save gates, and the deadline cron) reads this
 * function's output instead of running its own ladder. Before this existed the
 * same dispute could get a park here, a block there, and — at the deadline —
 * an unconditional file, because the actual submitter consulted no strength, no
 * completeness, no coverage and no guards at all (R3).
 *
 * PURE. No DB, no I/O, no clock. `computedAt` is supplied by the caller and is
 * audit-only.
 *
 * TIME-INVARIANCE. The decision carries `evidenceDueAt`, an ABSOLUTE instant,
 * and nothing else time-shaped. It never carries and is never derived from time
 * remaining, window state or days-to-deadline; executors compute those from the
 * absolute due date at execution (`deadlineWindow.ts` is the only module that
 * may). Pinned by `decisionTimeInvariance.test.ts`: identical inputs at two
 * clock times produce an identical `inputHash` and identical `reasonCodes`,
 * while a due-date change moves the hash.
 *
 * THE LADDER, in order, most decisive first. The order is the contract; each
 * step is commented with why it sits where it does.
 */

import type {
  AutomationAction,
  AutomationReasonCode,
  CaseAssessmentSnapshot,
  CaseAutomationDecisionSnapshot,
  FreshnessVerdict,
} from "@/lib/pipeline/contracts";
import { hashDecisionInputs } from "./inputHash";
import {
  AUTOMATION_DECISION_VERSION,
  AUTOMATION_POLICY_VERSION,
  type AutomationPolicy,
} from "./policy";

/**
 * Coverage and fatal-loss, as the decision sees them.
 *
 * `CaseAssessmentSnapshot.gateDecided` says a gate fired but not WHICH, and the
 * two are not interchangeable: coverage BEATS fatal-loss (PRD §4 over §5), they
 * produce different reason codes, and the fatal-loss reason must never reach
 * bank-facing text while the coverage status may be shown to the merchant. So
 * the decision takes them explicitly. See CONTRACT FRICTION in the CP-C report.
 */
export interface AutomationGateFacts {
  /**
   * `pack_json.coverage.state`. `"covered_shopify"` is written by
   * `lib/packs/sources/coverageSource.ts` and ONLY for
   * `COVERED_STATUSES = {PROTECTED, ACTIVE}`. This module never re-derives that
   * set and never widens it — it reads the state the source already decided.
   */
  coverageState: string | null | undefined;
  /** `pack_json.fatal_loss`. The reason is carried for audit, never for copy. */
  fatalLoss:
    | { triggered?: boolean; reason?: string | null; message?: string | null }
    | null
    | undefined;
  /**
   * `pack_json.credit_already_issued`. A fully-credited case reaches Strong via
   * the strength floor; naming it keeps the verdict legible instead of
   * inherited. Required, not optional — a trailing optional gate is how gate
   * sets drift apart between call sites (P5, 2026-08-04).
   */
  creditAlreadyIssued:
    | { triggered?: boolean; coversDisputedAmount?: boolean }
    | null;
}

export interface CaseAutomationDecisionInput {
  caseId: string;
  assessment: CaseAssessmentSnapshot;
  /**
   * Freshness of `assessment`, already evaluated by the caller through the ONE
   * shared predicate (`evaluateFreshness`). Passed in rather than computed here
   * because only the caller knows the current input hash — and because this
   * module must not grow a second staleness rule.
   */
  assessmentFreshness: FreshnessVerdict;
  policy: AutomationPolicy;
  /** Resolved rule mode. `null` is treated exactly like `"review"`. */
  automationMode: "auto" | "review" | null;
  gates: AutomationGateFacts;
  /**
   * How many `review_required` facts the case carries. A COUNT, not the facts:
   * automation may not import argument-plan or review internals (branch
   * boundary, enforced by `branchBoundary.test.ts`).
   */
  reviewRequiredCount: number;
  /** ISO-8601 ABSOLUTE instant, or null. NEVER a duration or a window flag. */
  evidenceDueAt: string | null;
  /** Audit only. Excluded from the hash by construction — see `hashableInputs`. */
  computedAt: string;
}

/**
 * Exactly the fields that can change the result. `computedAt` is absent by
 * construction, which is what makes the two-clock test pass; `evidenceDueAt` is
 * present, which is what makes a due-date change a new decision.
 */
function hashableInputs(input: CaseAutomationDecisionInput) {
  const a = input.assessment;
  return {
    caseId: input.caseId,
    assessment: {
      assessmentVersion: a.assessmentVersion,
      strengthOverall: a.strength.overall,
      completenessScore: a.completeness.score,
      readiness: a.completeness.readiness,
      blockers: [...a.completeness.blockers].sort(),
      gateDecided: a.gateDecided,
      // The assessment's own hash, so a changed assessment is a changed
      // decision input even when the fields above happen to land the same.
      assessmentInputHash: a.freshness.inputHash,
      assessmentPolicyVersion: a.freshness.policyVersion,
    },
    assessmentFresh: input.assessmentFreshness.fresh,
    assessmentStaleReason: input.assessmentFreshness.fresh
      ? null
      : input.assessmentFreshness.reason,
    policy: {
      version: input.policy.version,
      autoSaveEnabled: input.policy.autoSaveEnabled,
      completenessThreshold: input.policy.completenessThreshold,
      enforceNoBlockers: input.policy.enforceNoBlockers,
    },
    automationMode: input.automationMode ?? "review",
    gates: {
      coverageState: input.gates.coverageState ?? null,
      fatalLossTriggered: input.gates.fatalLoss?.triggered === true,
      fatalLossReason: input.gates.fatalLoss?.reason ?? null,
      creditCoversDisputedAmount:
        input.gates.creditAlreadyIssued?.triggered === true &&
        input.gates.creditAlreadyIssued?.coversDisputedAmount === true,
    },
    reviewRequiredCount: input.reviewRequiredCount,
    evidenceDueAt: input.evidenceDueAt,
  };
}

interface Verdict {
  action: AutomationAction;
  reasonCodes: AutomationReasonCode[];
}

function verdict(input: CaseAutomationDecisionInput): Verdict {
  const { assessment, policy, gates } = input;

  // 1. COVERAGE (PRD §4). The highest-priority routing decision in the whole
  //    product: Shopify Protect is underwriting the loss, there is no merchant
  //    workflow, and a covered pack is NEVER auto-filed. Coverage is first so
  //    it beats fatal-loss — that precedence is a product invariant, not an
  //    accident of ordering, and is pinned by test.
  if (gates.coverageState === "covered_shopify") {
    return { action: "block", reasonCodes: ["coverage_active"] };
  }

  // 2. FATAL LOSS (PRD §5). Structurally unwinnable. Auto mode blocks. The
  //    reason travels in the decision for audit and merchant UI only — bank
  //    text may never cite it, which is enforced at the composition layer.
  if (gates.fatalLoss?.triggered === true) {
    return { action: "block", reasonCodes: ["fatal_loss"] };
  }

  // 3. STALENESS. A decision computed against inputs that have since changed
  //    cannot authorise a filing, and a stale snapshot that LOOKS current is
  //    the one failure mode that puts a false assertion in front of an issuer.
  //    Above the content gates below because nothing derived from a stale
  //    assessment is trustworthy.
  if (!input.assessmentFreshness.fresh) {
    return { action: "block", reasonCodes: ["assessment_stale"] };
  }

  // 4. HARD BLOCK. Required evidence is missing; the package cannot be filed on
  //    ANY trigger, and a deadline does not relax it (P-6).
  if (policy.enforceNoBlockers && assessment.completeness.readiness === "blocked") {
    return { action: "block", reasonCodes: ["hard_block"] };
  }

  // 5. STRENGTH FLOOR (PRD §9). Weak / insufficient blocks before completeness
  //    is ever consulted — more evidence of the wrong kind does not rescue a
  //    case with no supported claim. A fully-credited case is exempt: it
  //    reaches this point only via the strength floor, and the argument needs
  //    no judgement.
  //
  //    ABOVE the automation-mode rung, deliberately. This is a statement about
  //    what AUTOMATION may file, not about what the merchant may file: a
  //    merchant in review mode still submits by hand through the manual route,
  //    which does not consult this decision. Putting it below the mode rung
  //    would make review mode turn a block into a park, and the deadline cron
  //    — which evaluates every case as `auto` because only the block predicate
  //    matters to it — would then be relying on an ordering accident. The
  //    property is asserted directly in `decisionLadder.test.ts`.
  const creditCovers =
    gates.creditAlreadyIssued?.triggered === true &&
    gates.creditAlreadyIssued?.coversDisputedAmount === true;
  const overall = assessment.strength.overall;
  if (!creditCovers && (overall === "weak" || overall === "insufficient")) {
    return { action: "block", reasonCodes: ["strength_insufficient"] };
  }

  // 6. AUTOMATION OFF. Review mode, or a shop with auto-save disabled. Parks —
  //    the merchant decides. Placed after every BLOCK rung so a covered /
  //    fatally lost / stale / hard-blocked / unwinnable case reports its real
  //    reason rather than "automation is off", which would be true but useless.
  //    Nothing below this line can block, which is exactly what makes the mode
  //    unable to change a block into a non-block.
  if (input.automationMode !== "auto" || !policy.autoSaveEnabled) {
    return { action: "park_for_review", reasonCodes: ["automation_disabled"] };
  }

  // 7. COMPLETENESS. Its own concept, never derived from strength and never
  //    deriving it. Below threshold parks: it is NOT a hard block, so the
  //    deadline trigger may still file what exists rather than forfeit.
  if (assessment.completeness.score < policy.completenessThreshold) {
    return {
      action: "park_for_review",
      reasonCodes: ["below_completeness_threshold"],
    };
  }

  // 8. REVIEW-REQUIRED FACTS. The package is deadline_only while any remain:
  //    the normal trigger declines, the deadline trigger may take it.
  if (input.reviewRequiredCount > 0) {
    return { action: "hold_for_deadline", reasonCodes: ["review_required_present"] };
  }

  // 9. MODERATE HOLDS. Nothing disqualifying, but not strong enough to file
  //    early — the case waits for a clock, not for a merchant decision.
  if (!creditCovers && overall === "moderate") {
    return { action: "hold_for_deadline", reasonCodes: ["eligible"] };
  }

  return { action: "auto_file", reasonCodes: ["eligible"] };
}

export function deriveCaseAutomationDecision(
  input: CaseAutomationDecisionInput,
): CaseAutomationDecisionSnapshot {
  const { action, reasonCodes } = verdict(input);
  return {
    caseId: input.caseId,
    decisionVersion: AUTOMATION_DECISION_VERSION,
    action,
    reasonCodes,
    evidenceDueAt: input.evidenceDueAt,
    freshness: {
      inputHash: hashDecisionInputs(hashableInputs(input)),
      policyVersion: input.policy.version,
      computedAt: input.computedAt,
    },
  };
}

/** The hash a stored decision must still match to be current. */
export function currentDecisionInputHash(input: CaseAutomationDecisionInput) {
  return hashDecisionInputs(hashableInputs(input));
}

/** Guard so no consumer re-implements the check with a string compare. */
export function decisionBlocks(
  decision: CaseAutomationDecisionSnapshot,
): boolean {
  return decision.action === "block";
}

/** True when the case is waiting for the clock rather than for a merchant. */
export function decisionIsHeld(
  decision: CaseAutomationDecisionSnapshot,
): boolean {
  return decision.action === "hold_for_deadline";
}

export { AUTOMATION_POLICY_VERSION };
