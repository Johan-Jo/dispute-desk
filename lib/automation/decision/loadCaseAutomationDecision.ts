/**
 * Assembling the decision's inputs from what is persisted today.
 *
 * The canonical `CaseAssessmentSnapshot` is Agent A's derivation (CP-A). Until
 * it lands, this module projects the SAME shape out of the values already
 * persisted on `evidence_packs` — which is also the honest thing to do, because
 * the gate reads the PERSISTED completeness column rather than recomputing it,
 * and 67 of 115 prod packs carry a score the current engine no longer
 * reproduces. A loader that recomputed would answer a different question than
 * the one production is actually answering.
 *
 * INTEGRATION POINT. When CP-A ships `deriveCaseAssessment`, replace
 * `assessmentFromPackRow` with a call to it and delete nothing else: every
 * consumer already goes through `deriveCaseAutomationDecision`.
 *
 * The freshness of a projected assessment is `fresh` by construction — it was
 * computed from the row that is current right now, so there is nothing for it
 * to be stale against. Real staleness arrives with CP-A's persisted snapshot
 * and its stored hash; the decision ladder already has the branch for it and it
 * is proven by test against the shared `stale` fixture.
 */

import type {
  CaseAssessmentSnapshot,
  CaseAutomationDecisionSnapshot,
  FreshnessVerdict,
} from "@/lib/pipeline/contracts";
import type { SubmissionReadiness } from "@/lib/types/evidenceItem";
import { hashDecisionInputs } from "./inputHash";
import {
  AUTOMATION_POLICY_VERSION,
  automationPolicyFromSettings,
  type AutomationPolicy,
} from "./policy";
import {
  deriveCaseAutomationDecision,
  type AutomationGateFacts,
  type CaseAutomationDecisionInput,
} from "./deriveCaseAutomationDecision";

/** The pack columns the decision reads. Nothing else is consulted. */
export interface DecisionPackRow {
  id: string;
  dispute_id: string | null;
  completeness_score: number | null;
  blockers: unknown;
  submission_readiness: unknown;
  pack_json: unknown;
}

interface PackJsonShape {
  coverage?: { state?: string } | null;
  fatal_loss?: { triggered?: boolean; reason?: string | null; message?: string | null } | null;
  case_strength?: { overall?: string } | null;
  credit_already_issued?: { triggered?: boolean; coversDisputedAmount?: boolean } | null;
}

export function packJsonOf(pack: DecisionPackRow): PackJsonShape {
  return (pack.pack_json ?? {}) as PackJsonShape;
}

export function gateFactsFromPackRow(pack: DecisionPackRow): AutomationGateFacts {
  const pj = packJsonOf(pack);
  return {
    coverageState: pj.coverage?.state ?? null,
    fatalLoss: pj.fatal_loss ?? null,
    creditAlreadyIssued: pj.credit_already_issued ?? null,
  };
}

/**
 * `?? 0` on a NULL completeness score is PRESERVED, deliberately: a NULL score
 * has always meant zero to the gate, and changing that during a migration would
 * silently move every legacy pack across the threshold.
 *
 * `?? undefined` on readiness is NOT preserved. That fallback (R1) dropped the
 * gate onto the legacy blocker-count path whenever readiness was absent, which
 * is a second, differently-calibrated ladder reachable by a NULL column. A
 * missing readiness now resolves to the value that cannot silently pass —
 * `"blocked"` — so an absent signal fails closed instead of switching engines.
 */
