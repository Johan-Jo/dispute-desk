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
  ArgumentMap,
  CaseStrengthResult,
  CaseStrengthLevel,
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
import { resolveReasonFamily, type ReasonFamily } from "./responseEngine";

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

export function calculateCaseStrength(
  argumentMap: ArgumentMap | null,
  checklist: ChecklistItemV2[],
  reason?: string | null,
  /** Optional payload source for conditional categorization (delivery
   *  proofType, AVS/CVV codes, IP location flags). When omitted,
   *  conditional fields collapse to their best-case default category
   *  per the canonical registry. Pass the workspace's
   *  `pack.evidenceItemsByField` map for accurate scoring. */
  payloadSource?: EvidencePayloadSource,
): CaseStrengthResult {
  const family = resolveReasonFamily(reason ?? argumentMap?.issuerClaim?.reasonCode);

  if (!checklist.length) {
    return {
      overall: "insufficient",
      score: 0,
      coveragePercent: 0,
      strongCount: 0,
      moderateCount: 0,
      supportingCount: 0,
      supportedClaims: 0,
      totalClaims: argumentMap?.counterclaims.length ?? 0,
      improvementHint: null,
      strengthReason: STRENGTH_REASONS[family].insufficient,
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
  const bestBySignal = new Map<SignalId, EvidenceCategory>();

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
      const prev = bestBySignal.get(spec.signalId) ?? "invalid";
      if (RANK[category] > RANK[prev]) bestBySignal.set(spec.signalId, category);
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

  let strongCount = 0;
  let moderateCount = 0;
  for (const cat of bestBySignal.values()) {
    if (cat === "strong") strongCount++;
    else if (cat === "moderate") moderateCount++;
  }

  // Supporting count — informational; not used by the scorer.
  let supportingCount = 0;
  for (const item of checklist) {
    if (item.status !== "available" && item.status !== "waived") continue;
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue;
    const cat = categoryFor({ fieldKey: item.field, payload: payloadFor(payloadSource, item.field) });
    if (cat === "supporting") supportingCount++;
  }

  // Strict count-based formula (P2.2).
  let overall: CaseStrengthLevel;
  if (strongCount >= 2) overall = "strong";
  else if (strongCount === 1 && moderateCount >= 1) overall = "moderate";
  else overall = "weak";

  // Weighted sum (P2.1 weights). Replaces the legacy 0-100 ratio
  // semantically — but the legacy 0-100 lives on as `coveragePercent`
  // for the UI's coverage pill.
  const score = strongCount * CATEGORY_WEIGHT.strong + moderateCount * CATEGORY_WEIGHT.moderate;
  const coveragePercent = registeredItems > 0
    ? Math.round((presentItems / registeredItems) * 100)
    : 0;

  // Improvement hint (highest-default-category missing actionable).
  let improvementHint: string | null = null;
  if (overall !== "strong" && missingActionableTopField) {
    const label = CANONICAL_EVIDENCE[missingActionableTopField.field]?.label ?? missingActionableTopField.field;
    improvementHint = `Add ${label.toLowerCase()} to strengthen your case.`;
  }

  const strengthReason = STRENGTH_REASONS[family][overall];

  return {
    overall,
    score,
    coveragePercent,
    strongCount,
    moderateCount,
    supportingCount,
    supportedClaims: argumentMap?.counterclaims.filter((c) => c.supporting.length > 0).length ?? 0,
    totalClaims: argumentMap?.counterclaims.length ?? 0,
    improvementHint,
    strengthReason,
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
  argumentMap: ArgumentMap | null,
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
  const current = calculateCaseStrength(argumentMap, checklist, reason, payloadSource);
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
