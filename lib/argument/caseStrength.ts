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

import type { I18nKeyParam, I18nToken } from "@/lib/i18n/token";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type {
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
import { resolveReasonFamily, type ReasonFamily } from "./reasonFamily";
import { buildDeliveryPresentation } from "./deliveryPresentation";

/** Signal → i18n key lookup. Reads the canonical registry directly so
 *  there is no second source of truth. A signalId always corresponds
 *  to at least one canonical spec; we just need any spec for that
 *  signal to recover the labelKey. */
function signalLabelKey(signalId: SignalId): string {
  for (const spec of Object.values(CANONICAL_EVIDENCE)) {
    if (spec.signalId === signalId) return spec.labelKey;
  }
  return `disputes.signalLabel.${signalId}`;
}

/* ── strengthReason token composition ──
 *
 * Lib emits structured `I18nToken`s only — never English. The hero
 * copy MUST agree with the canonical contribution result, so the
 * composition reads the actual `ContributionRow`s instead of falling
 * through a static per-family table.
 *
 * Label params are wrapped as `I18nKeyParam` so the resolver translates
 * each signal label before splicing it into the outer template. Param
 * names match the placeholders in `messages/*.json` exactly
 * (`label1`/`label2`/`label3`, `strongLabel`/`moderateLabel`, `label`,
 * `hint`, `family`, `decisive`).
 *
 * The `select`-with-`"empty"` discriminator pattern handles the
 * optional third / second label: when not present we pass the literal
 * string `"empty"` so the template renders nothing for that branch.
 */

interface ContributionRow {
  signalId: SignalId;
  category: "strong" | "moderate";
}

/** Build an I18nKeyParam that references a signal's localized label. */
function labelParam(signalId: SignalId): I18nKeyParam {
  return { type: "i18n-key", key: signalLabelKey(signalId) };
}

/** Build an I18nKeyParam for the per-family decisive-hint copy. */
function hintParam(family: ReasonFamily): I18nKeyParam {
  return { type: "i18n-key", key: `disputes.decisiveHint.${family}` };
}

function composeStrengthReasonI18n(args: {
  overall: CaseStrengthLevel;
  family: ReasonFamily;
  strong: ContributionRow[];
  moderate: ContributionRow[];
  /** Set when fraud-specific scoring upgraded a case from weak to
   *  moderate solely on avs_cvv_match Strong. Triggers the canonical
   *  "Needs strengthening" copy. */
  isFraudAvsOnlyStrong?: boolean;
  /** Set when a delivery-signal payload carries a tracking number but the
   *  carrier has not yet confirmed delivery (`delivered_unverified`). The
   *  weak reason then says "on its way, awaiting carrier confirmation"
   *  instead of the generic "no delivery evidence". */
  deliveryInTransit?: boolean;
}): I18nToken {
  const { overall, family, strong, moderate, isFraudAvsOnlyStrong, deliveryInTransit } = args;

  if (overall === "insufficient") {
    return { key: `disputes.strengthReason.${family}.insufficient` };
  }

  if (overall === "strong") {
    if (strong.length >= 2) {
      return {
        key: "disputes.strengthReason.strong.multi",
        params: {
          label1: labelParam(strong[0].signalId),
          label2: labelParam(strong[1].signalId),
          label3: strong[2] ? labelParam(strong[2].signalId) : "empty",
          count: strong.length,
        },
      };
    }
    if (strong[0]) {
      return {
        key: "disputes.strengthReason.strong.single",
        params: { label: labelParam(strong[0].signalId) },
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
          strongLabel: labelParam(strong[0].signalId),
          moderateLabel: labelParam(moderate[0].signalId),
        },
      };
    }
    if (strong[0]) {
      return {
        key: "disputes.strengthReason.moderate.strongOnly",
        params: { label: labelParam(strong[0].signalId) },
      };
    }
    // Moderate reached on moderate-category signals alone (e.g. a refund
    // family rated moderate off a single no_return_initiated signal). Name
    // the actual signals — mirroring weak.moderateOnly — instead of the
    // canned per-family line. Pre-fix, this branch discarded the signal
    // names and merchants read "Some refund evidence exists" with no way
    // to know WHICH evidence (dispute #891BECCC, 2026-07-15).
    if (moderate[0]) {
      return {
        key: "disputes.strengthReason.moderate.moderateOnly",
        params: {
          label1: labelParam(moderate[0].signalId),
          label2: moderate[1] ? labelParam(moderate[1].signalId) : "empty",
          hint: hintParam(family),
        },
      };
    }
    return { key: `disputes.strengthReason.${family}.moderate` };
  }

  // overall === "weak"
  if (strong.length === 1 && moderate.length === 0) {
    return {
      key: "disputes.strengthReason.weak.strongAlone",
      params: {
        label: labelParam(strong[0].signalId),
        hint: hintParam(family),
      },
    };
  }
  if (strong.length === 0 && moderate.length >= 1) {
    return {
      key: "disputes.strengthReason.weak.moderateOnly",
      params: {
        label1: labelParam(moderate[0].signalId),
        label2: moderate[1] ? labelParam(moderate[1].signalId) : "empty",
        hint: hintParam(family),
      },
    };
  }
  // strong=0 AND moderate=0 — true "weak" with only supporting context.
  // Shipped-but-in-transit gets a specific reason: the parcel is on its
  // way and the carrier hasn't confirmed delivery yet, so the case is
  // weak *right now* but is expected to strengthen once delivery is
  // confirmed. This is honest and pedagogical rather than the flat
  // "no decisive delivery evidence".
  if (deliveryInTransit) {
    return {
      key: "disputes.strengthReason.weak.deliveryInTransit",
      params: {
        decisive: { type: "i18n-key", key: `disputes.decisiveFamilies.${family}` },
      },
    };
  }
  return {
    key: "disputes.strengthReason.weak.supportingOnly",
    params: {
      family: { type: "i18n-key", key: `disputes.reasonFamilyLabel.${family}` },
      decisive: { type: "i18n-key", key: `disputes.decisiveFamilies.${family}` },
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
 *  and replaces `strengthReasonI18n` with the fatal-loss token.
 *  Coverage beats fatal-loss (a covered case is never "fatal"; Shopify
 *  pays). Otherwise this triggers regardless of the underlying evidence. */
export interface CaseFatalLossInput {
  triggered: boolean;
  reason: "refund_issued" | "inr_no_fulfillment" | null;
  /** Merchant-facing message token. Resolved by the consumer. */
  messageToken: I18nToken | null;
}

/** Optional Risk-weakness Gate input (fraud-risk Phase 2). When
 *  triggered AND not pre-empted by coverage or fatal-loss, CAPS
 *  `overall` at "moderate" — never elevates. The cap is a ceiling, so
 *  if the underlying scoring already produced "moderate" / "weak" the
 *  cap is a no-op. Currently no UI surface consumes the message; the
 *  diagnostic fields persist for audit. */
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

const COVERED_STRENGTH_REASON_TOKEN: I18nToken = {
  key: "disputes.strengthReason.covered",
};

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
      improvementHintI18n: null,
      heroVariant: earlyCovered ? "covered" : "hard_to_win",
      strengthReasonI18n: earlyCovered
        ? COVERED_STRENGTH_REASON_TOKEN
        : earlyFatal
          ? (fatalLoss?.messageToken
              ?? (fatalLoss?.reason
                ? { key: `disputes.strengthReason.fatalLoss.${fatalLoss.reason}` }
                : { key: `disputes.strengthReason.${family}.weak` }))
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
  // Per-signal accumulator: best category seen (per-signalId dedup).
  // The signalId itself is enough for strength-reason composition —
  // the token layer resolves the label.
  type SignalAcc = { category: EvidenceCategory };
  const bestBySignalDetailed = new Map<SignalId, SignalAcc>();

  let registeredItems = 0; // canonical fields visible in the checklist
  let presentItems = 0;    // available or waived
  // Missing actionable candidates — resolved AFTER the loop so a field
  // whose SIGNAL is already covered by a collected sibling is never
  // suggested. Scoring keeps only the best row per signalId, so "add
  // refund_record" when the refund signal is already Strong is both
  // contradictory ("Refund status · Strong" sits right below the hint)
  // and mathematically useless (live bug: cay dispute cc86296d,
  // 2026-07-16).
  const missingActionableCandidates: Array<{
    field: string;
    category: EvidenceCategory;
    signalId: SignalId;
  }> = [];
  const missingRank = (c: EvidenceCategory): number => (c === "strong" ? 3 : c === "moderate" ? 2 : 0);
  // Shipped-but-in-transit: a delivery-signal payload that carries a
  // tracking number but whose proofType is `delivered_unverified` (the
  // parcel is on its way, the carrier has not yet confirmed delivery).
  // This is a *more specific* flavour of the "weak, supporting only"
  // state — the strength reason can then say "on its way, awaiting
  // carrier confirmation" instead of the generic "no delivery evidence".
  let deliveryInTransit = false;

  for (const item of checklist) {
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue; // Field not in the registry — ignored everywhere.
    registeredItems++;

    const isAvailable = item.status === "available" || item.status === "waived";
    const isMissing = item.status === "missing";

    if (isAvailable) {
      presentItems++;
      const payload = payloadFor(payloadSource, item.field);
      // Detect the shipped-but-in-transit delivery state (tracking exists,
      // carrier hasn't confirmed delivery) so the strength reason can be
      // specific rather than the generic "no delivery evidence".
      if (spec.signalId === "delivery") {
        const dp = buildDeliveryPresentation(payload);
        if (
          dp.labelKey === "disputes.deliveryProof.shippedUnconfirmed" &&
          dp.trackingLinks.some((t) => t.number || t.url)
        ) {
          deliveryInTransit = true;
        }
      }
      const category = categoryFor({ fieldKey: item.field, payload });
      // Supporting and invalid contribute nothing to scoring.
      if (!affectsStrength(category)) continue;
      const prev = bestBySignalDetailed.get(spec.signalId);
      if (!prev || RANK[category] > RANK[prev.category]) {
        bestBySignalDetailed.set(spec.signalId, { category });
      }
    } else if (isMissing && (item.collectionType === "manual" || !item.collectionType)) {
      // Candidate for the improvement hint. We use the spec's default
      // category (best case) since we don't have a payload to evaluate.
      // Selection happens after the loop, once signal coverage is known.
      const candidateCat = spec.category;
      if (!affectsStrength(candidateCat)) continue;
      missingActionableCandidates.push({
        field: item.field,
        category: candidateCat,
        signalId: spec.signalId,
      });
    }
  }

  // Pick the improvement-hint field: highest default category among
  // missing actionables whose signal is NOT already contributing — a
  // signal that already has a strength-affecting row can't be improved
  // by adding a sibling field (per-signal best-row scoring).
  let missingActionableTopField: { field: string; category: EvidenceCategory } | null = null;
  for (const cand of missingActionableCandidates) {
    if (bestBySignalDetailed.has(cand.signalId)) continue;
    if (
      !missingActionableTopField ||
      missingRank(cand.category) > missingRank(missingActionableTopField.category)
    ) {
      missingActionableTopField = { field: cand.field, category: cand.category };
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
      strongRows.push({ signalId, category: "strong" });
    } else if (acc.category === "moderate") {
      moderateRows.push({ signalId, category: "moderate" });
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
  } else if (family === "delivery") {
    // Item-not-received family. Carrier-confirmed delivery to the verified
    // customer address is the single most decisive fact for an INR claim —
    // it directly refutes "I never received it". So one STRONG `delivery`
    // signal reaches Moderate on its own (no second signal required),
    // rather than falling through to Weak under the strict count formula.
    // (`delivered_confirmed` → strong requires deliveredToVerifiedAddress,
    // set by the fulfillment collector for genuine final delivery only, so
    // pickup/neighbour/returned never trigger this.) Two strong signals
    // still reach Strong; everything below one strong delivery is Weak.
    const hasStrongDelivery = strongSignalIds.has("delivery");
    if (strongCount >= 2) overall = "strong";
    else if (strongCount === 1 && moderateCount >= 1) overall = "moderate";
    else if (hasStrongDelivery) overall = "moderate";
    else overall = "weak";
  } else if (family === "refund") {
    // Credit-not-processed family ("you owed me a refund and didn't issue
    // it"). The decisive fact is whether a refund obligation actually
    // arose. A `refund` signal (refund_record when a refund WAS processed,
    // or no_return_initiated when the customer never returned the goods and
    // no refund was issued) directly answers the claim: either the refund
    // exists, or none was owed under a return-conditional policy. So one
    // such signal reaches Moderate on its own, rather than falling to Weak
    // under the strict count formula. The collector only emits
    // no_return_initiated when returnStatus === NO_RETURN AND no refund was
    // issued, so it never contradicts a real refund. Two strong signals
    // still reach Strong.
    const hasRefundSignal =
      strongSignalIds.has("refund") || moderateSignalIds.has("refund");
    if (strongCount >= 2) overall = "strong";
    else if (strongCount === 1 && moderateCount >= 1) overall = "moderate";
    else if (hasRefundSignal) overall = "moderate";
    else overall = "weak";
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
  let improvementHintI18n: I18nToken | null = null;
  if (overall !== "strong" && missingActionableTopField) {
    const spec = CANONICAL_EVIDENCE[missingActionableTopField.field];
    if (spec) {
      improvementHintI18n = {
        key: "disputes.improvementHint",
        params: { label: labelParam(spec.signalId) },
      };
    }
  }

  // Compose strengthReason from the actual contributions instead of a
  // static per-family table. Guarantees the hero copy never claims a
  // signal is "missing" when it's already in the contribution list.
  const strengthReasonI18nToken = composeStrengthReasonI18n({
    overall,
    family,
    strong: strongRows,
    moderate: moderateRows,
    isFraudAvsOnlyStrong,
    deliveryInTransit,
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

  const finalStrengthReasonI18n: I18nToken = isCovered
    ? COVERED_STRENGTH_REASON_TOKEN
    : isFatalLoss
      ? (fatalLoss?.messageToken
          ?? (fatalLoss?.reason
            ? { key: `disputes.strengthReason.fatalLoss.${fatalLoss.reason}` }
            : { key: `disputes.strengthReason.${family}.weak` }))
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
    improvementHintI18n: isCovered || isFatalLoss ? null : improvementHintI18n,
    heroVariant,
    // Suppress the in-transit framing when coverage or fatal-loss has
    // overridden the reason — those states own the merchant message.
    deliveryInTransit: isCovered || isFatalLoss ? false : deliveryInTransit,
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
  /** i18n token for the merchant-facing label. UI consumers resolve
   *  via `resolveToken(rootTranslator, labelToken)`. */
  labelToken: I18nToken;
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
      labelToken: { key: spec?.labelKey ?? signalLabelKey(signalId) },
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
  //
  // Signals that already contribute a strength-affecting row are
  // excluded — per-signal best-row scoring means adding a sibling field
  // of a covered signal cannot move the score, and suggesting it
  // contradicts the "collected · Strong" row shown to the merchant.
  const coveredSignals = new Set<SignalId>();
  for (const item of checklist) {
    if (item.status !== "available" && item.status !== "waived") continue;
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue;
    const cat = categoryFor({
      fieldKey: item.field,
      payload: payloadFor(payloadSource, item.field),
    });
    if (affectsStrength(cat)) coveredSignals.add(spec.signalId);
  }

  let bestField: string | null = null;
  let bestCategory: EvidenceCategory | null = null;
  const rank = (c: EvidenceCategory): number => (c === "strong" ? 3 : c === "moderate" ? 2 : 0);

  for (const item of checklist) {
    if (item.status !== "missing") continue;
    if (item.collectionType !== "manual" && item.collectionType) continue;
    const spec = CANONICAL_EVIDENCE[item.field];
    if (!spec) continue;
    if (coveredSignals.has(spec.signalId)) continue;
    const cat = spec.category;
    if (!affectsStrength(cat)) continue;
    if (!bestCategory || rank(cat) > rank(bestCategory)) {
      bestCategory = cat;
      bestField = item.field;
    }
  }

  if (!bestField || !bestCategory) return null;

  // `action` is currently consumed only by internal diagnostics; the
  // merchant-facing improvement copy is rendered via
  // `improvementHintI18n`. Emit a non-localized debug string here so
  // the diagnostic stays readable.
  const labelKey = CANONICAL_EVIDENCE[bestField]?.labelKey ?? bestField;
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
    action: `Add ${labelKey}`,
    field: bestField,
  };
}
