/**
 * Canonical evidence registry.
 *
 * Plan v3 §P2.4 + P2.4a + P2.4b. **The single source of truth** for:
 *   - Per-evidence-field category (`strong` | `moderate` | `supporting` |
 *     `invalid`).
 *   - The `signalId` that scoring uses for cross-key deduplication.
 *   - Per-field weight (3/2/0).
 *   - Conditional categorization rules (e.g. delivery proofType).
 *
 * Hard rules:
 *   - **No code outside this file may assign a category** to an evidence
 *     item. Enforced by the CI grep guard. (P2.4b)
 *   - The persisted `category` on `pack.evidenceItems[*]` is a **cache,
 *     not authority**. It is recomputed on every pack build and on read
 *     when `categoryVersion` mismatches. (P2.4a)
 *   - **Supporting items NEVER elevate case strength.** `weight = 0` and
 *     `excludedFromStrength = true` for every supporting entry. (P2.1.1)
 *   - **Deduplication uses `signalId`**, not `evidenceFieldKey`. (P2.4)
 */

import type { I18nKey } from "@/lib/i18n/token";

/** Strict 4-state category. `invalid` items never enter the system. */
export type EvidenceCategory = "strong" | "moderate" | "supporting" | "invalid";

/** Signal-level ID used for scoring deduplication. Multiple
 *  `evidenceFieldKey`s may share a `signalId` when they describe the
 *  same underlying evidentiary signal. */
export type SignalId =
  | "payment_auth"
  | "billing_match"
  | "delivery"
  | "ip_location"
  | "device_session"
  | "communication"
  | "account_history"
  | "order_record"
  | "product_listing"
  | "policy_refund"
  | "policy_shipping"
  | "policy_cancellation"
  | "duplicate_explanation"
  | "supplementary_documents"
  // Refund record — proof a refund was actually issued for the order.
  // Decisive for CREDIT_NOT_PROCESSED ("you didn't refund me") disputes.
  | "refund"
  // Pre-authorization fraud screening (Phase 1 of fraud-risk plan).
  // Distinct from `payment_auth` so dedup doesn't collapse it into
  // AVS/CVV — the screening is a separate signal that complements,
  // rather than duplicates, gateway-level authentication.
  | "fraud_screening";

/** Weight per category. Used by the count-based scorer. */
export const CATEGORY_WEIGHT: Record<EvidenceCategory, number> = {
  strong: 3,
  moderate: 2,
  supporting: 0,
  invalid: 0,
};

/**
 * Bumped whenever the categorization rules change. Persisted alongside
 * each evidence item so the workspace API can detect stale caches and
 * recompute on read. Plan §P2.4a.
 */
export const CANONICAL_EVIDENCE_VERSION = 3;

/** Persisted alongside an evidence item so we know which registry
 *  version classified it. */
export interface PersistedCategory {
  category: EvidenceCategory;
  signalId: SignalId;
  categoryVersion: number;
}

/** Static spec per `evidenceFieldKey`. The `category` here is the
 *  **default** category — conditional rules below may downgrade it
 *  based on payload contents (e.g. `delivery_proof` defaults to
 *  `moderate` but downgrades to `invalid` when only a label is
 *  recorded). */
export interface CanonicalSpec {
  /** Cross-field signal grouping for dedup. */
  signalId: SignalId;
  /** i18n key for the merchant-facing label. Consumers wrap it as
   *  `{ key: spec.labelKey }` (or `I18nKeyParam`) and let the translator
   *  resolve into the user's locale. Lib code never emits English. */
  labelKey: I18nKey;
  /** Default category. May be downgraded by conditional rules. */
  category: EvidenceCategory;
  /** True when this signal can never elevate case strength
   *  regardless of presence. Mirrors `category === "supporting"`
   *  but kept as an explicit flag so consumers don't have to
   *  re-derive. (P2.1.1) */
  supportingOnly: boolean;
  /** True when the scorer must skip this entirely. Identical to
   *  `supportingOnly` for the canonical 4-state system; kept as a
   *  separate flag for forward compatibility with future tiers. */
  excludedFromStrength: boolean;
  /** Optional human note (audit-log friendly). */
  note?: string;
}

