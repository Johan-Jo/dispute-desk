/**
 * Shared contract fixtures — the nine cases every epic builds against.
 *
 * OWNED BY THE COORDINATOR (CP-0 contract commit), deliberately. The first
 * draft of the plan made these Agent A's handoff deliverable, which would have
 * left Agents B and C blocked on A on day one while claiming they ran in
 * parallel. They are inputs, not outputs.
 *
 * WHAT THEY ARE. Snapshot-level fixtures: assessment, argument plan, automation
 * decision, and the selection each trigger must produce. They describe the
 * CONTRACT, not any epic's internals, so B and C can write real tests before A's
 * derivation exists — and so all three agree on what "stale" or "hard-blocked"
 * means before anyone implements it.
 *
 * WHAT THEY ARE NOT. Not production characterization data. The prod-shaped
 * measurements live in the analysis harnesses and the replay (CP-D §9.4), and
 * they answer a different question: what the fleet actually does today.
 *
 * Agents may extend privately. This set does not move without a coordinator
 * contract revision.
 */

import type { CaseStrengthResult } from "@/lib/argument/types";
import type { CaseAssessmentSnapshot } from "../assessment";
import type { CaseArgumentPlanSnapshot } from "../argumentPlan";
import type { CaseAutomationDecisionSnapshot } from "../automationDecision";
import type { FileableSelection, NotFileableReason } from "../fileableSelection";
import type { SnapshotFreshness } from "../freshness";

/**
 * Fixed instants. Never `Date.now()` — a fixture whose value depends on when
 * the suite runs cannot pin a time-invariance test, which is the one property
 * `CaseAutomationDecisionSnapshot` most needs pinned.
 */
export const FIXTURE_COMPUTED_AT = "2026-08-09T00:00:00.000Z";
export const FIXTURE_DUE_AT = "2026-08-20T00:00:00.000Z";

const CURRENT_POLICY_VERSION = 1;

function freshness(hash: string, opts?: { stale?: boolean }): SnapshotFreshness {
  return {
    inputHash: opts?.stale ? `${hash}--superseded` : hash,
    policyVersion: CURRENT_POLICY_VERSION,
    computedAt: FIXTURE_COMPUTED_AT,
  };
}

function strength(
  overall: CaseStrengthResult["overall"],
  extra: Partial<CaseStrengthResult> = {},
): CaseStrengthResult {
  const heroByOverall: Record<CaseStrengthResult["overall"], CaseStrengthResult["heroVariant"]> = {
    strong: "likely_to_win",
    moderate: "could_win",
    weak: "hard_to_win",
    insufficient: "hard_to_win",
  };
  return {
    overall,
    score: overall === "strong" ? 9 : overall === "moderate" ? 4 : 0,
    coveragePercent: overall === "strong" ? 90 : overall === "moderate" ? 60 : 20,
    strongCount: overall === "strong" ? 3 : 0,
    moderateCount: overall === "moderate" ? 2 : 0,
    supportingCount: 0,
    supportedClaims: overall === "weak" || overall === "insufficient" ? 0 : 2,
    totalClaims: 3,
    strengthReasonI18n: { key: "fixtures.strengthReason" },
    improvementHintI18n: null,
    heroVariant: heroByOverall[overall],
    ...extra,
  };
}

export interface ContractFixture {
  /** Stable id — tests reference these by name, never by array index. */
  name: string;
  /** One sentence on what this case is FOR. Read it before changing a value. */
  intent: string;
  assessment: CaseAssessmentSnapshot;
  plan: CaseArgumentPlanSnapshot;
  decision: CaseAutomationDecisionSnapshot;
  /** The selection each trigger MUST produce. This is the acceptance contract. */
  expected: {
    normal: FileableSelection["outcome"];
    normalReason?: NotFileableReason;
    deadline: FileableSelection["outcome"];
    deadlineReason?: NotFileableReason;
  };
}

