/**
 * Case strength engine — count-based, canonical-registry-driven.
 *
 * Plan v3 §P2.2 + P2.4 + P2.4a + P2.4b.
 *
 * Replaces the prior ratio-based + per-family-weights model. Scoring
 * is now strict and signal-deduplicated:
 *
 *   strong_count    = unique signalIds whose effective category is `strong`
 *                     among AVAILABLE checklist items
 *   moderate_count  = same for `moderate`
 *   supporting_count = same for `supporting`  (informational only)
 *
 *   IF strong_count >= 2                              → "strong"
 *   ELSE IF strong_count === 1 AND moderate_count >= 1 → "moderate"
 *   ELSE                                              → "weak"
 *
 *   weighted_score  = strong_count * 3 + moderate_count * 2   (P2.1 weights)
 *   coveragePercent = (presentItems / registeredItems) * 100  (legacy UI pill)
 *
 * Hard rules enforced here:
 *   - Categories come ONLY from `lib/argument/canonicalEvidence.ts`.
 *     No per-family overrides, no inline assignments. (P2.4b)
 *   - Supporting items NEVER affect strength under any condition. (P2.1.1)
 *   - Signal-level dedup: multiple `evidenceFieldKey`s sharing a
 *     `signalId` count once. (P2.4)
 *   - Persisted `category` on evidence items is a cache; the engine
 *     re-derives via `categoryFor()` on every call. (P2.4a)
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type {
  CaseStrengthResult,
  CaseStrengthLevel,
  I18nToken,
  ImprovementSignal,
} from "./types";
import {
  CANONICAL_EVIDENCE,
  CATEGORY_WEIGHT,
  affectsStrength,
  categoryFor,
  type EvidenceCategory,
  type SignalId,
} from "./canonicalEvidence";
import { resolveReasonFamily, type ReasonFamily } from "./reasonFamily";

/** Canonical signal → i18n key for the merchant-facing label. The
 *  English string still lives in the registry for tests and server
 *  rendering, but UI render sites must use this map to look up the
 *  translated label via `t("disputes.signalLabel.<signalId>")`. */
const SIGNAL_LABEL_KEY: Record<SignalId, string> = {
  payment_auth: "disputes.signalLabel.payment_auth",
  billing_match: "disputes.signalLabel.billing_match",
  delivery: "disputes.signalLabel.delivery",
  ip_location: "disputes.signalLabel.ip_location",
  device_session: "disputes.signalLabel.device_session",
  communication: "disputes.signalLabel.communication",
  account_history: "disputes.signalLabel.account_history",
  order_record: "disputes.signalLabel.order_record",
  product_listing: "disputes.signalLabel.product_listing",
  policy_refund: "disputes.signalLabel.policy_refund",
  policy_shipping: "disputes.signalLabel.policy_shipping",
  policy_cancellation: "disputes.signalLabel.policy_cancellation",
  duplicate_explanation: "disputes.signalLabel.duplicate_explanation",
  supplementary_documents: "disputes.signalLabel.supplementary_documents",
  fraud_screening: "disputes.signalLabel.fraud_screening",
};

/* ── Per-family merchant-facing copy (template strings only — no
 *     scoring logic) ── */

const STRENGTH_REASONS: Record<ReasonFamily, Record<CaseStrengthLevel, string>> = {
  fraud: {
    strong: "Payment verification and purchase behavior strongly support this defense.",
    moderate: "Core authorization evidence is present, but the case could be strengthened.",
    weak: "Key payment verification evidence is missing.",
    insufficient: "No evidence available to support this defense.",
  },
  delivery: {
    strong: "Shipment and delivery are confirmed by carrier records.",
    moderate: "Shipping evidence exists, but full delivery confirmation would strengthen the case.",
    weak: "Delivery evidence is missing — this is critical for this dispute type.",
    insufficient: "No fulfillment evidence available.",
  },
  product: {
    strong: "Product description and policy disclosure are well documented.",
    moderate: "Some product conformity evidence exists, but gaps remain.",
    weak: "Product description evidence is missing — critical for this dispute type.",
    insufficient: "No product conformity evidence available.",
  },
  refund: {
    strong: "Refund processing is documented.",
    moderate: "Some refund evidence exists, but complete documentation would help.",
    weak: "Refund evidence is incomplete.",
    insufficient: "No refund evidence available.",
  },
  subscription: {
    strong: "Subscription terms and cancellation timeline are documented.",
    moderate: "Some subscription evidence exists, but timeline gaps remain.",
    weak: "Cancellation policy or timeline evidence is missing.",
    insufficient: "No subscription-related evidence available.",
  },
  billing: {
    strong: "Transaction records confirm correct billing.",
    moderate: "Some billing evidence exists, but reconciliation could be stronger.",
    weak: "Billing accuracy evidence is incomplete.",
    insufficient: "No billing evidence available.",
  },
  digital: {
    strong: "Digital access and usage are confirmed by logs.",
    moderate: "Some access evidence exists, but logs could be more complete.",
    weak: "Digital access evidence is missing — critical for this dispute type.",
    insufficient: "No digital delivery evidence available.",
  },
  general: {
    strong: "Core evidence strongly supports this defense.",
    moderate: "Evidence supports the defense, but some gaps remain.",
    weak: "Key evidence is missing.",
    insufficient: "No evidence available.",
  },
};