/* ── Registry ── */

/**
 * Canonical evidence registry. Indexed by `evidenceFieldKey`.
 *
 * Strong (weight 3): directly proves authorization or delivery to the
 *   cardholder.
 * Moderate (weight 2): supports but is not decisive on its own.
 * Supporting (weight 0): context only — never elevates strength.
 *
 * Conditional fields (`avs_cvv_match`, `delivery_proof`,
 * `ip_location_check`, `device_session_consistency`) declare their
 * **best-case** category here; `categorizeEvidenceField()` may
 * downgrade based on payload contents.
 */
export const CANONICAL_EVIDENCE: Record<string, CanonicalSpec> = {
  // ── Payment authentication ──
  avs_cvv_match: {
    signalId: "payment_auth",
    labelKey: "disputes.signalLabel.payment_auth",
    category: "strong",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong only when BOTH AVS and CVV match. Otherwise moderate (one match) or invalid (none). Label intentionally omits parenthetical (AVS + CVV) — the row's value already shows the codes, no need to repeat them in the label.",
  },
  tds_authentication: {
    signalId: "payment_auth",
    labelKey: "disputes.signalLabel.tds_authentication",
    category: "strong",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong only when merchant-confirmed (tdsVerified=true). Moderate when read from Shopify receiptJson best-effort (tdsAuthenticated=true, verifiedSource=shopify_receipt) — receipt shape is gateway-defined and unstable, so we never auto-claim it as STRONG. Invalid otherwise.",
  },
  fraud_risk_screening: {
    // Shopify's own pre-authorization risk classifier; persisted by the
    // orders backfill. Pinned to MODERATE, never upgraded — Shopify's
    // risk facts are descriptive, not contractual. A "Billing country
    // matches IP country" line is meaningful but not a network-level
    // assertion the way an AVS=Y match on the gateway receipt is.
    // Categorizer below short-circuits any upgrade attempt.
    signalId: "fraud_screening",
    labelKey: "disputes.signalLabel.fraud_screening",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Moderate when collector emits a positiveFacts[] payload (collector already enforces LOW + ACCEPT/NONE + ≥1 POSITIVE-sentiment fact). Never strong regardless of payload — see categorizeEvidenceField.",
  },

  // ── Billing match ──
  billing_address_match: {
    signalId: "billing_match",
    labelKey: "disputes.signalLabel.billing_match",
    category: "strong",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when AVS-confirmed billing matches the cardholder. Invalid otherwise.",
  },

  // ── Delivery (proofType-conditional) ──
  delivery_proof: {
    signalId: "delivery",
    labelKey: "disputes.signalLabel.delivery",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "signature_confirmed → strong; delivered_confirmed → moderate; delivered_unverified → supporting; label_created → invalid. The rubric-#9 verified-address upgrade and the collected-at-pickup upgrade were retired 2026-08-07 (PR-C1) as unsubstantiated — see retiredKeys.ts.",
  },
  shipping_tracking: {
    signalId: "delivery",
    labelKey: "disputes.signalLabel.delivery",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Same 4-state proofType mapping as delivery_proof. Shares signalId 'delivery' so duplicate evidence does not double-count.",
  },

  // ── IP / device (always at most moderate) ──
  ip_location_check: {
    signalId: "ip_location",
    labelKey: "disputes.signalLabel.ip_location",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Moderate when location matches AND no VPN/proxy flag. Supporting when partial match. Invalid when payload missing.",
  },
  device_session_consistency: {
    signalId: "device_session",
    labelKey: "disputes.signalLabel.device_session",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when consistent AND login present AND IP/device match (rubric #4); moderate when consistent only; supporting otherwise.",
  },

  // ── Conditionally upgradable (rubric: text-only is supporting,
  //     decisive payload is strong). Default category is `supporting`
  //     and `supportingOnly: false` so the categorizer can upgrade
  //     when payload carries the discriminator. ──
  customer_communication: {
    signalId: "communication",
    labelKey: "disputes.signalLabel.communication",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when payload.customerConfirmsOrder === true (rubric #6 — explicit confirmation/admission). Otherwise supporting.",
  },
  customer_account_info: {
    signalId: "account_history",
    labelKey: "disputes.signalLabel.account_history",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong only when PRIOR undisputed orders exist for the same customer (rubric #5). `totalOrders` mirrors Shopify's Customer.numberOfOrders, which INCLUDES the disputed order itself — so prior history requires totalOrders >= 2 (see effectivePriorOrders). A first-order account has no history to cite and stays supporting; prior to 2026-07-23 totalOrders === 1 was miscounted as history and scored Strong (prod dispute 235d4152).",
  },
  activity_log: {
    signalId: "account_history",
    labelKey: "disputes.signalLabel.account_history",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when payload.decisiveSessionProof === true (rubric #4 — login + consistent device/session/IP) OR payload.digitalAccessUsed === true (rubric #7 — customer accessed/used digital good). Otherwise supporting. Shares signalId 'account_history' with customer_account_info — counted once in scoring.",
  },
  supporting_documents: {
    signalId: "supplementary_documents",
    labelKey: "disputes.signalLabel.supplementary_documents",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when payload.signedContract === true (rubric #3 — signed agreement / contract). Otherwise supporting (uploaded documents without decisive content).",
  },
  refund_policy: {
    signalId: "policy_refund",
    labelKey: "disputes.signalLabel.policy_refund",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when payload.acceptedAtCheckout === true with a payload.acceptanceTimestamp linking to the order (rubric #8). Otherwise supporting (text only).",
  },
  refund_record: {
    signalId: "refund",
    labelKey: "disputes.signalLabel.refund_record",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Proof a refund was actually issued on the order. Strong when payload.refundStatus === 'processed' with a refunded amount > 0 — decisive for CREDIT_NOT_PROCESSED ('you didn't refund me') disputes. Moderate otherwise. Distinct from refund_policy (the policy text) — this is the transaction record.",
  },
  no_return_initiated: {
    signalId: "refund",
    labelKey: "disputes.signalLabel.no_return_initiated",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Order-level returnStatus === NO_RETURN — the customer never initiated a return. The grounded basis for 'no refund was owed' on a CREDIT_NOT_PROCESSED dispute with no refund issued. Moderate: it supports the not-entitled argument but is not decisive alone (a merchant may owe a refund without a return). Shares signalId 'refund' so it does not double-count against refund_record. The collector only emits this when NO_RETURN AND no refund was issued — never alongside a processed refund (that would be self-contradictory).",
  },
  shipping_policy: {
    signalId: "policy_shipping",
    labelKey: "disputes.signalLabel.policy_shipping",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Same acceptance rule as refund_policy (rubric #8).",
  },
  cancellation_policy: {
    signalId: "policy_cancellation",
    labelKey: "disputes.signalLabel.policy_cancellation",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Same acceptance rule as refund_policy (rubric #8).",
  },

  // ── Strict supporting-only (rubric: never elevates regardless of
  //     payload). Order record, product listing, duplicate explanation
  //     are always supporting per the rubric's GRAY list. ──
  order_confirmation: {
    signalId: "order_record",
    labelKey: "disputes.signalLabel.order_record",
    category: "supporting",
    supportingOnly: true,
    excludedFromStrength: true,
  },
  product_description: {
    signalId: "product_listing",
    labelKey: "disputes.signalLabel.product_listing",
    category: "supporting",
    supportingOnly: true,
    excludedFromStrength: true,
  },
  duplicate_explanation: {
    signalId: "duplicate_explanation",
    labelKey: "disputes.signalLabel.duplicate_explanation",
    category: "supporting",
    supportingOnly: true,
    excludedFromStrength: true,
  },
};

/* ── Categorizer ── */

/**
 * Prior-order count for `customer_account_info` payloads, EXCLUDING the
 * disputed order itself.
 *
 * The collector (`lib/packs/sources/orderSource.ts`) sets `totalOrders`
 * from Shopify's `Customer.numberOfOrders`, which counts EVERY order on
 * the account — including the one now being disputed. "Account history"
 * evidence is only real when the customer bought BEFORE this order, so:
 *
 *   - `priorUndisputedOrders` (explicitly prior) wins when present.
 *   - `isRepeatCustomer` (collector-computed `totalOrders > 1`) is the
 *     next-most-explicit signal.
 *   - Otherwise `totalOrders - 1`, floored at 0.
 *
 * Returns null when the payload carries no usable order-count signal at
 * all — callers treat null as "no history" (conservative).
 *
 * Shared by the categorizer below, `deriveEvidenceLineItems`'s fraud
 * guard, and `factClassifier.extractValue` so every surface counts prior
 * history the same way. (Before 2026-07-23 each consumer read
 * `totalOrders` as if it excluded the disputed order — a first-order
 * account scored Strong and the bank narrative claimed "one prior
 * undisputed order" on the customer's only, disputed, order.)
 */
export function effectivePriorOrders(
  payload: Record<string, unknown> | null | undefined,
): number | null {
  if (!payload) return null;
  const p = payload;
  if (typeof p.priorUndisputedOrders === "number") {
    return Math.max(0, p.priorUndisputedOrders);
  }
  const totalRaw = p.totalOrders;
  const total =
    typeof totalRaw === "number"
      ? totalRaw
      : typeof totalRaw === "string" && totalRaw.trim() !== ""
        ? Number(totalRaw)
        : null;
  if (p.isRepeatCustomer === true) {
    return total !== null && Number.isFinite(total) ? Math.max(1, total - 1) : 1;
  }
  if (p.isRepeatCustomer === false) return 0;
  if (total === null || !Number.isFinite(total)) return null;
  return Math.max(0, total - 1);
}

/**
 * Whether this account's prior orders are known to be dispute-free.
 *
 * THREE states, never a boolean. `customer_account_info` payloads carry
 * `disputeFreeHistory` only when `loadPriorOrderHistory` could VERIFY it
 * against our ingested orders + disputes; a missing key means we do not
 * know, which is not the same as "clean".
 *
 * Every consumer used to spell this `disputeFreeHistory !== false`, so an
 * absent key resolved to `true` and the pack asserted "an established
 * dispute-free order history" to the issuer about accounts we had never
 * checked — including, on blume-box dispute 162042cd, an account with two
 * open chargebacks sitting in our own `disputes` table. Read this helper
 * instead; `unknown` must never render the dispute-free claim.
 */
export type DisputeFreeHistoryState = "dispute_free" | "has_disputes" | "unknown";

export function disputeFreeHistoryState(
  payload: Record<string, unknown> | null | undefined,
): DisputeFreeHistoryState {
  if (!payload) return "unknown";
  if (payload.disputeFreeHistory === true) return "dispute_free";
  if (payload.disputeFreeHistory === false) return "has_disputes";
  // `priorUndisputedOrders` asserts undisputedness in its own name, so a
  // numeric value is itself a verification claim. Producers must emit it
  // ONLY when they actually checked — `loadPriorOrderHistory` withholds
  // it whenever `disputeFreeHistory` is null (partial coverage).
  //
  // `totalOrders` is deliberately NOT accepted here: it is Shopify's raw
  // order count and claims nothing about disputes. Treating it as one is
  // the whole bug — blume-box 162042cd shipped
  // `{ totalOrders: 9, isRepeatCustomer: true }` and we read it as a
  // dispute-free history on an account with two open chargebacks.
  if (typeof payload.priorUndisputedOrders === "number") return "dispute_free";
  return "unknown";
}

/** AVS result codes Shopify exposes that count as a match.
 *  Y = full match (street+zip), A = address match only, W = zip match only,
 *  X = full match (international), D/M = international match. */
const AVS_MATCH_CODES = new Set(["Y", "A", "W", "X", "D", "M"]);
/** CVV result codes that count as a match. M = match. */
const CVV_MATCH_CODES = new Set(["M"]);

/** Delivery proofType discriminator written by the fulfillment
 *  collector. The four canonical states. (P2.3) */
export type DeliveryProofType =
  | "signature_confirmed"
  | "delivered_confirmed"
  | "delivered_unverified"
  | "label_created";

/**
 * Classify an evidence item by `evidenceFieldKey` + payload.
 *
 * The ONE allowed mapper from data → category. Anything that needs to
 * know the category MUST go through this function (or read the
 * persisted `category` cache when its version matches). No alternate
 * paths, no per-family overrides, no UI-side inference.
 */
export function categorizeEvidenceField(
  fieldKey: string,
  payload: Record<string, unknown> | null | undefined,
): EvidenceCategory {
  const spec = CANONICAL_EVIDENCE[fieldKey];
  // Unknown field → invalid (excluded from the system).
  if (!spec) return "invalid";

  // Supporting fields are unconditional — presence is the only check,
  // and supporting items never affect strength.
  if (spec.supportingOnly) {
    return payload ? "supporting" : "invalid";
  }

  const p = (payload ?? {}) as Record<string, unknown>;

  // ── delivery_proof / shipping_tracking ──
  // Rubric #2. signature_confirmed always strong (an independently sourced
  // signature / POD name). delivered_confirmed → moderate. delivered_unverified
  // → supporting. label_created → invalid (explicit negative).
  //
  // Rubric #9 (the "delivered to the verified address" upgrade) was RETIRED on
  // 2026-08-07 by PR-C1: its input was a billing-vs-shipping city comparison,
  // not the AVS match the rule requires. No payload key can restore it.
  //
  // Manual-upload nuance: when `proofType` is absent AND the payload
  // has a `fileName` (i.e. the merchant uploaded a document and assigned
  // it to this checklist row), we cannot auto-verify what kind of
  // delivery proof it is — but we will NOT silently drop it as
  // `label_created` → invalid. The merchant DID provide evidence; treat
  // it as `delivered_unverified` → supporting. To reach moderate or
  // strong, the upload (or auto-collector) must explicitly set proofType.
  if (fieldKey === "delivery_proof" || fieldKey === "shipping_tracking") {
    const explicitProofType =
      typeof p.proofType === "string" ? (p.proofType as DeliveryProofType) : null;
    const looksLikeManualUpload =
      typeof p.fileName === "string" && (p.fileName as string).length > 0;
    const proofType: DeliveryProofType =
      explicitProofType ??
      (looksLikeManualUpload ? "delivered_unverified" : "label_created");
    switch (proofType) {
      case "signature_confirmed":
        return "strong";
      case "delivered_confirmed":
        // MODERATE, always (PR-C1, 2026-08-07).
        //
        // Two upgrade paths used to reach STRONG here and both were
        // unsupported. `deliveredToVerifiedAddress` was derived from a
        // billing-vs-shipping city/country comparison with no AVS input, on a
        // fleet where the issuer's AVS response was `N` for 54 of the 60 packs
        // that asserted it. `collectedByCustomer` was inferred from carrier
        // event message text with no signature or identification artifact.
        // Both keys are now retired (`lib/evidence/model/retiredKeys.ts`) and
        // stripped from every payload before it reaches this function, so this
        // branch cannot be re-armed by a historical pack.
        //
        // A genuine signature or POD name still reaches STRONG through
        // `signature_confirmed` above — that path is untouched.
        return "moderate";
      case "delivered_unverified":
        return "supporting";
      case "label_created":
      default:
        return "invalid";
    }
  }

  // ── avs_cvv_match ── (rubric #1)
  if (fieldKey === "avs_cvv_match") {
    const avs = String(p.avsResultCode ?? "").toUpperCase();
    const cvv = String(p.cvvResultCode ?? "").toUpperCase();
    const avsOk = AVS_MATCH_CODES.has(avs);
    const cvvOk = CVV_MATCH_CODES.has(cvv);
    if (avsOk && cvvOk) return "strong";
    if (avsOk || cvvOk) return "moderate";
    return "invalid";
  }

  // ── tds_authentication ──
  // STRONG  → merchant-confirmed manual upload (tdsVerified === true).
  //           Set only by the manual-confirmation flow, never by the
  //           automatic receipt collector. This is the path that may
  //           cite 3DS as "verified" in bank-rebuttal text.
  // MODERATE → best-effort read from Shopify Payments receiptJson
  //           (tdsAuthenticated === true && verifiedSource === "shopify_receipt").
  //           The contract is unstable and unverifiable, so we contribute
  //           to scoring but never claim verification in submitted text.
  // INVALID  → no decisive payload. Absence of 3DS is never a negative
  //           signal — it's just not present.
  if (fieldKey === "tds_authentication") {
    if (p.tdsVerified === true) return "strong";
    if (p.tdsAuthenticated === true && p.verifiedSource === "shopify_receipt") {
      return "moderate";
    }
    return "invalid";
  }

  // ── billing_address_match ──
  if (fieldKey === "billing_address_match") {
    return p.match === true ? "strong" : "invalid";
  }

  // ── fraud_risk_screening ──
  // Moderate when payload carries ≥1 positiveFacts entry (the collector
  // already enforces LOW + ACCEPT/NONE + provider=shopify before emission,
  // so the empty-array case only occurs on stale rows or hand-rolled fixtures).
  // Never strong: Shopify's risk facts are descriptive, not contractual
  // — see plan §"Classification" (docs/plans/fraud-risk-incorporation.md).
  // Invalid otherwise so the categorizer doesn't quietly accept neutral /
  // negative payloads that bypassed the collector gate.
  if (fieldKey === "fraud_risk_screening") {
    const positiveFacts = p.positiveFacts;
    if (Array.isArray(positiveFacts) && positiveFacts.length > 0) {
      return "moderate";
    }
    return "invalid";
  }

  // ── ip_location_check ──
  // Trust the collector's pre-computed `bankEligible` flag. It's
  // already true ONLY when all three positive conditions hold:
  //   - locationMatch ∈ {same_city, same_country}
  //   - no VPN / proxy / hosting in ipinfo.privacy
  //   - ipConsistencyLevel ∈ {consistent, first_seen}
  // See lib/packs/sources/deviceLocationSource.ts → computeBankEligible.
  //
  // Same-city is the strongest variant (city-level geolocation matching
  // billing) → moderate. Same-country with the rest of the gate clean
  // → supporting (still bank-facing, just less decisive). When the
  // collector says not eligible, the row stays supporting so it never
  // reaches a bank-facing surface via natural categorization — the
  // `isNegativeOrAmbiguous` guard in the line-item resolver routes it
  // to `internal_only` for negative payloads.
  //
  // (Prior to 2026-05-20 this branch checked locationMatch === "match"
  // || "country_match" — values the collector never emits since the
  // 2026-04-21 rename to same_city / same_country. The branch was dead
  // code; everything fell through to "supporting".)
  if (fieldKey === "ip_location_check") {
    if (p.bankEligible !== true) return "supporting";
    if (p.locationMatch === "same_city") return "moderate";
    if (p.locationMatch === "same_country") return "supporting";
    return "supporting";
  }

  // ── device_session_consistency ── (rubric #4)
  // Strong: consistent + login present + IP/device match.
  // Moderate: consistent (no decisive session signals).
  // Supporting: anything else.
  if (fieldKey === "device_session_consistency") {
    if (p.consistent === true && p.loginPresent === true && p.ipMatch === true) {
      return "strong";
    }
    return p.consistent === true ? "moderate" : "supporting";
  }

  // ── customer_communication ── (rubric #6)
  // Strong only when the customer explicitly confirms purchase / delivery
  // / use / satisfaction. Otherwise supporting (mere existence of a
  // conversation is not decisive).
  if (fieldKey === "customer_communication") {
    return p.customerConfirmsOrder === true ? "strong" : "supporting";
  }

  // ── customer_account_info ── (rubric #5: prior undisputed transaction history)
  // Strong: PRIOR undisputed orders exist for this customer — i.e. orders
  // placed before the disputed one. `effectivePriorOrders` excludes the
  // disputed order from the count (Shopify's numberOfOrders includes it),
  // so a first-order account is supporting, never strong: there is no
  // history to cite, and on a fraud claim "brand-new account" is a fraud
  // indicator, not evidence.
  //
  // The rubric says "prior UNDISPUTED transaction history", so Strong
  // requires the undisputed half to be VERIFIED, not assumed:
  //   dispute_free  + priors → strong   (the rubric's actual case)
  //   unknown       + priors → moderate (real returning-customer context,
  //                            but we never checked for prior disputes)
  //   has_disputes           → supporting (opposite inference)
  // Before 2026-08-01 `unknown` was scored Strong because the flag
  // defaulted to true — see disputeFreeHistoryState.
  if (fieldKey === "customer_account_info") {
    const state = disputeFreeHistoryState(p);
    if (state === "has_disputes") return "supporting";
    const prior = effectivePriorOrders(p);
    if (prior !== null && prior >= 1) {
      return state === "dispute_free" ? "strong" : "moderate";
    }
    return "supporting";
  }

  // ── activity_log ── (rubric #4 + #7)
  // Strong: decisive session proof (login + consistent device/session/IP)
  // OR digital access proof (customer accessed, downloaded, activated,
  // logged in, or used the product/service). Otherwise supporting.
  if (fieldKey === "activity_log") {
    if (p.decisiveSessionProof === true || p.digitalAccessUsed === true) {
      return "strong";
    }
    return "supporting";
  }

  // ── supporting_documents ── (rubric #3: signed agreement / contract)
  // Strong only when the payload explicitly identifies the upload as a
  // signed contract or agreement. Otherwise supporting (manual screenshots
  // and uploaded documents without decisive content).
  if (fieldKey === "supporting_documents") {
    return p.signedContract === true ? "strong" : "supporting";
  }

  // ── policy fields ── (rubric #8)
  // Strong only when the customer explicitly accepted the policy at
  // checkout AND we have a timestamp linking the acceptance to the
  // order. Plain text disclosure stays supporting.
  if (
    fieldKey === "refund_policy" ||
    fieldKey === "shipping_policy" ||
    fieldKey === "cancellation_policy"
  ) {
    if (p.acceptedAtCheckout === true && p.acceptanceTimestamp) return "strong";
    return "supporting";
  }

  // ── refund_record ──
  // A refund actually issued on the order. Strong when the refund is
  // processed for a positive amount — this is the decisive fact for a
  // "credit not processed" dispute (the customer claims no refund; the
  // record proves otherwise). A pending/zero refund is not decisive.
  if (fieldKey === "refund_record") {
    const amount =
      typeof p.amount === "number"
        ? p.amount
        : typeof p.amount === "string"
          ? Number.parseFloat(p.amount)
          : 0;
    if (p.refundStatus === "processed" && Number.isFinite(amount) && amount > 0) {
      return "strong";
    }
    return "moderate";
  }

  // Unknown conditional field — fall back to the default category.
  return spec.category;
}

/* ── Helpers ── */

/** Returns the spec for a field key, or null when unregistered. */
export function getCanonicalSpec(fieldKey: string): CanonicalSpec | null {
  return CANONICAL_EVIDENCE[fieldKey] ?? null;
}

/** Resolves the effective category — short-circuits to the persisted
 *  cache when its `categoryVersion` matches; otherwise re-derives via
 *  `categorizeEvidenceField`. Plan §P2.4a. */
export function categoryFor(args: {
  fieldKey: string;
  payload: Record<string, unknown> | null | undefined;
  cached?: PersistedCategory | null;
}): EvidenceCategory {
  const { fieldKey, payload, cached } = args;
  if (cached && cached.categoryVersion === CANONICAL_EVIDENCE_VERSION) {
    return cached.category;
  }
  return categorizeEvidenceField(fieldKey, payload);
}

/** True when adding this category to the case can affect overall
 *  strength. Always false for `supporting` and `invalid`. */
export function affectsStrength(category: EvidenceCategory): boolean {
  return category === "strong" || category === "moderate";
}

