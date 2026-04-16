/**
 * Argument engine types.
 *
 * An argument is a structured response to a dispute claim:
 * issuer claim → merchant counterclaims → supporting evidence → gaps.
 */

/* ── Argument Map ── */

export interface ArgumentMap {
  issuerClaim: {
    text: string;
    reasonCode: string;
  };
  counterclaims: CounterclaimNode[];
  overallStrength: CaseStrengthLevel;
}

export interface CounterclaimNode {
  id: string;
  title: string;
  strength: CaseStrengthLevel;
  supporting: Array<{
    field: string;
    label: string;
    status: "available" | "waived";
  }>;
  /** System-derived evidence that is not present (informational, not actionable). */
  systemUnavailable: Array<{
    field: string;
    label: string;
  }>;
  /** Merchant-actionable evidence that can be added. */
  missing: Array<{
    field: string;
    label: string;
    impact: "high" | "medium" | "low";
  }>;
}

export type CaseStrengthLevel = "strong" | "moderate" | "weak" | "insufficient";

/* ── Rebuttal ── */

export interface RebuttalDraft {
  sections: RebuttalSection[];
  source: "generated" | "edited";
}

export interface RebuttalSection {
  id: string;
  type: "summary" | "claim" | "conclusion";
  claimId?: string;
  text: string;
  evidenceRefs: string[];
}

/* ── Case Strength ── */

export interface CaseStrengthResult {
  overall: CaseStrengthLevel;
  score: number;
  supportedClaims: number;
  totalClaims: number;
  improvementHint: string | null;
}

/* ── Why This Case Wins ── */

export interface WhyWinsResult {
  strengths: string[];
  weaknesses: string[];
  overall: CaseStrengthLevel;
}

/* ── Risk ── */

export interface RiskResult {
  expectedOutcome: CaseStrengthLevel;
  risks: string[];
}

/* ── Improvement ── */

export interface ImprovementSignal {
  currentStrength: CaseStrengthLevel;
  potentialStrength: CaseStrengthLevel;
  action: string;
  field: string;
}

/* ── Next Action ── */

export interface NextAction {
  label: string;
  description: string;
  targetTab?: 0 | 1 | 2;
  targetField?: string;
  severity: "info" | "warning" | "critical";
}

/* ── Template ── */

export interface ArgumentTemplate {
  disputeType: string;
  toWin: string[];
  strongestEvidence: string[];
  counterclaims: CounterclaimTemplate[];
}

export interface CounterclaimTemplate {
  id: string;
  title: string;
  requiredEvidence: string[];
  supportingEvidence: string[];
}

/* ── Missing Item Context ── */

export interface MissingItemWithContext {
  field: string;
  label: string;
  priority: "critical" | "recommended" | "optional";
  impact: string;
  source: string;
  effort: "low" | "medium" | "high";
  recommendation: string;
  /** How to add this evidence. */
  actionType: "upload" | "paste" | "note";
  /** Primary CTA label. */
  ctaLabel: string;
  /** Accepted formats. */
  acceptedFormats: string;
  /** Secondary option label. */
  skipLabel: string;
}
