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

import type { I18nKey, I18nKeyParam, I18nToken } from "@/lib/i18n/token";
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
import {
  buildCaseGateAssessment,
  gateNotProvided,
  type CaseGateAssessment,
} from "./caseGateAssessment";

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
  /** Winning field for this signal — lets the composer name the actual
   *  FACT where the signal-level label is ambiguous. */
  field?: string;
}

/** Build an I18nKeyParam that references a signal's localized label. */
function labelParam(signalId: SignalId): I18nKeyParam {
  return { type: "i18n-key", key: signalLabelKey(signalId) };
}

/** Fields whose signal-level label misstates the fact in running copy.
 *  "Refund record" in "X and Refund record support this defense" reads
 *  as "the merchant refunded the customer" — when the contributor is
 *  no_return_initiated the fact is the OPPOSITE (no refund was owed).
 *  These value labels state the fact unambiguously. */
const CONTRIBUTION_VALUE_LABEL_KEY: Record<string, I18nKey> = {
  refund_record: "disputes.signalLabelValue.refundIssued",
  no_return_initiated: "disputes.signalLabelValue.noRefundOwed",
};

/** Label param for a contribution row: the winning field's fact-stating
 *  label when one exists, else the generic signal label. */
function contributionLabelParam(row: ContributionRow): I18nKeyParam {
  const valueKey = row.field ? CONTRIBUTION_VALUE_LABEL_KEY[row.field] : undefined;
  return valueKey
    ? { type: "i18n-key", key: valueKey }
    : labelParam(row.signalId);
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
          label1: contributionLabelParam(strong[0]),
          label2: contributionLabelParam(strong[1]),
          label3: strong[2] ? contributionLabelParam(strong[2]) : "empty",
          count: strong.length,
        },
      };
    }
    if (strong[0]) {
      return {
        key: "disputes.strengthReason.strong.single",
        params: { label: contributionLabelParam(strong[0]) },
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
          strongLabel: contributionLabelParam(strong[0]),
          moderateLabel: contributionLabelParam(moderate[0]),
        },
      };
    }
    if (strong[0]) {
      return {
        key: "disputes.strengthReason.moderate.strongOnly",
        params: { label: contributionLabelParam(strong[0]) },
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
          label1: contributionLabelParam(moderate[0]),
          label2: moderate[1] ? contributionLabelParam(moderate[1]) : "empty",
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
        label: contributionLabelParam(strong[0]),
        hint: hintParam(family),
      },
    };
  }
  if (strong.length === 0 && moderate.length >= 1) {
    return {
      key: "disputes.strengthReason.weak.moderateOnly",
      params: {
        label1: contributionLabelParam(moderate[0]),
        label2: moderate[1] ? contributionLabelParam(moderate[1]) : "empty",
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

/** Optional credit-already-issued input (`lib/automation/creditTiming`).
 *  A FLOOR, not a signal: when the credit precedes the dispute AND
 *  covers it in full, `overall` becomes "strong" and the hero reads
 *  likely_to_win, regardless of how the family's own evidence scored.
 *  Coverage and fatal-loss both out-rank it. */
export interface CaseCreditAlreadyIssuedInput {
  triggered: boolean;
  coversDisputedAmount: boolean;
}

/**
 * Read the credit-already-issued floor out of a persisted `pack_json`.
 *
 * EVERY caller of `calculateCaseStrength` that renders or scores a
 * dispute must pass this. Until 2026-08-01 it was a trailing optional
 * argument, so a site that forgot it silently scored the case without
 * the floor and TypeScript said nothing — that is how blume-box
 * 162042cd ended up submitted-as-strong by `buildPack` while the dispute
 * page, recomputing without it, showed no strong badge. The gates are
 * now a required, branded `CaseGateAssessment`, so omission is a compile
 * error; `null` here means "this pack records no credit", which is a
 * different statement from "nobody asked" — the latter is now spelled
 * `gateNotProvided("not_persisted_in_pack")`.
 *
 * `buildPack` owns the underlying timing comparison (it has the order);
 * every read path takes the persisted answer from here.
 */
export function creditAlreadyIssuedInput(
  packJson: unknown,
): CaseCreditAlreadyIssuedInput | null {
  return creditAlreadyIssuedFromBlock(
    (packJson as { credit_already_issued?: unknown } | null)?.credit_already_issued,
  );
}

/** Same reader, for call sites that project the block directly out of
 *  `pack_json` (`select("pack_json->credit_already_issued")`) instead of
 *  loading the whole document. */
export function creditAlreadyIssuedFromBlock(
  block: unknown,
): CaseCreditAlreadyIssuedInput | null {
  const b = block as { triggered?: unknown; coversDisputedAmount?: unknown } | null | undefined;
  if (!b || typeof b !== "object") return null;
  return {
    triggered: b.triggered === true,
    coversDisputedAmount: b.coversDisputedAmount === true,
  };
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

/** Optional Cardholder-name-mismatch Gate input (2026-07-23). Computed
 *  by callers via `detectCardholderNameMismatch` (lib/argument/
 *  nameMismatch.ts) from the avs_cvv_match payload's gateway-registered
 *  `cardholderName` vs. the dispute's customer name. When triggered on
 *  a FRAUD-family dispute, CAPS `overall` at "moderate" — a
 *  name-mismatched order is the classic stolen-card pattern and must
 *  never auto-submit as a Strong case. Cap-as-ceiling: weak stays weak,
 *  moderate stays moderate. Non-fraud families are unaffected (the
 *  dispute isn't about the buyer's identity there). The names are
 *  merchant-UI-only diagnostics — never bank-facing. */
export interface CaseNameMismatchInput {
  triggered: boolean;
  cardholderName: string | null;
  customerName: string | null;
}

const COVERED_STRENGTH_REASON_TOKEN: I18nToken = {
  key: "disputes.strengthReason.covered",
};

/**
 * Every gate/floor `calculateCaseStrength` consults arrives as one
 * REQUIRED, BRANDED `CaseGateAssessment` — see
 * `lib/argument/caseGateAssessment.ts` for the contract and the two
 * failures it closes (omission, then conflation of "the case has no such
 * gate" with "this site cannot see it").
 *
 * The scorer reads exactly the same five nullable values it always has;
 * what changed is that they can now only come from
 * `buildCaseGateAssessment`, where each one had to be stated.
 */

export function calculateCaseStrength(
  checklist: ChecklistItemV2[],
  reason: string | null | undefined,
  /** Payload source for conditional categorization (delivery proofType,
   *  AVS/CVV codes, IP location flags). `undefined` collapses
   *  conditional fields to their best-case default category per the
   *  canonical registry. Pass the workspace's
   *  `pack.evidenceItemsByField` map for accurate scoring. */
  payloadSource: EvidencePayloadSource | undefined,
  /** REQUIRED. Every gate, explicitly stated, built through
   *  `buildCaseGateAssessment`. See `CaseGateAssessment`. */
  gates: CaseGateAssessment,
): CaseStrengthResult {
  const { coverage, fatalLoss, riskWeakness, nameMismatch, creditAlreadyIssued } = gates;
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
      // No checklist → no scoring → the risk-weakness and name-mismatch
      // caps are no-ops here. Diagnostic blocks still propagate for audit.
      riskWeakness: riskWeakness ?? undefined,
      nameMismatch: nameMismatch
        ? { ...nameMismatch, capApplied: false }
        : undefined,
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
  // Per-signal accumulator: best category seen (per-signalId dedup),
  // plus the WINNING FIELD so the strength reason can name the actual
  // fact instead of the ambiguous signal-level label ("Refund record"
  // read as "we refunded the customer" when the contributor was
  // no_return_initiated — live complaint, cay dispute 328a45e4,
  // 2026-07-16).
  type SignalAcc = { category: EvidenceCategory; field: string };
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
        bestBySignalDetailed.set(spec.signalId, { category, field: item.field });
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
  // Prior-order history is CORROBORATION on a fraud claim, never decisive
  // proof of cardholder identity. The canonical registry rates
  // `customer_account_info` STRONG on >=1 prior undisputed order — a far
  // weaker bar than Visa's Compelling Evidence 3.0 remedy (2+ prior
  // undisputed transactions in a 120-365 day window sharing >=2 data
  // elements incl. IP or device ID). Treating a single prior order as a
  // decisive fraud signal is a false CE3.0 proxy, so for the FRAUD family
  // only, an `account_history` row rated strong is demoted to moderate
  // HERE — at row-build time, so the reported counts, the contribution
  // list ("What supports your case"), and the strength reason all agree
  // rather than the UI showing a Strong pill the scorer discounted.
  // Other families keep the registry rating (prior history genuinely
  // supports e.g. a not-as-described defence), and the registry itself is
  // untouched, preserving the family-independent-categories invariant.
  // Measured 2026-07-23: 0 of 360 prod fraud disputes qualify for a real
  // CE3.0 remedy, so this drops a false signal without losing a true one.
  // See docs/plans/tech-debt/ce3-fraud-compelling-evidence.plan.md.
  const demoteToCorroboration = (signalId: SignalId): boolean =>
    family === "fraud" && signalId === "account_history";

  const strongRows: ContributionRow[] = [];
  const moderateRows: ContributionRow[] = [];
  for (const [signalId, acc] of bestBySignalDetailed) {
    const effective =
      acc.category === "strong" && demoteToCorroboration(signalId)
        ? "moderate"
        : acc.category;
    if (effective === "strong") {
      strongRows.push({ signalId, category: "strong", field: acc.field });
    } else if (effective === "moderate") {
      moderateRows.push({ signalId, category: "moderate", field: acc.field });
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
  // NOTE: account_history is already demoted strong -> moderate for the
  // fraud family at row-build time (see `demoteToCorroboration` above), so
  // these counts see it as a moderate corroborating signal, not a decisive
  // one. No extra filtering needed here.
  const strongCountFromFraudSignals = strongRows.filter((r) =>
    FRAUD_DECISIVE_SIGNALS.has(r.signalId),
  ).length;
  const moderateCountFromFraudSignals = moderateRows.filter((r) =>
    FRAUD_DECISIVE_SIGNALS.has(r.signalId),
  ).length;

  // Product / "not as described" (Visa 13.3 · MC 4853) decisive signals,
  // split into the two axes the card networks + representment industry
  // weigh (docs/plans/product-not-as-described-scoring.plan.md):
  //   Axis 1 — "it matched what they bought": the customer acknowledged
  //     the order/receipt (communication) or signed a spec/contract
  //     (supplementary_documents strong). The bare product listing /
  //     order record are NOT here — they show what was advertised, not
  //     that the customer agreed it matched (stay supportingOnly).
  //   Axis 2 — "the dispute isn't valid / is moot": the customer never
  //     returned the item (refund signal via no_return_initiated) —
  //     post-2024 Visa a return is a PRECONDITION to filing 13.3, so
  //     "never returned" attacks validity at the root — or a refund was
  //     already issued (refund_record). Shared signalId `refund`.
  const PRODUCT_AXIS1_MATCH = new Set<SignalId>([
    "communication",
    "supplementary_documents",
  ]);
  const PRODUCT_AXIS2_VALIDITY = new Set<SignalId>(["refund"]);
  const hasProductAxis1 =
    strongRows.some((r) => PRODUCT_AXIS1_MATCH.has(r.signalId)) ||
    moderateRows.some((r) => PRODUCT_AXIS1_MATCH.has(r.signalId));
  const hasProductAxis2 =
    strongRows.some((r) => PRODUCT_AXIS2_VALIDITY.has(r.signalId)) ||
    moderateRows.some((r) => PRODUCT_AXIS2_VALIDITY.has(r.signalId));

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
  } else if (family === "product") {
    // "Not as described / defective" (Visa 13.3 · MC 4853). A subjective
    // merchandise-quality claim: the winning rebuttal must answer BOTH
    // halves the bank weighs — (1) the item matched what the customer
    // bought, and (2) the dispute isn't valid/is moot. So:
    //   Strong   = at least one Axis-1 signal AND one Axis-2 signal
    //              (both halves answered).
    //   Moderate = at least one decisive signal from EITHER axis, OR the
    //              generic two-strong / one-strong+one-moderate count.
    //   Weak     = no decisive signal. A bare listing + order record
    //              (both supportingOnly) genuinely is weak here — we do
    //              NOT inflate it (matches the industry ranking; see plan).
    // Two signals from the SAME axis do not reach Strong — that proves
    // one half twice and leaves the other unanswered.
    if ((hasProductAxis1 && hasProductAxis2) || strongCount >= 2) {
      overall = "strong";
    } else if (
      hasProductAxis1 ||
      hasProductAxis2 ||
      (strongCount === 1 && moderateCount >= 1)
    ) {
      overall = "moderate";
    } else {
      overall = "weak";
    }
  } else {
    if (strongCount >= 2) overall = "strong";
    else if (strongCount === 1 && moderateCount >= 1) overall = "moderate";
    else overall = "weak";
  }

  // Cardholder-name-mismatch cap (fraud family only). The gateway says
  // the card is registered to someone who shares no name token with the
  // buyer — the stolen-card pattern. Cap at "moderate" so the case never
  // auto-submits as Strong; the merchant reviews it with the
  // kept-internal warning that prints both names. Applied BEFORE reason
  // composition so the hero copy is written for the capped level, and
  // BEFORE the coverage/fatal-loss overrides (which take precedence
  // downstream regardless). Ceiling only — weak/moderate pass through.
  let nameMismatchCapApplied = false;
  if (
    family === "fraud" &&
    nameMismatch?.triggered === true &&
    overall === "strong"
  ) {
    overall = "moderate";
    isFraudAvsOnlyStrong = false;
    nameMismatchCapApplied = true;
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

  // Credit-already-issued (2026-08-01). A credit processed BEFORE the
  // cardholder filed is not "strong evidence for this family's theory" —
  // it is a different claim, that the transaction was already made whole.
  // Visa's Dispute Management Guidelines list it among the grounds that
  // render a dispute invalid, independent of reason code.
  //
  // So it is a FLOOR, not a signal: it does not add to `strongCount`
  // (which counts evidence for the family theory) but it does mean the
  // case is strong on its own terms. A name mismatch or a first-seen IP
  // does not make a full pre-dispute refund any less of a refund.
  //
  // Gated on FULL coverage. A partial credit is real and worth arguing,
  // but it does not by itself make the case strong — the uncovered
  // balance still has to be defended on the family's own merits.
  const isCreditAlreadyIssued =
    !isCovered &&
    !isFatalLoss &&
    creditAlreadyIssued?.triggered === true &&
    creditAlreadyIssued?.coversDisputedAmount === true;

  if (isCreditAlreadyIssued) {
    overall = "strong";
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
  else if (isCreditAlreadyIssued) heroVariant = "likely_to_win";
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
      : isCreditAlreadyIssued
        ? { key: "disputes.strengthReason.creditAlreadyIssued" }
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
    // Suppress the "add X to strengthen your case" hint once an
    // override owns the outcome. Telling a merchant to add delivery
    // confirmation to a transaction they already refunded is noise —
    // it advises work that cannot change the argument.
    improvementHintI18n:
      isCovered || isFatalLoss || isCreditAlreadyIssued ? null : improvementHintI18n,
    heroVariant,
    // Suppress the in-transit framing when coverage or fatal-loss has
    // overridden the reason — those states own the merchant message.
    deliveryInTransit: isCovered || isFatalLoss ? false : deliveryInTransit,
    strengthReasonI18n: finalStrengthReasonI18n,
    coverage: coverage ?? undefined,
    fatalLoss: fatalLoss ?? undefined,
    riskWeakness: riskWeakness ?? undefined,
    nameMismatch: nameMismatch
      ? { ...nameMismatch, capApplied: nameMismatchCapApplied }
      : undefined,
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
 * Inputs to `computeContributions`, as one object with REQUIRED fields.
 *
 * Same rule as `CaseGateAssessment`, for the same reason: `reason` used
 * to be a trailing optional argument, and the function's own doc comment
 * already recorded what omitting it costs (a Strong pill on rows the
 * scorer counted as moderate). Positional made it worse — the two
 * neighbouring helpers disagreed on argument order
 * (`computeContributions(checklist, payloadSource, reason)` vs
 * `calculateImprovement(checklist, reason, payloadSource)`), so the call
 * sites could not be read at a glance. Named and required: a value may
 * be `undefined`, but the caller has to say so.
 */
export interface ContributionInput {
  checklist: ChecklistItemV2[];
  /** Payload source for conditional categorization. `undefined` falls
   *  back to registry default categories. */
  payloadSource: EvidencePayloadSource | undefined;
  /** Dispute reason. Applies the same fraud-family `account_history`
   *  strong->moderate demotion `calculateCaseStrength` does, so "What
   *  supports your case" can't show a Strong pill the scorer counted as
   *  moderate. See the demotion comment above. `undefined`/`null` means
   *  the reason is genuinely unknown here — not that it was forgotten. */
  reason: string | null | undefined;
}

/**
 * Compute the "What supports your case" rows for the dispute Overview.
 * Plan v3 §P2.6 — one row per canonical signalId with effective
 * category `strong` or `moderate`, deduplicated, no synthesis. Only
 * AVAILABLE / WAIVED items contribute.
 *
 * This is the ONE implementation. `app/api/disputes/[id]/workspace/route.ts`
 * carried a hand-copied version of this loop until 2026-08-01; the copy
 * had silently dropped the fraud demotion below, so the dispute page
 * rendered a Strong prior-order-history pill on fraud disputes the
 * scorer had counted as moderate. Call this; never re-implement it.
 */
export function computeContributions(
  input: ContributionInput,
): CaseStrengthContributions {
  const { checklist, payloadSource, reason } = input;
  // Per signalId: track the highest category seen + the first field
  // that contributed it (deterministic by checklist iteration order).
  type Acc = { category: EvidenceCategory; field: string };
  const RANK: Record<EvidenceCategory, number> = { strong: 3, moderate: 2, supporting: 1, invalid: 0 };
  const bySignal = new Map<SignalId, Acc>();
  const isFraud = reason != null && resolveReasonFamily(reason) === "fraud";

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
    // Same fraud-family demotion the scorer applies: prior-order history
    // corroborates, it never decisively proves cardholder identity.
    const effective =
      acc.category === "strong" && isFraud && signalId === "account_history"
        ? "moderate"
        : acc.category;
    const row: CaseStrengthContribution = {
      signalId,
      category: effective as "strong" | "moderate",
      labelToken: { key: spec?.labelKey ?? signalLabelKey(signalId) },
      evidenceFieldKey: acc.field,
    };
    // Bucket by the EFFECTIVE category — bucketing by acc.category would
    // push a demoted row (labelled moderate) into the strong array.
    if (effective === "strong") strong.push(row);
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
  // Gate-free BY CONSTRUCTION, not by omission. This call asks a
  // counting question — "how many strong/moderate signals does the
  // evidence itself carry, and would one more move the count?" — and
  // every gate is a verdict override that leaves those counts untouched.
  // Feeding gates in here would only change `current.overall`, and the
  // gated verdict is already owned by the caller: the surfaces that
  // render this hint read `calculateCaseStrength(...).improvementHintI18n`,
  // which suppresses itself under coverage / fatal-loss / credit-issued.
  // Stated gate by gate rather than through a shared all-off shorthand, so
  // a sixth gate still stops here and makes someone re-read this comment.
  const current = calculateCaseStrength(
    checklist,
    reason,
    payloadSource,
    buildCaseGateAssessment({
      coverage: gateNotProvided("gate_free_query"),
      fatalLoss: gateNotProvided("gate_free_query"),
      riskWeakness: gateNotProvided("gate_free_query"),
      nameMismatch: gateNotProvided("gate_free_query"),
      creditAlreadyIssued: gateNotProvided("gate_free_query"),
    }),
  );
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