/* ── strengthReason composition ──
 *
 * The hero copy must agree with the canonical contribution result. A
 * static `STRENGTH_REASONS[family][overall]` lookup cannot — it returns
 * "Key payment verification evidence is missing." even when AVS+CVV is
 * the one Strong contribution we collected. Compose the sentence from
 * the actual rows instead so the hero, "What supports your case", and
 * "Evidence collected" are guaranteed to agree.
 */

interface ContributionRow {
  signalId: SignalId;
  category: "strong" | "moderate";
  label: string;
}

/** Per-family hint about decisive evidence the merchant could still
 *  add. Used in composed strings — never claims something is "missing"
 *  if it's already present. */
function decisiveHintFor(family: ReasonFamily): string {
  switch (family) {
    case "fraud":
      return "delivery confirmation, signature on file, or device-session consistency";
    case "delivery":
      return "carrier signature confirmation or matching billing/IP signals";
    case "product":
      return "the product listing as advertised and your refund policy disclosure";
    case "refund":
      return "documented refund processing or merchant communication";
    case "subscription":
      return "the cancellation policy and customer communication timeline";
    case "billing":
      return "transaction records and AVS+CVV verification";
    case "digital":
      return "access logs proving the customer used the digital good";
    case "general":
    default:
      return "additional decisive evidence";
  }
}

/** Per-family "decisive triplet" used in the WEAK reason composition.
 *  The user spec calls out the fraud triplet explicitly: payment
 *  verification, confirmed delivery, customer purchase acknowledgement.
 *  Other families use parallel construction. Plan v2 §11. */
function decisiveFamiliesFor(family: ReasonFamily): string {
  switch (family) {
    case "fraud":
      return "payment verification, confirmed delivery, or a clear customer purchase acknowledgement";
    case "delivery":
      return "carrier signature confirmation, proof of delivery to the cardholder's verified address, or customer acknowledgement of receipt";
    case "product":
      return "the product listing as advertised, refund policy disclosure, or customer correspondence";
    case "refund":
      return "documented refund processing, refund timeline, or customer correspondence";
    case "subscription":
      return "cancellation policy disclosure, cancellation timeline, or customer correspondence";
    case "billing":
      return "transaction records, AVS/CVV verification, or 3-D Secure authentication";
    case "digital":
      return "access logs showing the customer used the digital good";
    case "general":
    default:
      return "decisive evidence specific to this dispute reason";
  }
}

/** Family label used in the WEAK reason sentence ("no decisive {family}
 *  evidence"). Mirrors the merchant-facing phrasing of the dispute reason. */
function familyLabelFor(family: ReasonFamily): string {
  switch (family) {
    case "fraud":
      return "fraud";
    case "delivery":
      return "delivery";
    case "product":
      return "product-conformity";
    case "refund":
      return "refund";
    case "subscription":
      return "subscription";
    case "billing":
      return "billing";
    case "digital":
      return "digital-good";
    case "general":
    default:
      return "dispute";
  }
}

