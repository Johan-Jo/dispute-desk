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
  /** Server-built ID-keyed lookup. Plan v3 §3.A.5: cross-collection
   *  references must resolve through this map, never by `title`,
   *  array position, or substring matching. Optional for back-compat
   *  with consumers that still scan the array. */
  counterclaimsById?: Record<string, CounterclaimNode>;
  overallStrength: CaseStrengthLevel;
}

export interface CounterclaimNode {
  id: string;
  title: string;
  strength: CaseStrengthLevel;
  supporting: Array<{
    /** @deprecated use `evidenceFieldKey`. Retained for back-compat. */
    field: string;
    /** Stable cross-collection ID. Plan v3 §3.A.5. */
    evidenceFieldKey?: string;
    label: string;
    status: "available" | "waived";
  }>;
  /** System-derived evidence that is not present (informational, not actionable). */
  systemUnavailable: Array<{
    /** @deprecated use `evidenceFieldKey`. Retained for back-compat. */
    field: string;
    /** Stable cross-collection ID. Plan v3 §3.A.5. */
    evidenceFieldKey?: string;
    label: string;
  }>;
  /** Merchant-actionable evidence that can be added. */
  missing: Array<{
    /** @deprecated use `evidenceFieldKey`. Retained for back-compat. */
    field: string;
    /** Stable cross-collection ID. Plan v3 §3.A.5. */
    evidenceFieldKey?: string;
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
  /** Weighted sum: strongCount * 3 + moderateCount * 2.
   *  Plan v3 §P2.1 weights. Replaces the legacy 0-100 ratio
   *  semantically; the ratio is preserved as `coveragePercent`. */
  score: number;
  /** Legacy 0-100 evidence-coverage ratio (presentItems /
   *  registeredItems). Plan v3 §P2.10 D2 — kept as a back-compat
   *  shim so the UI's coverage pill keeps rendering. NOT used to
   *  decide `overall`. */
  coveragePercent: number;
  /** Unique `signalId`s whose effective category is `strong` among
   *  AVAILABLE checklist items. The basis for `overall`. */
  strongCount: number;
  /** Unique `signalId`s whose effective category is `moderate`
   *  among AVAILABLE checklist items. */
  moderateCount: number;
  /** Unique AVAILABLE supporting items (informational only —
   *  cannot affect `overall`). Plan v3 §P2.1.1. */
  supportingCount: number;
  supportedClaims: number;
  totalClaims: number;
  /** Merchant-facing explanation of why this strength was assigned. */
  strengthReason?: string;
  improvementHint: string | null;
  /** Hero label hint. Lets the UI distinguish:
   *   - `likely_to_win` — overall === "strong"
   *   - `could_win` — overall === "moderate" via the standard formula
   *   - `needs_strengthening` — fraud + avs_cvv_match Strong alone (one
   *     decisive signal, but no corroboration). Same amber tone as
   *     `could_win` but a different accent on what's needed next.
   *   - `hard_to_win` — overall === "weak" or "insufficient"
   *   - `covered` — Coverage Gate is active (Shopify Protect). Hero
   *     overrides everything else; merchant takes no action.
   * The UI is the only consumer; backend logic should keep using
   * `overall` for branching.
   */
  heroVariant?: "likely_to_win" | "could_win" | "needs_strengthening" | "hard_to_win" | "covered";
  /** Coverage gate state. When `state === "covered_shopify"`, the
   *  merchant has no workflow — `heroVariant` is forced to `covered`
   *  and `strengthReason` is replaced with the covered copy. */
  coverage?: {
    state: "covered_shopify" | "not_covered";
    shopifyProtectStatus:
      | "ACTIVE"
      | "INACTIVE"
      | "NOT_PROTECTED"
      | "PENDING"
      | "PROTECTED"
      | null;
  };
  /** Fatal-loss gate state (PRD §5). When `triggered === true`,
   *  `overall` is capped at "weak", `heroVariant` becomes "hard_to_win",
   *  and `strengthReason` is replaced with the fatal-loss copy. The
   *  pipeline blocks auto-submission for these cases regardless of the
   *  underlying evidence. */
  fatalLoss?: {
    triggered: boolean;
    reason: "refund_issued" | "inr_no_fulfillment" | null;
    message: string | null;
  };
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
  /**
   * Title used when ALL `requiredEvidence` is present (fully-supported
   * claim). Must accurately describe what every required field
   * collectively proves. If the title asserts multiple facts, ALL of
   * those facts must be backed by entries in `requiredEvidence`.
   */
  title: string;
  requiredEvidence: string[];
  supportingEvidence: string[];
  /**
   * Optional fallback titles when only a subset of `requiredEvidence`
   * is present. Key = sorted, comma-joined list of present-required
   * fields. Lets a claim re-headline when partial evidence forces a
   * Moderate rating, so the merchant never reads a title that
   * over-states the proof. Example for FRAUDULENT fraud-2:
   *   { "shipping_tracking": "Order was shipped to the customer" }
   * applies when only tracking is present (no delivery_proof). When
   * no entry matches, falls back to `title`.
   */
  partialTitles?: Record<string, string>;
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