function baseAssessment(
  caseId: string,
  overall: CaseStrengthResult["overall"],
  completenessScore: number,
  opts: {
    readiness?: CaseAssessmentSnapshot["completeness"]["readiness"];
    blockers?: string[];
    gateDecision?: CaseAssessmentSnapshot["gateDecision"];
    reviewRequiredCount?: number;
    stale?: boolean;
  } = {},
): CaseAssessmentSnapshot {
  return {
    caseId,
    assessmentVersion: 1,
    strength: strength(overall),
    completeness: {
      score: completenessScore,
      evidenceStrengthScore: completenessScore,
      readiness: opts.readiness ?? "ready",
      blockers: opts.blockers ?? [],
    },
    gateDecision: opts.gateDecision ?? null,
    reviewRequiredCount: opts.reviewRequiredCount ?? 0,
    modelVersion: 1,
    freshness: freshness(`${caseId}-assessment`, { stale: opts.stale }),
  };
}

function basePlan(
  caseId: string,
  opts: {
    deadlineOnly?: boolean;
    noSafeArgument?: CaseArgumentPlanSnapshot["noSafeArgument"];
    excluded?: CaseArgumentPlanSnapshot["excluded"];
    included?: CaseArgumentPlanSnapshot["included"];
    stale?: boolean;
  } = {},
): CaseArgumentPlanSnapshot {
  return {
    caseId,
    planVersion: 1,
    reasonModuleId: "fixtures.reason_module",
    included:
      opts.included ??
      [{ recordId: `${caseId}#delivery`, fieldKey: "delivery_proof", factCategory: "delivery" }],
    excluded: opts.excluded ?? [],
    noSafeArgument: opts.noSafeArgument ?? null,
    deadlineOnly: opts.deadlineOnly ?? false,
    freshness: freshness(`${caseId}-plan`, { stale: opts.stale }),
  };
}

function baseDecision(
  caseId: string,
  action: CaseAutomationDecisionSnapshot["action"],
  reasonCodes: CaseAutomationDecisionSnapshot["reasonCodes"],
  opts: { stale?: boolean } = {},
): CaseAutomationDecisionSnapshot {
  return {
    caseId,
    decisionVersion: 1,
    action,
    reasonCodes,
    evidenceDueAt: FIXTURE_DUE_AT,
    freshness: freshness(`${caseId}-decision`, { stale: opts.stale }),
  };
}

/* ── The nine ───────────────────────────────────────────────────────── */

export const FIXTURE_STRONG: ContractFixture = {
  name: "strong",
  intent: "The happy path: approved facts, safe argument, automation allowed. Files on both triggers.",
  assessment: baseAssessment("strong", "strong", 85),
  plan: basePlan("strong"),
  decision: baseDecision("strong", "auto_file", ["eligible"]),
  expected: { normal: "selected", deadline: "selected" },
};

export const FIXTURE_WEAK: ContractFixture = {
  name: "weak",
  intent: "Weak strength blocks before completeness is ever consulted — the gate order pipeline.ts already uses.",
  assessment: baseAssessment("weak", "weak", 85),
  plan: basePlan("weak"),
  decision: baseDecision("weak", "block", ["strength_insufficient"]),
  expected: {
    normal: "none",
    normalReason: "hard_block",
    deadline: "none",
    deadlineReason: "hard_block",
  },
};

export const FIXTURE_COMPLETE: ContractFixture = {
  name: "complete",
  intent: "Completeness at ceiling with moderate strength — proves completeness and strength stay separate concepts.",
  assessment: baseAssessment("complete", "moderate", 100),
  plan: basePlan("complete"),
  decision: baseDecision("complete", "hold_for_deadline", ["eligible"]),
  expected: {
    normal: "none",
    normalReason: "deadline_only_not_yet_due",
    deadline: "selected",
  },
};

export const FIXTURE_INCOMPLETE: ContractFixture = {
  name: "incomplete",
  intent: "Below threshold with a NULL-shaped readiness path — pins `?? 0` / `?? undefined` gate behaviour.",
  assessment: baseAssessment("incomplete", "moderate", 35, {
    readiness: "ready_with_warnings",
  }),
  plan: basePlan("incomplete"),
  decision: baseDecision("incomplete", "park_for_review", ["below_completeness_threshold"]),
  expected: {
    normal: "none",
    normalReason: "deadline_only_not_yet_due",
    deadline: "selected",
  },
};

export const FIXTURE_HARD_BLOCKED: ContractFixture = {
  name: "hard_blocked",
  intent: "A hard block files nothing on either trigger. A deadline never relaxes it (P-6).",
  assessment: baseAssessment("hard_blocked", "moderate", 90, {
    readiness: "blocked",
    blockers: ["fixtures.blocker"],
  }),
  plan: basePlan("hard_blocked"),
  decision: baseDecision("hard_blocked", "block", ["hard_block"]),
  expected: {
    normal: "none",
    normalReason: "hard_block",
    deadline: "none",
    deadlineReason: "hard_block",
  },
};