function joinLabels(labels: string[], conj: "and" | "with" = "and"): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} ${conj} ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, ${conj} ${labels[labels.length - 1]}`;
}

function composeStrengthReason(args: {
  overall: CaseStrengthLevel;
  family: ReasonFamily;
  strong: ContributionRow[];
  moderate: ContributionRow[];
  /** Set when fraud-specific scoring upgraded a case from weak to
   *  moderate solely on avs_cvv_match Strong. Triggers the user-
   *  authored "Payment authentication supports this defense …" copy. */
  isFraudAvsOnlyStrong?: boolean;
}): string {
  const { overall, family, strong, moderate, isFraudAvsOnlyStrong } = args;

  if (overall === "insufficient") {
    return STRENGTH_REASONS[family].insufficient;
  }

  if (overall === "strong") {
    const labels = strong.map((c) => c.label);
    return labels.length >= 2
      ? `${joinLabels(labels.slice(0, 3))} all support this defense decisively.`
      : `${labels[0] ?? "Strong evidence"} supports this defense decisively.`;
  }

  if (overall === "moderate") {
    // Fraud + avs_cvv_match-Strong-alone: this is the canonical
    // "Needs strengthening" case. Tell the merchant what would tip it
    // into Strong.
    if (isFraudAvsOnlyStrong) {
      return "Payment authentication supports this defense, but additional decisive evidence such as delivery confirmation, device/session consistency, or customer confirmation would improve the case.";
    }
    const strongLabel = strong[0]?.label;
    const moderateLabel = moderate[0]?.label;
    if (strongLabel && moderateLabel) {
      return `${strongLabel} and ${moderateLabel} support this defense; additional decisive evidence would strengthen the case.`;
    }
    if (strongLabel) {
      return `${strongLabel} supports this defense, with moderate corroboration; additional decisive evidence would strengthen the case.`;
    }
    return STRENGTH_REASONS[family].moderate;
  }

  // overall === "weak"
  if (strong.length === 1 && moderate.length === 0) {
    return `${strong[0].label} supports this defense, but additional decisive evidence (such as ${decisiveHintFor(family)}) would strengthen the case.`;
  }
  if (strong.length === 0 && moderate.length >= 1) {
    const labels = moderate.slice(0, 2).map((c) => c.label);
    return `${joinLabels(labels)} provide partial support. A strong signal such as ${decisiveHintFor(family)} would significantly strengthen the case.`;
  }
  // strong=0 AND moderate=0 — true "weak" with only supporting context.
  // Compose a truthful sentence that names what's missing using the
  // family-specific decisive triplet. Plan v2 §11.
  const familyLabel = familyLabelFor(family);
  const decisive = decisiveFamiliesFor(family);
  return `This is weak because the defence package contains mostly supporting documentation, but no decisive ${familyLabel} evidence. ${decisive.charAt(0).toUpperCase()}${decisive.slice(1)} would strengthen the case.`;
}

/** i18n-token sibling of `composeStrengthReason`. Emits a structured
 *  `{ key, params }` token where label params are themselves i18n keys
 *  the UI must resolve first, then plug into the outer sentence via
 *  `t(...)` with the pre-translated label string.
 *
 *  The shape mirrors the English composition exactly so the UI can
 *  render the same sentence in any locale. Labels are referenced by
 *  signalId — UI looks them up in `SIGNAL_LABEL_KEY`. */
function composeStrengthReasonI18n(args: {
  overall: CaseStrengthLevel;
  family: ReasonFamily;
  strong: ContributionRow[];
  moderate: ContributionRow[];
  isFraudAvsOnlyStrong?: boolean;
}): I18nToken {
  const { overall, family, strong, moderate, isFraudAvsOnlyStrong } = args;

  if (overall === "insufficient") {
    return { key: `disputes.strengthReason.${family}.insufficient` };
  }

  if (overall === "strong") {
    if (strong.length >= 2) {
      return {
        key: "disputes.strengthReason.strong.multi",
        params: {
          labelKey1: SIGNAL_LABEL_KEY[strong[0].signalId],
          labelKey2: SIGNAL_LABEL_KEY[strong[1].signalId],
          labelKey3: strong[2] ? SIGNAL_LABEL_KEY[strong[2].signalId] : "",
          count: strong.length,
        },
      };
    }
    if (strong[0]) {
      return {
        key: "disputes.strengthReason.strong.single",
        params: { labelKey: SIGNAL_LABEL_KEY[strong[0].signalId] },
      };
    }
    return { key: "disputes.strengthReason.strong.fallback" };
  }

  if (overall === "moderate") {
    if (isFraudAvsOnlyStrong) {
      return { key: "disputes.strengthReason.moderate.fraudAvsOnly" };
    }
    if (strong[0] && moderate[0]) {
      return {
        key: "disputes.strengthReason.moderate.strongAndModerate",
        params: {
          strongLabelKey: SIGNAL_LABEL_KEY[strong[0].signalId],
          moderateLabelKey: SIGNAL_LABEL_KEY[moderate[0].signalId],
        },
      };
    }
    if (strong[0]) {
      return {
        key: "disputes.strengthReason.moderate.strongOnly",
        params: { labelKey: SIGNAL_LABEL_KEY[strong[0].signalId] },
      };
    }
    return { key: `disputes.strengthReason.${family}.moderate` };
  }

  // overall === "weak"
  if (strong.length === 1 && moderate.length === 0) {
    return {
      key: "disputes.strengthReason.weak.strongAlone",
      params: {
        labelKey: SIGNAL_LABEL_KEY[strong[0].signalId],
        hintKey: `disputes.decisiveHint.${family}`,
      },
    };
  }
  if (strong.length === 0 && moderate.length >= 1) {
    return {
      key: "disputes.strengthReason.weak.moderateOnly",
      params: {
        labelKey1: SIGNAL_LABEL_KEY[moderate[0].signalId],
        labelKey2: moderate[1] ? SIGNAL_LABEL_KEY[moderate[1].signalId] : "",
        hintKey: `disputes.decisiveHint.${family}`,
      },
    };
  }
  // strong=0 AND moderate=0 — true "weak" with only supporting context.
  return {
    key: "disputes.strengthReason.weak.supportingOnly",
    params: {
      familyKey: `disputes.familyLabel.${family}`,
      decisiveKey: `disputes.decisiveFamilies.${family}`,
    },
  };
}

/* ── Public API ── */

/**
 * Sources for an evidence item's payload — accepts either a per-field
 * map (workspace API style) or an array (raw evidence_items rows).
 * Both ultimately yield `payload` for `categorizeEvidenceField()`.
 */
export type EvidencePayloadSource =
  | { kind: "byField"; map: Record<string, { payload?: Record<string, unknown> | null } | null | undefined> }
  | { kind: "list"; items: Array<{ payload?: { fieldsProvided?: string[] } & Record<string, unknown> | null }> };

function payloadFor(
  source: EvidencePayloadSource | undefined,
  fieldKey: string,
): Record<string, unknown> | null {
  if (!source) return null;
  if (source.kind === "byField") {
    return (source.map[fieldKey]?.payload ?? null) as Record<string, unknown> | null;
  }
  // List form — find the first item that lists this field.
  for (const it of source.items) {
    const fields = (it.payload?.fieldsProvided as string[] | undefined) ?? [];
    if (fields.includes(fieldKey)) return (it.payload ?? null) as Record<string, unknown> | null;
  }
  return null;
}

/** Optional Coverage Gate input (PRD §4). Highest-priority routing
 *  signal — when `state === "covered_shopify"` the hero variant is
 *  forced to `covered` and `strengthReason` is replaced with covered
 *  copy. Underlying `overall` / counts are still computed normally so
 *  diagnostics keep working; UI consumers must read coverage first. */
export interface CaseCoverageInput {
  state: "covered_shopify" | "not_covered";
  shopifyProtectStatus:
    | "ACTIVE"
    | "INACTIVE"
    | "NOT_PROTECTED"
    | "PENDING"
    | "PROTECTED"
    | null;
}

/** Optional Fatal-loss Gate input (PRD §5). Caps `overall` at "weak"
 *  and replaces `strengthReason` with the fatal-loss copy. Coverage
 *  beats fatal-loss (a covered case is never "fatal"; Shopify pays).
 *  Otherwise this triggers regardless of the underlying evidence. */
export interface CaseFatalLossInput {
  triggered: boolean;
  reason: "refund_issued" | "inr_no_fulfillment" | null;
  message: string | null;
}

/** Optional Risk-weakness Gate input (fraud-risk Phase 2). When
 *  triggered AND not pre-empted by coverage or fatal-loss, CAPS
 *  `overall` at "moderate" — never elevates. The cap is a ceiling, so
 *  if the underlying scoring already produced "moderate" / "weak" the
 *  cap is a no-op. The merchant-facing message replaces
 *  `strengthReason` ONLY when the cap actually fires (i.e. scoring
 *  would have been "strong"). */
export interface CaseRiskWeaknessInput {
  triggered: boolean;
  reason: "high_risk_fulfilled" | null;
  message: string | null;
  diagnostics: {
    riskLevel: string | null;
    recommendation: string | null;
    fulfillmentCount: number;
  };
}

const COVERED_STRENGTH_REASON =
  "This dispute is protected under Shopify's payment protection. No action is required from you.";

export function calculateCaseStrength(
  checklist: ChecklistItemV2[],
  reason?: string | null,
  /** Optional payload source for conditional categorization (delivery
   *  proofType, AVS/CVV codes, IP location flags). When omitted,
   *  conditional fields collapse to their best-case default category
   *  per the canonical registry. Pass the workspace's
   *  `pack.evidenceItemsByField` map for accurate scoring. */
  payloadSource?: EvidencePayloadSource,
  /** Optional Coverage Gate input. When `covered_shopify`, the hero
   *  variant is forced to `covered` and the strength reason is replaced
   *  with the covered-by-Shopify copy. */
  coverage?: CaseCoverageInput,
  /** Optional Fatal-loss Gate input. When `triggered === true` AND
   *  coverage is not active, `overall` is capped at "weak", `heroVariant`
   *  becomes "hard_to_win", and `strengthReason` is replaced with the
   *  fatal-loss message. */
  fatalLoss?: CaseFatalLossInput,
  /** Optional Risk-weakness Gate input (fraud-risk Phase 2). When
   *  `triggered === true` AND not pre-empted by coverage or fatal-loss,
   *  caps `overall` at "moderate" (cap-as-ceiling — never elevates).
   *  Routes through the existing auto + moderate → park_for_review
   *  pipeline branch; no new gate required. */
  riskWeakness?: CaseRiskWeaknessInput,
): CaseStrengthResult {
  const family = resolveReasonFamily(reason);

  if (!checklist.length) {
    const earlyCovered = coverage?.state === "covered_shopify";
    const earlyFatal = !earlyCovered && fatalLoss?.triggered === true;
    return {
      overall: earlyFatal ? "weak" : "insufficient",
      score: 0,
      coveragePercent: 0,
      strongCount: 0,
      moderateCount: 0,
      supportingCount: 0,
      supportedClaims: 0,
      totalClaims: 0,
      improvementHint: null,
      improvementHintI18n: null,
      heroVariant: earlyCovered ? "covered" : "hard_to_win",
      strengthReason: earlyCovered
        ? COVERED_STRENGTH_REASON
        : earlyFatal
          ? (fatalLoss?.message ?? STRENGTH_REASONS[family].weak)
          : STRENGTH_REASONS[family].insufficient,
      strengthReasonI18n: earlyCovered
        ? { key: "disputes.strengthReason.covered" }
        : earlyFatal
          ? (fatalLoss?.reason
              ? { key: `disputes.strengthReason.fatalLoss.${fatalLoss.reason}` }
              : { key: `disputes.strengthReason.${family}.weak` })
          : { key: `disputes.strengthReason.${family}.insufficient` },
      coverage: coverage ?? undefined,
      fatalLoss: fatalLoss ?? undefined,
      // No checklist → no scoring → the risk-weakness cap is a no-op
      // here. The diagnostic block still propagates for audit.
      riskWeakness: riskWeakness ?? undefined,
    };
  }

  // Track the BEST category seen per signalId, deduplicating across
  // evidence fields that share a signal (P2.4 dedup rule).
  // strong > moderate > supporting.
  const RANK: Record<EvidenceCategory, number> = {
    strong: 3,
    moderate: 2,
    supporting: 1,
    invalid: 0,
  };
  // Per-signal accumulator: best category + label of the first
  // contributing evidence field (used for strengthReason composition).
  type SignalAcc = { category: EvidenceCategory; label: string };
  const bestBySignalDetailed = new Map<SignalId, SignalAcc>();

  let registeredItems = 0; // canonical fields visible in the checklist
  let presentItems = 0;    // available or waived
  let missingActionableTopField: { field: string; category: EvidenceCategory } | null = null;
  const missingRank = (c: EvidenceCategory): number => (c === "strong" ? 3 : c === "moderate" ? 2 : 0);

  for (const item of checklist) {
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue; // Field not in the registry — ignored everywhere.
    registeredItems++;

    const isAvailable = item.status === "available" || item.status === "waived";
    const isMissing = item.status === "missing";

    if (isAvailable) {
      presentItems++;
      const category = categoryFor({ fieldKey: item.field, payload: payloadFor(payloadSource, item.field) });
      // Supporting and invalid contribute nothing to scoring.
      if (!affectsStrength(category)) continue;
      const prev = bestBySignalDetailed.get(spec.signalId);
      if (!prev || RANK[category] > RANK[prev.category]) {
        bestBySignalDetailed.set(spec.signalId, { category, label: spec.label });
      }
    } else if (isMissing && (item.collectionType === "manual" || !item.collectionType)) {
      // Track the highest-default-category missing actionable field for
      // the improvement hint. We use the spec's default category (best
      // case) since we don't have a payload to evaluate.
      const candidateCat = spec.category;
      if (!affectsStrength(candidateCat)) continue;
      if (!missingActionableTopField || missingRank(candidateCat) > missingRank(missingActionableTopField.category)) {
        missingActionableTopField = { field: item.field, category: candidateCat };
      }
    }
  }

  // Build contribution row lists for strengthReason composition.
  // Same data the workspace UI reads via `computeContributions` —
  // guaranteed to agree with "What supports your case" and "Evidence
  // collected" because it comes from the same per-signal verdict.
  const strongRows: ContributionRow[] = [];
  const moderateRows: ContributionRow[] = [];
  for (const [signalId, acc] of bestBySignalDetailed) {
    if (acc.category === "strong") {
      strongRows.push({ signalId, category: "strong", label: acc.label });
    } else if (acc.category === "moderate") {
      moderateRows.push({ signalId, category: "moderate", label: acc.label });
    }
  }
  const strongCount = strongRows.length;
  const moderateCount = moderateRows.length;

  // Supporting count — informational; not used by the scorer.
  let supportingCount = 0;
  for (const item of checklist) {
    if (item.status !== "available" && item.status !== "waived") continue;
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue;
    const cat = categoryFor({ fieldKey: item.field, payload: payloadFor(payloadSource, item.field) });
    if (cat === "supporting") supportingCount++;
  }

  // Family-specific scoring. Fraud / unauthorized-transaction disputes
  // are decided primarily by payment authentication; if AVS+CVV is
  // Strong the case can never be Weak even when no other decisive
  // signal exists. Other families fall back to the strict count-based
  // formula (P2.2).
  const strongSignalIds = new Set(strongRows.map((r) => r.signalId));
  const moderateSignalIds = new Set(moderateRows.map((r) => r.signalId));
  const hasAvsStrong = strongSignalIds.has("payment_auth");
  const hasDeliverySupport =
    strongSignalIds.has("delivery") || moderateSignalIds.has("delivery");
  const hasDeviceSupport =
    strongSignalIds.has("device_session") || moderateSignalIds.has("device_session");
  const hasCommunicationStrong = strongSignalIds.has("communication");

  // FRAUD_DECISIVE_SIGNALS — the only signals that can elevate a fraud
  // case to Strong on count alone. Policies, order receipts, supporting
  // documents (etc.) cannot make a fraud case strong by themselves,
  // even when each happens to land as `strong` per the canonical
  // categorizer (e.g. policy_refund with acceptedAtCheckout=true).
  //
  // Without this filter, three policies-accepted-at-checkout rows would
  // count as `strongCount === 3` and the `>=2` branch would label the
  // case Strong — but for an unauthorized-transaction dispute, policy
  // acceptance proves nothing about cardholder identity. The user-spec
  // explicitly forbids this elevation.
  const FRAUD_DECISIVE_SIGNALS = new Set<SignalId>([
    "payment_auth",
    "delivery",
    "device_session",
    "communication",
    "account_history",
  ]);
  const strongCountFromFraudSignals = strongRows.filter((r) =>
    FRAUD_DECISIVE_SIGNALS.has(r.signalId),
  ).length;
  const moderateCountFromFraudSignals = moderateRows.filter((r) =>
    FRAUD_DECISIVE_SIGNALS.has(r.signalId),
  ).length;

  let overall: CaseStrengthLevel;
  let isFraudAvsOnlyStrong = false;
  if (family === "fraud") {
    if (
      strongCountFromFraudSignals >= 2 ||
      (hasAvsStrong && (hasDeliverySupport || hasDeviceSupport || hasCommunicationStrong))
    ) {
      overall = "strong";
    } else if (
      hasAvsStrong ||
      (strongCountFromFraudSignals === 1 && moderateCountFromFraudSignals >= 1) ||
      moderateCountFromFraudSignals >= 2
    ) {
      overall = "moderate";
      // Flag the AVS-Strong-alone path so the hero can show "Needs
      // strengthening" instead of "Could win" — same tone, different
      // accent on what's required next.
      isFraudAvsOnlyStrong =
        hasAvsStrong &&
        strongCountFromFraudSignals === 1 &&
        moderateCountFromFraudSignals === 0;
    } else {
      overall = "weak";
    }
  } else {
    if (strongCount >= 2) overall = "strong";
    else if (strongCount === 1 && moderateCount >= 1) overall = "moderate";
    else overall = "weak";
  }

  // Weighted sum (P2.1 weights). Replaces the legacy 0-100 ratio
  // semantically — but the legacy 0-100 lives on as `coveragePercent`
  // for the UI's coverage pill.
  const score = strongCount * CATEGORY_WEIGHT.strong + moderateCount * CATEGORY_WEIGHT.moderate;
  const coveragePercent = registeredItems > 0
    ? Math.round((presentItems / registeredItems) * 100)
    : 0;

  // Improvement hint (highest-default-category missing actionable).
  let improvementHint: string | null = null;
  let improvementHintI18n: I18nToken | null = null;
  if (overall !== "strong" && missingActionableTopField) {
    const label = CANONICAL_EVIDENCE[missingActionableTopField.field]?.label ?? missingActionableTopField.field;
    improvementHint = `Add ${label.toLowerCase()} to strengthen your case.`;
    const spec = CANONICAL_EVIDENCE[missingActionableTopField.field];
    if (spec) {
      improvementHintI18n = {
        key: "disputes.improvementHint",
        params: { labelKey: SIGNAL_LABEL_KEY[spec.signalId] },
      };
    }
  }

  // Compose strengthReason from the actual contributions instead of a
  // static per-family table. Guarantees the hero copy never claims a
  // signal is "missing" when it's already in the contribution list.
  const strengthReason = composeStrengthReason({
    overall,
    family,
    strong: strongRows,
    moderate: moderateRows,
    isFraudAvsOnlyStrong,
  });
  const strengthReasonI18nToken = composeStrengthReasonI18n({
    overall,
    family,
    strong: strongRows,
    moderate: moderateRows,
    isFraudAvsOnlyStrong,
  });

  // UI hero variant. `needs_strengthening` is the fraud-specific
  // moderate-from-avs path: one decisive signal but no corroboration
  // — same amber tone as could_win, but the label tells the merchant
  // what's required next. Other variants follow `overall`.
  // Coverage Gate (PRD §4) takes precedence over everything: when
  // Shopify Protect is actively underwriting the dispute, the hero
  // shows the "Covered" state regardless of underlying evidence.
  // Fatal-loss Gate (PRD §5) is next-priority — coverage beats fatal-
  // loss, but otherwise a triggered fatal-loss caps overall at "weak"
  // and forces hard_to_win.
  const isCovered = coverage?.state === "covered_shopify";
  const isFatalLoss = !isCovered && fatalLoss?.triggered === true;

  if (isFatalLoss) {
    overall = "weak";
    isFraudAvsOnlyStrong = false;
  }

  // Risk-weakness gate is RECEIVED as input (so callers can persist
  // diagnostics to pack_json for internal analytics + support
  // debugging) but DOES NOT cap `overall`. Decision 2026-05-15: the
  // merchant-facing surfaces (banner, email callout, strength reason
  // override) were dropped because flagging Shopify's pre-auth risk
  // score doesn't change what the merchant can do — the case is
  // either defensible or not based on AVS/CVV/delivery/auth evidence,
  // regardless of the risk score at checkout. Auto-mode continues to
  // submit on Strong cases even when risk-weakness would have fired.

  let heroVariant: NonNullable<CaseStrengthResult["heroVariant"]>;
  if (isCovered) heroVariant = "covered";
  else if (isFatalLoss) heroVariant = "hard_to_win";
  else if (overall === "strong") heroVariant = "likely_to_win";
  else if (overall === "moderate") {
    heroVariant = isFraudAvsOnlyStrong ? "needs_strengthening" : "could_win";
  } else heroVariant = "hard_to_win";

  const finalStrengthReason = isCovered
    ? COVERED_STRENGTH_REASON
    : isFatalLoss
      ? (fatalLoss?.message ?? STRENGTH_REASONS[family].weak)
      : strengthReason;
  const finalStrengthReasonI18n: I18nToken = isCovered
    ? { key: "disputes.strengthReason.covered" }
    : isFatalLoss
      ? (fatalLoss?.reason
          ? { key: `disputes.strengthReason.fatalLoss.${fatalLoss.reason}` }
          : { key: `disputes.strengthReason.${family}.weak` })
      : strengthReasonI18nToken;

  return {
    overall,
    score,
    coveragePercent,
    strongCount,
    moderateCount,
    supportingCount,
    supportedClaims: 0,
    totalClaims: 0,
    improvementHint: isCovered || isFatalLoss ? null : improvementHint,
    improvementHintI18n: isCovered || isFatalLoss ? null : improvementHintI18n,
    heroVariant,
    strengthReason: finalStrengthReason,
    strengthReasonI18n: finalStrengthReasonI18n,
    coverage: coverage ?? undefined,
    fatalLoss: fatalLoss ?? undefined,
    riskWeakness: riskWeakness ?? undefined,
  };
}

/* ── Contributions for "What supports your case" (plan v3 §P2.6) ── */

/** A single row in the "What supports your case" surface. Maps 1:1 to
 *  a canonical signalId and a single category. NO summary rows, NO
 *  multi-signal grouping (Argument Purity Rule, P2.6). */
export interface CaseStrengthContribution {
  /** Stable cross-collection ID used by the UI for keys. */
  signalId: SignalId;
  /** Effective category for this signal (after dedup). Always
   *  `strong` or `moderate` — supporting and invalid never reach
   *  these lists. */
  category: "strong" | "moderate";
  /** Merchant-facing label from the canonical registry. */
  label: string;
  /** The first contributing `evidenceFieldKey` (when a single
   *  signalId is reachable through multiple keys). Used by deep-link
   *  CTAs. */
  evidenceFieldKey: string;
}

export interface CaseStrengthContributions {
  strong: CaseStrengthContribution[];
  moderate: CaseStrengthContribution[];
}

/**
 * Compute the "What supports your case" rows for the dispute Overview.
 * Plan v3 §P2.6 — one row per canonical signalId with effective
 * category `strong` or `moderate`, deduplicated, no synthesis. Only
 * AVAILABLE / WAIVED items contribute.
 */
export function computeContributions(
  checklist: ChecklistItemV2[],
  payloadSource?: EvidencePayloadSource,
): CaseStrengthContributions {
  // Per signalId: track the highest category seen + the first field
  // that contributed it (deterministic by checklist iteration order).
  type Acc = { category: EvidenceCategory; field: string };
  const RANK: Record<EvidenceCategory, number> = { strong: 3, moderate: 2, supporting: 1, invalid: 0 };
  const bySignal = new Map<SignalId, Acc>();

  for (const item of checklist) {
    if (item.status !== "available" && item.status !== "waived") continue;
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue;
    const category = categoryFor({ fieldKey: item.field, payload: payloadFor(payloadSource, item.field) });
    if (category !== "strong" && category !== "moderate") continue;
    const prev = bySignal.get(spec.signalId);
    if (!prev || RANK[category] > RANK[prev.category]) {
      bySignal.set(spec.signalId, { category, field: item.field });
    }
  }

  const strong: CaseStrengthContribution[] = [];
  const moderate: CaseStrengthContribution[] = [];
  for (const [signalId, acc] of bySignal) {
    const spec = CANONICAL_EVIDENCE[acc.field];
    const row: CaseStrengthContribution = {
      signalId,
      category: acc.category as "strong" | "moderate",
      label: spec?.label ?? acc.field,
      evidenceFieldKey: acc.field,
    };
    if (acc.category === "strong") strong.push(row);
    else moderate.push(row);
  }

  return { strong, moderate };
}

/**
 * Highest-leverage missing-evidence improvement suggestion.
 * Now keyed by canonical category instead of family weights.
 */
export function calculateImprovement(
  checklist: ChecklistItemV2[],
  reason: string | null | undefined,
  payloadSource?: EvidencePayloadSource,
): ImprovementSignal | null {
  // Find the missing actionable field whose canonical default category
  // is highest (strong > moderate). Supporting fields don't help
  // strength so we skip them entirely.
  let bestField: string | null = null;
  let bestCategory: EvidenceCategory | null = null;
  const rank = (c: EvidenceCategory): number => (c === "strong" ? 3 : c === "moderate" ? 2 : 0);

  for (const item of checklist) {
    if (item.status !== "missing") continue;
    if (item.collectionType !== "manual" && item.collectionType) continue;
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue;
    const cat = spec.category;
    if (!affectsStrength(cat)) continue;
    if (!bestCategory || rank(cat) > rank(bestCategory)) {
      bestCategory = cat;
      bestField = item.field;
    }
  }

  if (!bestField || !bestCategory) return null;

  const label = CANONICAL_EVIDENCE[bestField]?.label ?? bestField;
  const current = calculateCaseStrength(checklist, reason, payloadSource);
  if (current.overall === "strong") return null;

  // Estimate next strength under the count formula. Adding a single
  // strong takes a 0-strong case to 1-strong (still weak unless a
  // moderate is also present). Adding a single moderate to a 1-strong
  // case produces "moderate" overall.
  const potential: CaseStrengthLevel = (() => {
    const ns = current.strongCount + (bestCategory === "strong" ? 1 : 0);
    const nm = current.moderateCount + (bestCategory === "moderate" ? 1 : 0);
    if (ns >= 2) return "strong";
    if (ns === 1 && nm >= 1) return "moderate";
    return "weak";
  })();

  return {
    currentStrength: current.overall,
    potentialStrength: potential,
    action: `Add ${label}`,
    field: bestField,
  };
}