export function assessmentFromPackRow(
  pack: DecisionPackRow,
  opts: { caseId: string },
): CaseAssessmentSnapshot {
  const pj = packJsonOf(pack);
  const overall = normaliseStrength(pj.case_strength?.overall ?? null);
  const blockers = Array.isArray(pack.blockers)
    ? (pack.blockers as unknown[]).map(String)
    : [];
  const score = pack.completeness_score ?? 0;
  const readiness = normaliseReadiness(pack.submission_readiness);

  const completeness = {
    score,
    evidenceStrengthScore: score,
    readiness,
    blockers,
  };

  return {
    caseId: opts.caseId,
    assessmentVersion: 1,
    strength: {
      overall,
      score: 0,
      coveragePercent: 0,
      strongCount: 0,
      moderateCount: 0,
      supportingCount: 0,
      supportedClaims: 0,
      totalClaims: 0,
      strengthReasonI18n: { key: "automation.decision.projectedStrength" },
      improvementHintI18n: null,
      heroVariant:
        overall === "strong"
          ? "likely_to_win"
          : overall === "moderate"
            ? "could_win"
            : "hard_to_win",
    },
    gateDecided:
      pj.coverage?.state === "covered_shopify" || pj.fatal_loss?.triggered === true,
    completeness,
    freshness: {
      inputHash: hashDecisionInputs({
        packId: pack.id,
        completeness,
        strengthOverall: overall,
        coverageState: pj.coverage?.state ?? null,
        fatalLossTriggered: pj.fatal_loss?.triggered === true,
      }),
      policyVersion: AUTOMATION_POLICY_VERSION,
      computedAt: FRESH_BY_CONSTRUCTION,
    },
  };
}

/**
 * A projected assessment is computed from the row that is current at this
 * instant, so it has nothing to be stale against. Named rather than inlined so
 * every reader sees that this is a construction property, not an assumption
 * that staleness does not exist.
 */
const FRESH_BY_CONSTRUCTION = "1970-01-01T00:00:00.000Z";
export const PROJECTED_ASSESSMENT_FRESHNESS: FreshnessVerdict = { fresh: true };

function normaliseStrength(
  raw: string | null,
): CaseAssessmentSnapshot["strength"]["overall"] {
  if (raw === "strong" || raw === "moderate" || raw === "weak" || raw === "insufficient") {
    return raw;
  }
  // A pack built before `case_strength` existed. Treated as `strong` so it
  // falls through to the gate-only behaviour every legacy caller already had —
  // this is a projection of the past, not a new decision about it.
  return "strong";
}

function normaliseReadiness(raw: unknown): SubmissionReadiness {
  if (
    raw === "ready" ||
    raw === "ready_with_warnings" ||
    raw === "blocked" ||
    raw === "submitted"
  ) {
    return raw;
  }
  // R1 closed: an absent readiness fails closed. It used to select a second
  // gate ladder.
  return "blocked";
}

export interface BuildDecisionArgs {
  caseId: string;
  pack: DecisionPackRow;
  settings: {
    auto_save_enabled: boolean;
    auto_save_min_score: number | null | undefined;
    enforce_no_blockers: boolean;
  };
  automationMode: "auto" | "review" | null;
  /** `disputes.due_at` — ABSOLUTE. */
  evidenceDueAt: string | null;
  reviewRequiredCount?: number;
  /** Audit only. Defaults to now; never enters the hash. */
  computedAt?: string;
  policy?: AutomationPolicy;
  assessment?: CaseAssessmentSnapshot;
  assessmentFreshness?: FreshnessVerdict;
}

export function buildCaseAutomationDecisionInput(
  args: BuildDecisionArgs,
): CaseAutomationDecisionInput {
  return {
    caseId: args.caseId,
    assessment:
      args.assessment ?? assessmentFromPackRow(args.pack, { caseId: args.caseId }),
    assessmentFreshness:
      args.assessmentFreshness ?? PROJECTED_ASSESSMENT_FRESHNESS,
    policy: args.policy ?? automationPolicyFromSettings(args.settings),
    automationMode: args.automationMode,
    gates: gateFactsFromPackRow(args.pack),
    reviewRequiredCount: args.reviewRequiredCount ?? 0,
    evidenceDueAt: args.evidenceDueAt,
    computedAt: args.computedAt ?? new Date().toISOString(),
  };
}

/** The single entry point every call site uses. */
export function decideForPack(
  args: BuildDecisionArgs,
): CaseAutomationDecisionSnapshot {
  return deriveCaseAutomationDecision(buildCaseAutomationDecisionInput(args));
}
