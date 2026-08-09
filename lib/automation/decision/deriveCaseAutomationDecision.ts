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
  GateDecision,
} from "@/lib/pipeline/contracts";
import { hashDecisionInputs } from "./inputHash";
import {
  AUTOMATION_DECISION_VERSION,
  AUTOMATION_POLICY_VERSION,
  type AutomationPolicy,
} from "./policy";

/**
 * The gate facts the ASSESSMENT does not carry.
 *
 * CP-C originally declared coverage and fatal-loss here too, because
 * `CaseAssessmentSnapshot.gateDecided` was a boolean that said a gate had fired
 * but not WHICH — and the two are not interchangeable: coverage BEATS
 * fatal-loss (PRD §4 over §5), they produce different reason codes, and the
 * fatal-loss reason must never reach bank-facing text while a coverage status
 * may be shown to the merchant.
 *
 * CONTRACT REVISION 1 replaced the boolean with `gateDecision:
 * "coverage" | "fatal_loss" | null`, so both are read off the snapshot now and
 * this interface no longer restates them. That matters beyond tidiness: a local
 * gate shape next to a canonical one is a second place for `COVERED_STATUSES`
 * to drift, and the whole reason this layer exists is that four call sites had
 * four different gate sets.
 *
 * Credit-already-issued stays, because it is not on the snapshot.
 */
export interface AutomationGateFacts {
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

/**
 * Coverage and fatal-loss as a CALLER still holds them — two loose values read
 * off `pack_json` — before they become the contract's one named `GateDecision`.
 *
 * Contract revision 1 moved the answer onto `CaseAssessmentSnapshot`, but the
 * question is still asked in more than one place: the pack-row loader projects
 * it from a persisted row, and `resolveHeldState` projects it from the two
 * values its callers already carry. Both must agree that coverage BEATS
 * fatal-loss and that `"covered_shopify"` is the only covered state, so the
 * projection lives here, once, next to the ladder that consumes it — a second
 * copy is exactly how `COVERED_STATUSES` drifts apart between call sites.
 */
export interface RawGateFacts {
  /**
   * `pack_json.coverage.state`. `"covered_shopify"` is written by
   * `lib/packs/sources/coverageSource.ts` and ONLY for
   * `COVERED_STATUSES = {PROTECTED, ACTIVE}`. Never re-derived, never widened.
   */
  coverageState: string | null | undefined;
  /** `pack_json.fatal_loss`. The reason is audit material and never copy. */
  fatalLoss: { triggered?: boolean } | null | undefined;
}

/** Coverage first — PRD §4 beats §5, and the order here IS that invariant. */
export function gateDecisionFromFacts(facts: RawGateFacts): GateDecision {
  if (facts.coverageState === "covered_shopify") return "coverage";
  if (facts.fatalLoss?.triggered === true) return "fatal_loss";
  return null;
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
  /*
   * `reviewRequiredCount` used to be an input here. CONTRACT REVISION 1 put it
   * on `CaseAssessmentSnapshot`, which is where it belongs: automation may name
   * `review_required_present` but may not import argument-plan or review
   * internals (branch boundary, `branchBoundary.test.ts`), so without a field on
   * the snapshot this layer could name a state it had no way to observe. It is
   * a COUNT, never the items — automation needs to know *whether*, never *what*.
   */
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
      // Named, not a boolean (revision 1). Coverage and fatal-loss hash
      // differently because they ARE different decisions.
      gateDecision: a.gateDecision,
      reviewRequiredCount: a.reviewRequiredCount,
      modelVersion: a.modelVersion,
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
      // Coverage and fatal-loss are hashed through `assessment.gateDecision`
      // and the assessment's own input hash, which already covers the gate set.
      // Restating them here would be a second source for the same fact.
      creditCoversDisputedAmount:
        input.gates.creditAlreadyIssued?.triggered === true &&
        input.gates.creditAlreadyIssued?.coversDisputedAmount === true,
    },
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
  //
  //    Read off `assessment.gateDecision` (revision 1), which is resolved once
  //    by `resolveGateDecision` in the assessment layer. `COVERED_STATUSES`
  //    stays exactly `{PROTECTED, ACTIVE}` in `coverageSource.ts`; this module
  //    never re-derives it and never widens it.
  if (assessment.gateDecision === "coverage") {
    return { action: "block", reasonCodes: ["coverage_active"] };
  }

  // 2. FATAL LOSS (PRD §5). Structurally unwinnable. Auto mode blocks. Only the
  //    machine code travels in the decision — the specific trigger is
  //    merchant-UI/audit material and bank text may never cite it, which is why
  //    the snapshot carries a named gate rather than the gate's reason string.
  if (assessment.gateDecision === "fatal_loss") {
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

  const creditCovers =
    gates.creditAlreadyIssued?.triggered === true &&
    gates.creditAlreadyIssued?.coversDisputedAmount === true;
  const overall = assessment.strength.overall;

  // 5. AUTOMATION OFF. Review mode, or a shop with auto-save disabled. Parks —
  //    the merchant decides. Placed after every BLOCK rung so a covered /
  //    fatally lost / stale / hard-blocked case reports its real reason rather
  //    than "automation is off", which would be true but useless. NOTHING BELOW
  //    THIS LINE CAN BLOCK, which is exactly what makes the mode unable to
  //    change a block into a non-block — asserted in `decisionLadder.test.ts`.
  if (input.automationMode !== "auto" || !policy.autoSaveEnabled) {
    return { action: "park_for_review", reasonCodes: ["automation_disabled"] };
  }

  /* 6. STRENGTH FLOOR (PRD §9). Weak / insufficient HOLDS for the deadline —
   *    it does not block, and it is consulted before completeness, because more
   *    evidence of the wrong kind does not rescue a case with no supported
   *    claim. A fully-credited case is exempt: it reaches this point only via
   *    the strength floor, and the argument needs no judgement.
   *
   *    CONTRACT REVISION 2 — THIS RUNG USED TO RETURN `block`, AND THAT WAS THE
   *    DEFECT. Strength is an ODDS judgement, and odds may never withhold a
   *    filing. Filing nothing does not produce silence: Shopify auto-compiles
   *    and files its OWN scrape, there is no accept/concede mutation, and
   *    VDMP/VAMP compute the dispute ratio from disputes RECEIVED, so losing a
   *    representment costs nothing. A guard therefore never chooses submit vs
   *    stay silent; it chooses OUR DOCUMENT vs SHOPIFY'S SCRAPE. A hard block is
   *    an HONESTY condition — coverage/concession, fatal-loss, or an unsafe
   *    claim — and a thin but honestly argued letter is none of those.
   *
   *    It also MOVED below the automation-mode rung as a consequence. The rung
   *    sat above it so that a block could not be softened into a park by review
   *    mode; now that it holds rather than blocks, that reason is gone, and the
   *    invariant is stronger stated the other way round: every blocking rung is
   *    above the mode rung and every holding rung is below it. In review mode a
   *    weak case parks (the merchant is the lever); in auto mode it holds for
   *    the deadline, and the deadline path FILES it.
   */
  if (!creditCovers && (overall === "weak" || overall === "insufficient")) {
    // Most-decisive first, per the contract. A weak case that ALSO carries an
    // unresolved review item names both: the strength floor is why it will not
    // file early, and the review item is a second, independently true reason.
    const reasonCodes: AutomationReasonCode[] = ["strength_insufficient"];
    if (assessment.reviewRequiredCount > 0) reasonCodes.push("review_required_present");
    return { action: "hold_for_deadline", reasonCodes };
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
  if (assessment.reviewRequiredCount > 0) {
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
