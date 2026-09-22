/**
 * The bounded synthesis layer (plan §12, §23 step 8).
 *
 * Runs every stage over one immutable snapshot and assembles the analysis
 * record the admin page reads: one primary finding, a status, and a structured
 * summary.
 *
 * ── Why this is deterministic, in a codebase that has an LLM ──
 *
 * Plan §12 forbids the synthesis layer from changing deterministic
 * classifications, inventing evidence, assigning a bank rationale, or marking a
 * finding DEFINITE without deterministic support. A template-driven composer
 * satisfies every one of those by construction; a generative one would need to
 * be policed into satisfying them, and the policing is exactly what
 * `findCausalLanguageViolations` exists to do — a backstop, not a licence.
 *
 * Nothing here writes prose. Every sentence a reviewer reads was authored by a
 * check that had the structured facts in hand, and every one of them is run
 * through `validateFinding` before it can be stored. A finding that fails
 * validation is DROPPED, not downgraded: the point of the gate is that an
 * unsupportable claim does not reach the surface at all.
 */

import { assembleSnapshot, type SnapshotBuildResult } from "./buildSnapshot";
import { runLifecycleChecks } from "./checks/lifecycle";
import { runEvidenceComparison, type ClassifiedEvidence } from "./checks/evidenceComparison";
import {
  runAssertionIntegrity,
  type ClassifiedAssertion,
} from "./checks/assertionIntegrity";
import { runFraudulentModule } from "./reasons/fraudulent";
import { ANALYZER_VERSION, hasReasonModule } from "./analyzerVersion";
import {
  selectPrimaryFinding,
  validateFinding,
  type DraftFinding,
  type LifecycleObservation,
} from "./findings";
import type { PostOutcomeSourceSnapshot } from "./snapshotContract";
import type {
  AnalysisStatus,
  ConfidenceLevel,
  FindingCategory,
  ReasonSpecificStatus,
} from "./taxonomy";

export interface RejectedFinding {
  finding: DraftFinding;
  errors: string[];
}

export interface ComposedAnalysis {
  disputeId: string;
  shopId: string;

  analyzerVersion: number;
  contractVersion: number;
  snapshotHash: string;

  analysisLevel: SnapshotBuildResult["level"]["level"];
  dataIntegrityLimitation: boolean;
  analysisStatus: AnalysisStatus;
  reasonSpecificStatus: ReasonSpecificStatus;

  primaryCategory: FindingCategory;
  primaryConfidence: ConfidenceLevel;
  actionable: boolean;

  /** Findings that passed the schema and causal-language gate. */
  findings: DraftFinding[];
  /** Findings a check produced that the gate refused. Never stored as findings. */
  rejectedFindings: RejectedFinding[];
  observations: LifecycleObservation[];

  evidence: ClassifiedEvidence[];
  assertions: ClassifiedAssertion[];

  summary: AnalysisSummary;
}

/** Structured, bounded. No free prose beyond already-validated finding text. */
export interface AnalysisSummary {
  outcome: "won" | "lost";
  reason: string | null;
  networkReasonCode: string | null;
  paymentProvider: string;
  providerAccessLevel: string;
  submissionConfirmationSource: string;
  findingCount: number;
  observationCount: number;
  evidenceCounts: Record<string, number>;
  assertionCounts: Record<string, number>;
  reconstructionGaps: string[];
  /** Which stages actually ran, so an empty result can be told from a skipped one. */
  stagesRun: string[];
}

function countBy<T extends { classification: string }>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.classification] = (out[i.classification] ?? 0) + 1;
  return out;
}

/**
 * Which primary category represents "we ran and found nothing"?
 *
 * Not the same question as "were there findings". At OUTCOME_METADATA_ONLY the
 * evidence stages had nothing to read, so silence means we could not look —
 * `INDETERMINATE`. At FULL_POST_OUTCOME silence means we looked and the record
 * showed no material gap, which is a real result and must not be dressed up as
 * a clean bill: plan §8 is explicit that NO_MATERIAL_GAP_OBSERVED does not mean
 * the package was perfect or the bank was wrong.
 */
function emptyResultCategory(
  level: ComposedAnalysis["analysisLevel"],
): FindingCategory {
  switch (level) {
    case "FULL_POST_OUTCOME":
    case "PACKAGE_INTEGRITY_ONLY":
      return "NO_MATERIAL_GAP_OBSERVED";
    default:
      return "INDETERMINATE";
  }
}

function resolveReasonSpecificStatus(args: {
  reason: string | null;
  level: ComposedAnalysis["analysisLevel"];
  moduleRan: boolean;
  anyElementHeld: boolean;
}): ReasonSpecificStatus {
  if (!hasReasonModule(args.reason)) return "NOT_YET_SUPPORTED";
  if (!args.moduleRan) return "BLOCKED";
  // The module exists and ran, but the case's own facts are not in the record.
  // Different statement from "no module yet", and only the latter is fixed by
  // shipping code.
  if (!args.anyElementHeld) return "NOT_RECONSTRUCTABLE";
  return "SUPPORTED";
}

