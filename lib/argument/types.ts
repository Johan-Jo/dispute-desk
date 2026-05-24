/**
 * Argument engine types.
 *
 * Post-retirement (2026-05-16): the legacy rebuttal generator
 * (`responseEngine.ts` + `generateRebuttal.ts` + `generateArgument.ts`)
 * was deleted. The remaining types here back the SURVIVING consumers:
 * case-strength scoring, why-this-case-wins, risk, improvement, and
 * the canonical evidence registry. EvidenceFlags + EvidenceData live
 * here too (moved from the deleted `responseEngine.ts`) because the
 * file-evidence layer's reason-family routing still references them.
 */

export type CaseStrengthLevel = "strong" | "moderate" | "weak" | "insufficient";

/** A localizable token. UI calls `t(key, params)` to render.
 *  `params` values are either pre-localized strings (e.g. from
 *  another `t()` lookup) or simple primitives. Lib functions never
 *  emit free English text alongside this — UIs that need English
 *  for tests/regex can still use the deprecated `strengthReason`
 *  string field, but new render sites should use the token field. */
export interface I18nToken {
  key: string;
  params?: Record<string, string | number>;
}

/* ── Evidence flags + data (moved from responseEngine.ts on 2026-05-16) ── */

export interface EvidenceFlags {
  avs: boolean;
  cvv: boolean;
  tracking: boolean;
  deliveryConfirmed: boolean;
  customerContact: boolean;
  billingShippingMatch: boolean;
  orderConfirmation: boolean;
  customerHistory: boolean;
  policyAttached: boolean;
  refundIssued: boolean;
  refundAmountMatches: boolean;
  cancellationRequest: boolean;
  cancellationConfirmed: boolean;
  disputeWithdrawalEvidence: boolean;
  productDescription: boolean;
  digitalAccessLogs: boolean;
  duplicateChargeEvidence: boolean;
  amountCorrectEvidence: boolean;
}

export interface EvidenceData {
  avsCode?: string | null;
  cvvCode?: string | null;
  cardCompany?: string | null;
  cardLastFour?: string | null;
  gateway?: string | null;
  orderName?: string | null;
  orderDate?: string | null;
  orderAmount?: string | null;
  currency?: string | null;
  billingCity?: string | null;
  shippingCity?: string | null;
  customerSince?: string | null;
  priorOrders?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  shippedDate?: string | null;
  deliveredDate?: string | null;
  /** Recipient name on signature confirmation from carrier tracking
   *  data (AfterShip / Shipway / Wonderment metafields via
   *  lib/shopify/trackingApps.ts). When present, the delivery
   *  paragraph cites the signature explicitly — one of the strongest
   *  possible defenses for FRAUDULENT chargebacks. */
  signedByName?: string | null;
  policyTypes?: string[];
  shopDomain?: string | null;
  // ── Bank-grade rebuttal signals (pack + dispute extract) ──
  authorizationSucceeded?: boolean;
  captureSucceeded?: boolean;
  ipCity?: string | null;
  ipRegion?: string | null;
  ipCountry?: string | null;
  ipOrg?: string | null;
  /** True iff ipinfo.privacy.{vpn, proxy, hosting} are all explicitly false. */
  ipNoVpnProxyHosting?: boolean | null;
  /** true / false / null — null means unknown. */
  ipCountryMatchesShipping?: boolean | null;
  /** Hard prerequisite for emitting the IP/device paragraph. See
   *  `deviceLocationEligibility.ts`. */
  bankEligible?: boolean | null;
  hasOrderConfirmation?: boolean;
  hasCustomerEmail?: boolean;
  hasSupportingDocs?: boolean;
  fraudRiskScreeningPositiveFacts?: string[] | null;
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
  /** Merchant-facing explanation of why this strength was assigned.
   *  Legacy English field — kept for tests and server consumers.
   *  Embedded UI must use `strengthReasonI18n` instead. */
  strengthReason?: string;
  /** i18n token for `strengthReason`. UI translates via `t(key, params)`.
   *  When `params` contains a `*labelKey*` / `*hintKey*` / `*familyKey*`
   *  / `*decisiveKey*`, the UI must resolve those keys to localized
   *  strings FIRST, then pass the resolved strings as the params to
   *  the outer `t()` call. */
  strengthReasonI18n?: I18nToken;
  improvementHint: string | null;
  /** i18n token sibling of `improvementHint`. */
  improvementHintI18n?: I18nToken | null;
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
  heroVariant: "likely_to_win" | "could_win" | "needs_strengthening" | "hard_to_win" | "covered";
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
  /** Risk-weakness gate state (fraud-risk Phase 2). When
   *  `triggered === true` AND not pre-empted by coverage or fatal-loss,
   *  the engine CAPS `overall` at "moderate" (never elevated). If the
   *  underlying scoring already produced "moderate" or "weak" the cap
   *  is a no-op and `strengthReason` is left alone. The pipeline's
   *  existing `auto + moderate → park_for_review` branch handles
   *  routing — no new gate is required.
   *
   *  Diagnostic fields (`riskLevel`, `recommendation`,
   *  `fulfillmentCount`) are persisted to `pack_json.risk_weakness`
   *  for audit. They MUST NEVER appear in bank-rebuttal text, the
   *  evidence PDF, or Shopify disputeEvidence mutations. */
  riskWeakness?: {
    triggered: boolean;
    reason: "high_risk_fulfilled" | null;
    message: string | null;
    diagnostics: {
      riskLevel: string | null;
      recommendation: string | null;
      fulfillmentCount: number;
    };
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