export const FIXTURE_COVERED: ContractFixture = {
  name: "covered_conceded",
  intent: "Coverage/concession decides the case before anything else. Coverage beats fatal-loss; never auto-file a covered pack.",
  assessment: baseAssessment("covered_conceded", "moderate", 90, { gateDecision: "coverage" }),
  plan: basePlan("covered_conceded"),
  decision: baseDecision("covered_conceded", "block", ["coverage_active"]),
  expected: {
    normal: "none",
    normalReason: "coverage_or_concession",
    deadline: "none",
    deadlineReason: "coverage_or_concession",
  },
};

export const FIXTURE_STALE: ContractFixture = {
  name: "stale",
  intent: "Every snapshot stale. Nothing files; recalculation/rebuild required. This is also the post-R4 legacy-package shape.",
  assessment: baseAssessment("stale", "strong", 90, { stale: true }),
  plan: basePlan("stale", { stale: true }),
  decision: baseDecision("stale", "block", ["assessment_stale"], { stale: true }),
  expected: {
    normal: "none",
    normalReason: "stale",
    deadline: "none",
    deadlineReason: "stale",
  },
};

export const FIXTURE_REVIEW_REQUIRED_SAFE: ContractFixture = {
  name: "review_required_safe_argument",
  intent:
    "A review_required fact is excluded, the argument is rebuilt from what remains, and the package becomes deadline_only. The normal trigger declines; the deadline trigger may take it.",
  assessment: baseAssessment("review_required_safe", "moderate", 70, { reviewRequiredCount: 1 }),
  plan: basePlan("review_required_safe", {
    deadlineOnly: true,
    excluded: [
      {
        recordId: "review_required_safe#tds",
        fieldKey: "tds_authentication",
        factCategory: "payment_authentication",
        reason: "review_required",
        merchantReasonToken: "fixtures.reviewRequired.tds",
      },
    ],
  }),
  decision: baseDecision("review_required_safe", "hold_for_deadline", [
    "review_required_present",
  ]),
  expected: {
    normal: "none",
    normalReason: "deadline_only_not_yet_due",
    deadline: "selected",
  },
};

export const FIXTURE_REVIEW_REQUIRED_NO_SAFE: ContractFixture = {
  name: "review_required_no_safe_argument",
  intent:
    "Removing the review_required fact leaves no safe rebuttal. Nothing is filed on either trigger and the merchant is notified — the honest outcome, not a reason to file something weaker.",
  assessment: baseAssessment("review_required_no_safe", "weak", 40, { reviewRequiredCount: 1 }),
  plan: basePlan("review_required_no_safe", {
    included: [],
    deadlineOnly: true,
    noSafeArgument: "all_support_excluded",
    excluded: [
      {
        recordId: "review_required_no_safe#delivery",
        fieldKey: "delivery_proof",
        factCategory: "delivery",
        reason: "review_required",
        merchantReasonToken: "fixtures.reviewRequired.delivery",
      },
    ],
  }),
  // Revision 1. Agent C's derivation yields `strength_insufficient` here, not
  // `review_required_present`: this case is ALSO weak, and the strength floor
  // fires before the review rung. The contract says reasonCodes are "ordered
  // most-decisive first", so both belong, in that order. Same action, same
  // selection on both triggers — only the audit vocabulary was wrong.
  decision: baseDecision("review_required_no_safe", "block", [
    "strength_insufficient",
    "review_required_present",
  ]),
  expected: {
    normal: "none",
    normalReason: "no_safe_argument",
    deadline: "none",
    deadlineReason: "no_safe_argument",
  },
};

export const CONTRACT_FIXTURES: readonly ContractFixture[] = [
  FIXTURE_STRONG,
  FIXTURE_WEAK,
  FIXTURE_COMPLETE,
  FIXTURE_INCOMPLETE,
  FIXTURE_HARD_BLOCKED,
  FIXTURE_COVERED,
  FIXTURE_STALE,
  FIXTURE_REVIEW_REQUIRED_SAFE,
  FIXTURE_REVIEW_REQUIRED_NO_SAFE,
] as const;
