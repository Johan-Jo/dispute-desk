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
  /** Merchant-facing explanation of why this strength was assigned. */
  strengthReason?: string;
  improvementHint: string | null;
}

/* ── Why This Case Wins ── */

/** A single defense or weakness item paired with the counterclaim that
 *  surfaced it. The ID enables the UI to resolve back to the counterclaim
 *  (for strength pill, supporting/missing field lists) without matching
 *  by display text — which is forbidden under the NO IMPLICIT UI MAPPING
 *  rule (see plan v3 §0). */
export interface WhyWinsItem {
  /** Human-readable description (e.g. "AVS and CVV passed"). */
  text: string;
  /** ID of the counterclaim that surfaced this item. Resolves through
   *  `argumentMap.counterclaimsById` on the workspace API response. */
  counterclaimId: string;
}

export interface WhyWinsResult {
  strengths: WhyWinsItem[];
  weaknesses: WhyWinsItem[];
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
