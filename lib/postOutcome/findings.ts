/**
 * Draft findings, and the rules every finding must satisfy before it is stored.
 *
 * Plan §8, §9, §10. A "draft" finding is one a check produced but no reviewer
 * has seen; it is a hypothesis until confirmed (plan §17) and the admin surface
 * labels it as such.
 *
 * `validateFinding` is the schema validator of plan §12. It is not decoration:
 * the whole feature's value is that its claims are bounded by what the record
 * proves, and the two ways that breaks are a fabricated causal claim and a
 * confident assertion with nothing to chase. Both are refused here, and the
 * database refuses them again (see the migration's check constraints).
 */

import {
  findCausalLanguageViolations,
  type ActionClass,
  type AnalysisLevel,
  type AnalyzableOutcome,
  type ConfidenceLevel,
  type FindingCategory,
  type SeverityLevel,
  EVIDENCE_EFFECTIVENESS_LEVELS,
  WIN_ONLY_CATEGORIES,
} from "./taxonomy";

export interface EvidenceRef {
  /** Snapshot evidence id, e.g. `fact:f1` or `gorgias:g-1`. */
  id: string;
  note?: string;
}

export interface RuleRef {
  id: string;
  version: number;
}

export interface DraftFinding {
  category: FindingCategory;
  confidence: ConfidenceLevel;
  severity: SeverityLevel;
  title: string;
  description: string;
  /** What the retained record PROVES. Never a hypothesis. */
  observedFact: string;
  /** What a future process could do better. Never "this would have won". */
  counterfactualImprovement: string | null;
  actionClass: ActionClass;
  evidenceRefs: EvidenceRef[];
  ruleRefs: RuleRef[];
}

/**
 * A non-defect fact worth showing an admin.
 *
 * Kept separate from findings on purpose. A finding asserts a defect and names
 * an owner; an observation asserts neither. The platform forwarding our
 * evidence after its own deadline is the motivating case: it is striking, it is
 * measurable, and it is not something we did wrong — filing it as a finding
 * would put a defect and an action class on behaviour we do not control and
 * cannot attribute an outcome to.
 */
export interface LifecycleObservation {
  key: string;
  summary: string;
  detail: string;
}

export interface FindingValidationContext {
  outcome: AnalyzableOutcome;
  analysisLevel: AnalysisLevel;
}

/** Returns the reasons a finding may not be stored. Empty means storable. */
export function validateFinding(
  finding: DraftFinding,
  context: FindingValidationContext,
): string[] {
  const errors: string[] = [];

  // Plan §9: no fabricated bank rationale, no counterfactual win claim.
  for (const [field, text] of [
    ["title", finding.title],
    ["description", finding.description],
    ["observedFact", finding.observedFact],
    ["counterfactualImprovement", finding.counterfactualImprovement ?? ""],
  ] as const) {
    const violations = findCausalLanguageViolations(text);
    if (violations.length > 0) {
      errors.push(
        `${field} uses causal language the record cannot support: ${violations
          .map((r) => r.source)
          .join(", ")}`,
      );
    }
  }

  // Plan §9: a DEFINITE or HIGH finding must carry provenance.
  if (
    (finding.confidence === "DEFINITE" || finding.confidence === "HIGH") &&
    finding.evidenceRefs.length === 0 &&
    finding.ruleRefs.length === 0
  ) {
    errors.push(
      `${finding.confidence} finding carries no evidence or rule references`,
    );
  }

  // Plan §8: win-only categories need a won outcome AND an analysis level that
  // permits an evidence-effectiveness claim. The sole prod win is
  // PACKAGE_INTEGRITY_ONLY — saved but never forwarded — so a "winning
  // configuration" learned from it would come from a package no adjudicator saw.
  if (WIN_ONLY_CATEGORIES.has(finding.category)) {
    if (context.outcome !== "won") {
      errors.push(`${finding.category} requires a won outcome`);
    }
    if (!EVIDENCE_EFFECTIVENESS_LEVELS.has(context.analysisLevel)) {
      errors.push(
        `${finding.category} requires an analysis level that permits evidence-effectiveness conclusions, not ${context.analysisLevel}`,
      );
    }
  }

  if (finding.actionClass === "NO_ACTION" && finding.counterfactualImprovement) {
    errors.push("NO_ACTION finding must not propose an improvement");
  }

  return errors;
}

/** At most one primary finding, ranked by severity then confidence (plan §8). */
const SEVERITY_ORDER: Record<SeverityLevel, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};
const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = {
  DEFINITE: 0,
  HIGH: 1,
  MODERATE: 2,
  LOW: 3,
};

export function selectPrimaryFinding(
  findings: readonly DraftFinding[],
): DraftFinding | null {
  if (findings.length === 0) return null;
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
  })[0];
}
