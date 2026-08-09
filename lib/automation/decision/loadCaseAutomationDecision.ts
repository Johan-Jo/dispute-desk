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
  CompletenessSnapshot,
  FreshnessVerdict,
  GateDecision,
} from "@/lib/pipeline/contracts";
import { readPersistedCompletenessForGate } from "@/lib/evidence/model/completenessSnapshot";
import { hashDecisionInputs } from "./inputHash";
import {
  AUTOMATION_POLICY_VERSION,
  automationPolicyFromSettings,
  type AutomationPolicy,
} from "./policy";
import {
  deriveCaseAutomationDecision,
  gateDecisionFromFacts,
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
    // Coverage and fatal-loss moved onto `CaseAssessmentSnapshot.gateDecision`
    // in contract revision 1 — see `gateDecisionFromPackRow` below. Only
    // credit-already-issued, which is not on the snapshot, is still passed
    // beside the assessment.
    creditAlreadyIssued: pj.credit_already_issued ?? null,
  };
}

/**
 * WHICH gate decided the case, projected from the persisted pack row.
 *
 * Coverage BEATS fatal-loss, and the order below is that product invariant,
 * not an ordering accident. `"covered_shopify"` is written by
 * `lib/packs/sources/coverageSource.ts` and ONLY for
 * `COVERED_STATUSES = {PROTECTED, ACTIVE}`; this function reads the state that
 * source already decided and never re-derives or widens it.
 */
export function gateDecisionFromPackRow(pack: DecisionPackRow): GateDecision {
  const pj = packJsonOf(pack);
  // Delegated, not restated: `gateDecisionFromFacts` is the one place the
  // coverage-beats-fatal-loss order and the `"covered_shopify"` literal live.
  return gateDecisionFromFacts({
    coverageState: pj.coverage?.state ?? null,
    fatalLoss: pj.fatal_loss ?? null,
  });
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
 *
 * INTEGRATION NOTE. The three column coercions themselves are no longer written
 * here: `readPersistedCompletenessForGate` (CP-A) is the single faithful reader
 * of `completeness_score` / `blockers` / `submission_readiness`, and it returns
 * the contract's `CompletenessSnapshot` where `readiness: null` IS the legacy
 * arm. This module then closes R1 in ONE visible line — `?? "blocked"` — rather
 * than by owning a second copy of the coercions. That is the whole point: the
 * departure from legacy behaviour is a single expression with a reason next to
 * it, not a divergence hidden inside a duplicated reader.
 */
export function assessmentFromPackRow(
  pack: DecisionPackRow,
  opts: { caseId: string; reviewRequiredCount?: number },
): CaseAssessmentSnapshot {
  const pj = packJsonOf(pack);
  const overall = normaliseStrength(pj.case_strength?.overall ?? null);
  const persisted = readPersistedCompletenessForGate({
    completeness_score: pack.completeness_score,
    blockers: pack.blockers,
    submission_readiness:
      typeof pack.submission_readiness === "string" ? pack.submission_readiness : null,
    pack_json: pack.pack_json,
  });

  const completeness: CompletenessSnapshot = {
    ...persisted,
    // R1 closed, and this is the ONE line where this module departs from what
    // production's auto-save gate does with a NULL. See the header.
    readiness: persisted.readiness ?? "blocked",
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
    gateDecision: gateDecisionFromPackRow(pack),
    /**
     * A projected assessment has no argument plan behind it, so it observes no
     * review-required facts. Callers that DO hold a plan pass a real count
     * through `BuildDecisionArgs.reviewRequiredCount`, which lands on the
     * snapshot rather than beside it (contract revision 1).
     */
    reviewRequiredCount: opts.reviewRequiredCount ?? 0,
    /**
     * `0` = "not produced by the evidence model". This assessment is projected
     * from persisted pack columns, not derived from a `CaseEvidenceModel`, and
     * claiming a model version it was never derived from would make a reader of
     * a persisted row unable to tell the two apart.
     */
    modelVersion: 0,
    completeness,
    freshness: {
      inputHash: hashDecisionInputs({
        packId: pack.id,
        completeness,
        strengthOverall: overall,
        coverageState: pj.coverage?.state ?? null,
        fatalLossTriggered: pj.fatal_loss?.triggered === true,
        reviewRequiredCount: opts.reviewRequiredCount ?? 0,
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
      args.assessment ??
      assessmentFromPackRow(args.pack, {
        caseId: args.caseId,
        reviewRequiredCount: args.reviewRequiredCount,
      }),
    assessmentFreshness:
      args.assessmentFreshness ?? PROJECTED_ASSESSMENT_FRESHNESS,
    policy: args.policy ?? automationPolicyFromSettings(args.settings),
    automationMode: args.automationMode,
    gates: gateFactsFromPackRow(args.pack),
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