export function composeAnalysis(build: SnapshotBuildResult): ComposedAnalysis {
  const snapshot: PostOutcomeSourceSnapshot = build.snapshot;
  const level = build.level;
  const stagesRun: string[] = [];

  // A contract violation means the snapshot itself is untrustworthy. Running
  // checks over it would produce findings about a record we know is malformed.
  if (build.contractErrors.length > 0) {
    return blocked(build, "Snapshot failed contract validation.", stagesRun);
  }

  const lifecycle = runLifecycleChecks(snapshot, level);
  stagesRun.push("lifecycle");

  const evidence = runEvidenceComparison(snapshot);
  stagesRun.push("evidence_comparison");

  const assertions = runAssertionIntegrity(snapshot);
  stagesRun.push("assertion_integrity");

  // The reason module runs only where the level permits a reason-specific
  // conclusion. Plan §7 Stage 5: never deep-analyse a case as though we held
  // the provider's file when we did not.
  const moduleRan =
    hasReasonModule(snapshot.dispute.reason) && level.level === "FULL_POST_OUTCOME";
  const reasonResult = moduleRan
    ? runFraudulentModule(snapshot)
    : { findings: [], observations: [], elements: [] };
  if (moduleRan) stagesRun.push("reason:FRAUDULENT");

  const produced: DraftFinding[] = [
    ...lifecycle.findings,
    ...evidence.findings,
    ...assertions.findings,
    ...reasonResult.findings,
  ];

  // THE GATE. A finding that cannot pass is dropped, not softened.
  const findings: DraftFinding[] = [];
  const rejectedFindings: RejectedFinding[] = [];
  for (const finding of produced) {
    const errors = validateFinding(finding, {
      outcome: snapshot.outcome.finalOutcome,
      analysisLevel: level.level,
    });
    if (errors.length === 0) findings.push(finding);
    else rejectedFindings.push({ finding, errors });
  }

  const primary = selectPrimaryFinding(findings);

  return {
    disputeId: snapshot.dispute.id,
    shopId: snapshot.dispute.shopId,
    analyzerVersion: ANALYZER_VERSION,
    contractVersion: snapshot.contractVersion,
    snapshotHash: build.hash,
    analysisLevel: level.level,
    dataIntegrityLimitation: level.dataIntegrityLimitation,
    analysisStatus: "COMPLETED",
    reasonSpecificStatus: resolveReasonSpecificStatus({
      reason: snapshot.dispute.reason,
      level: level.level,
      moduleRan,
      anyElementHeld: reasonResult.elements.some((e) => e.held),
    }),
    primaryCategory: primary?.category ?? emptyResultCategory(level.level),
    primaryConfidence: primary?.confidence ?? "LOW",
    actionable: findings.some((f) => f.actionClass !== "NO_ACTION"),
    findings,
    rejectedFindings,
    observations: [
      ...lifecycle.observations,
      ...assertions.observations,
      ...reasonResult.observations,
    ],
    evidence: evidence.classified,
    assertions: assertions.assertions,
    summary: {
      outcome: snapshot.outcome.finalOutcome,
      reason: snapshot.dispute.reason,
      networkReasonCode: snapshot.dispute.networkReasonCode,
      paymentProvider: snapshot.provider.paymentProvider,
      providerAccessLevel: snapshot.provider.accessLevel,
      submissionConfirmationSource: snapshot.provider.submissionConfirmationSource,
      findingCount: findings.length,
      observationCount:
        lifecycle.observations.length +
        assertions.observations.length +
        reasonResult.observations.length,
      evidenceCounts: countBy(evidence.classified),
      assertionCounts: countBy(assertions.assertions),
      reconstructionGaps: snapshot.reconstructionGaps,
      stagesRun,
    },
  };
}

function blocked(
  build: SnapshotBuildResult,
  reason: string,
  stagesRun: string[],
): ComposedAnalysis {
  const snapshot = build.snapshot;
  return {
    disputeId: snapshot.dispute.id,
    shopId: snapshot.dispute.shopId,
    analyzerVersion: ANALYZER_VERSION,
    contractVersion: snapshot.contractVersion,
    snapshotHash: build.hash,
    analysisLevel: build.level.level,
    dataIntegrityLimitation: build.level.dataIntegrityLimitation,
    analysisStatus: "DATA_INTEGRITY_BLOCKED",
    reasonSpecificStatus: "BLOCKED",
    primaryCategory: "DATA_INTEGRITY_FAILURE",
    primaryConfidence: "DEFINITE",
    actionable: true,
    findings: [
      {
        category: "DATA_INTEGRITY_FAILURE",
        confidence: "DEFINITE",
        severity: "HIGH",
        title: "The submission-time snapshot is malformed",
        description: `${reason} No conclusion can be drawn from it.`,
        observedFact: build.contractErrors.join(" "),
        counterfactualImprovement: null,
        actionClass: "DATA_QUALITY",
        evidenceRefs: [],
        ruleRefs: [{ id: "compose.snapshot_contract_failed", version: 1 }],
      },
    ],
    rejectedFindings: [],
    observations: [],
    evidence: [],
    assertions: [],
    summary: {
      outcome: snapshot.outcome.finalOutcome,
      reason: snapshot.dispute.reason,
      networkReasonCode: snapshot.dispute.networkReasonCode,
      paymentProvider: snapshot.provider.paymentProvider,
      providerAccessLevel: snapshot.provider.accessLevel,
      submissionConfirmationSource: snapshot.provider.submissionConfirmationSource,
      findingCount: 1,
      observationCount: 0,
      evidenceCounts: {},
      assertionCounts: {},
      reconstructionGaps: snapshot.reconstructionGaps,
      stagesRun,
    },
  };
}

/** Convenience for callers holding raw inputs rather than a built snapshot. */
export function analyseFromInputs(
  inputs: Parameters<typeof assembleSnapshot>[0],
): ComposedAnalysis {
  return composeAnalysis(assembleSnapshot(inputs));
}
