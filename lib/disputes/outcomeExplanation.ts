/**
 * Decided-dispute explanation — what we filed, and the likely deciding factor.
 *
 * A decided dispute used to render the live-case assessment vocabulary:
 * "Evidence assessment: Not yet assessed" and "No evidence available." Both
 * were false on cases we had fully defended. Two separate defects produced
 * that (see `docs/plans/lost-dispute-explanation.plan.md` §1):
 *
 *   (a) `assessmentPresence.mayRenderVerdict` asks "is the assessment fresh
 *       enough to FILE against?" That gate is correct for a live case and
 *       meaningless once the bank has decided — nothing will be re-filed and
 *       the snapshot is SUPPOSED to be stale. It answers "not fresh"; the UI
 *       mistranslated that to "never assessed".
 *   (b) `strengthReasonText` had no `assessed` guard at all, so the empty
 *       sentinel's "No evidence available." printed as a factual claim.
 *
 * This module replaces both on terminal disputes with one sentence grounded
 * in the facts we actually recorded. It decides NOTHING about filing and is
 * never consulted while a case is live.
 *
 * ── Two rules that are load-bearing, not stylistic ──────────────────────
 *
 * 1. MERCHANT-FACING ONLY. These strings must never reach `narrative_json`
 *    or a generated PDF. Naming our own evidentiary weaknesses to an issuer
 *    is the bank-optimised-rebuttal violation: a rebuttal states what
 *    strengthens the case and never volunteers what undermines it.
 *
 * 2. NEVER ASSERT CAUSATION. We cannot know why the bank decided as it did —
 *    `ShopifyPaymentsDispute` exposes `status` + `finalizedOn` and nothing
 *    else, verified across Admin GraphQL 2025-10 / 2026-01 / unstable, and
 *    the issuer's own rationale packet is Admin-UI-only. Copy therefore says
 *    "banks weight this heavily", never "you lost because".
 */

import type { I18nToken } from "@/lib/i18n/token";
import { resolveReasonFamily } from "@/lib/argument/reasonFamily";
import { readPaymentVerification } from "@/lib/argument/paymentVerification";
import { detectCardholderNameMismatch, cardholderNameFromPayload } from "@/lib/argument/nameMismatch";
import { disputeFreeHistoryState } from "@/lib/argument/canonicalEvidence";

const DELIVERY_CONFIRMED = new Set(["delivered_confirmed", "signature_confirmed"]);

export type OutcomeFactorCode =
  // loss side
  | "avs_mismatch"
  | "cardholder_name_mismatch"
  | "prior_chargebacks"
  | "ip_country_mismatch"
  | "ip_high_risk"
  | "no_signature_on_fraud"
  | "no_delivery_confirmation"
  | "weak_identity_signals"
  // win side
  | "signature_confirmed"
  | "avs_match"
  | "delivery_confirmed";

export interface OutcomeFactor {
  code: OutcomeFactorCode;
  /** Merchant copy. A token, never English — `lib/**` emits tokens only. */
  token: I18nToken;
  /** `observed` = read directly off a recorded fact. `likely` = inferred
   *  from the absence or coarseness of a signal. Callers may surface the
   *  distinction; today only ranking uses it. */
  confidence: "observed" | "likely";
}

/**
 * Resolved state of a decided dispute.
 *
 * The discriminator is **whether a defence package exists**, NOT
 * `disputes.submission_state`. That flag is true on 390 disputes which
 * closed before the shop ever installed DisputeDesk — it records that a
 * response reached Shopify, not who assembled it. Gating on it would make
 * the product claim credit for evidence a merchant filed themselves years
 * earlier (`scripts/sql/filed-by-whom.sql`).
 */
export type OutcomeExplanation =
  | { kind: "we_defended_with_facts"; filedAt: string | null; factors: OutcomeFactor[] }
  | { kind: "we_defended_no_facts"; filedAt: string | null }
  | { kind: "not_defended_by_us" };

/** Shape of one classified fact as persisted in `defence_packages.facts_json`. */
interface PersistedFact {
  value?: Record<string, unknown> | null;
}

function factsByFieldKey(facts: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(facts)) return out;
  for (const raw of facts as PersistedFact[]) {
    const value = raw?.value;
    if (!value || typeof value !== "object") continue;
    const key = (value as { fieldKey?: unknown }).fieldKey;
    if (typeof key === "string" && !out.has(key)) out.set(key, value as Record<string, unknown>);
  }
  return out;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

const token = (code: OutcomeFactorCode): I18nToken => ({
  key: `disputes.outcomeExplanation.factor.${code}`,
});

/**
 * Derive ranked factors from the facts we filed.
 *
 * Ranking is the declaration order below — strongest/most-decisive first —
 * because only the top-ranked factor is rendered. A header line names one
 * thing or it stops being a header line.
 *
 * Returning an EMPTY array is a valid, expected result. The caller renders
 * the plain "we filed on {date}" copy in that case. Padding with a generic
 * filler factor would be an invented claim, which is exactly what this
 * module exists to prevent.
 */
export function deriveOutcomeFactors(input: {
  facts: unknown;
  reason: string | null;
  outcome: "won" | "lost";
  customerName?: string | null;
}): OutcomeFactor[] {
  const byKey = factsByFieldKey(input.facts);
  const family = resolveReasonFamily(input.reason);
  const isFraud = family === "fraud";

  /* AVS is read through `readPaymentVerification`, the single owner of
   * AVS/CVV semantics — never by testing raw letters here. That owner is
   * network-aware (the same letter does not mean the same thing on every
   * network) and normalizes the three historical payload shapes still live
   * in `facts_json`. A second match set is the exact defect
   * `tests/unit/paymentVerificationSingleOwner.test.ts` exists to prevent:
   * there were once six, kept aligned by comment, and two had drifted.
   *
   * `outcome` is the canonical reading: "match" | "no_match" | "unchecked".
   * Only an explicit `no_match` is a loss factor — `unchecked` means the
   * issuer returned nothing, which is an absence of evidence and never
   * evidence of a mismatch. */
  const avs = byKey.get("avs_cvv_match");
  const avsOutcome = avs ? readPaymentVerification(avs).avs.outcome : null;

  const delivery = byKey.get("delivery_proof") ?? byKey.get("shipping_tracking");
  const proofType = str(delivery?.proofType);
  const signedBy = str(delivery?.signedByName);
  const deliveryConfirmed = proofType !== null && DELIVERY_CONFIRMED.has(proofType);

  const factors: OutcomeFactor[] = [];

  if (input.outcome === "lost") {
    if (avsOutcome === "no_match") {
      factors.push({ code: "avs_mismatch", token: token("avs_mismatch"), confidence: "observed" });
    }
    const cardholderName = avs ? cardholderNameFromPayload(avs) : null;
    if (isFraud && detectCardholderNameMismatch(cardholderName, input.customerName ?? null)) {
      factors.push({
        code: "cardholder_name_mismatch",
        token: token("cardholder_name_mismatch"),
        confidence: "observed",
      });
    }
    const account = byKey.get("customer_account_info");
    if (isFraud && disputeFreeHistoryState(account) === "has_disputes") {
      factors.push({
        code: "prior_chargebacks",
        token: token("prior_chargebacks"),
        confidence: "observed",
      });
    }
    const ip = byKey.get("ip_location_check");
    const locationMatch = str(ip?.locationMatch);
    const riskLevel = str(ip?.riskLevel);
    if (isFraud && locationMatch === "different_country") {
      factors.push({
        code: "ip_country_mismatch",
        token: token("ip_country_mismatch"),
        confidence: "observed",
      });
    }
    if (isFraud && riskLevel === "high") {
      factors.push({ code: "ip_high_risk", token: token("ip_high_risk"), confidence: "observed" });
    }
    // Only meaningful on a fraud claim: an unsigned delivery is unremarkable
    // on a not-received or product dispute, where delivery itself is the
    // question rather than who took possession.
    if (isFraud && deliveryConfirmed && signedBy === null) {
      factors.push({
        code: "no_signature_on_fraud",
        token: token("no_signature_on_fraud"),
        confidence: "observed",
      });
    }
    // Only where delivery is actually at issue. On a refund, duplicate or
    // subscription dispute the parcel is not what the bank is weighing, and
    // "no delivery confirmation reached us" would be a true statement that
    // explains nothing — worse, it would read as our own fault on a case
    // that never turned on shipping.
    if (!deliveryConfirmed && (isFraud || family === "delivery" || family === "product")) {
      factors.push({
        code: "no_delivery_confirmation",
        token: token("no_delivery_confirmation"),
        confidence: "observed",
      });
    }
    if (isFraud && (locationMatch === null || locationMatch === "same_country")) {
      factors.push({
        code: "weak_identity_signals",
        token: token("weak_identity_signals"),
        confidence: "likely",
      });
    }
    return factors;
  }

  // ── Won side ────────────────────────────────────────────────────────────
  // Predicates are the same signals read positively. They are NOT yet
  // validated against production: the only won dispute holding a package is
  // a Klarna inquiry (`payment_context.family = "klarna"`, `cardNetwork:
  // null`), where AVS, CVV and signature do not exist at all — so these
  // cannot fire there and must not be tuned against that case. Expect an
  // empty array until a card-network win is decided post-install; the caller
  // degrades to the plain sentence, which is the honest output.
  if (signedBy !== null) {
    factors.push({
      code: "signature_confirmed",
      token: token("signature_confirmed"),
      confidence: "observed",
    });
  }
  if (avsOutcome === "match") {
    factors.push({ code: "avs_match", token: token("avs_match"), confidence: "observed" });
  }
  if (deliveryConfirmed) {
    factors.push({
      code: "delivery_confirmed",
      token: token("delivery_confirmed"),
      confidence: "observed",
    });
  }
  return factors;
}

/**
 * Resolve the full explanation for a decided dispute.
 *
 * `pack` is the submitted defence package, or null when none exists. Its
 * presence — not any flag on the dispute row — is what distinguishes a case
 * DisputeDesk defended from a historical import.
 */
export function resolveOutcomeExplanation(input: {
  outcome: "won" | "lost";
  reason: string | null;
  pack: { submittedAt: string | null; facts: unknown } | null;
  customerName?: string | null;
}): OutcomeExplanation {
  if (!input.pack) return { kind: "not_defended_by_us" };

  const factors = deriveOutcomeFactors({
    facts: input.pack.facts,
    reason: input.reason,
    outcome: input.outcome,
    customerName: input.customerName,
  });

  if (factors.length === 0) {
    return { kind: "we_defended_no_facts", filedAt: input.pack.submittedAt };
  }
  return { kind: "we_defended_with_facts", filedAt: input.pack.submittedAt, factors };
}

/**
 * The single sentence rendered in the hero header and, in resolved form, as
 * a paragraph in the outcome email. One derivation feeding both surfaces is
 * deliberate: a merchant who reads the email and then opens the app must not
 * see two different explanations of the same decision.
 *
 * Returns null when there is nothing honest to say — `not_defended_by_us`
 * with no date, for instance. The caller renders nothing rather than a
 * placeholder.
 */
export function outcomeExplanationToken(
  explanation: OutcomeExplanation,
  outcome: "won" | "lost",
  formattedDate: string | null,
): I18nToken | null {
  switch (explanation.kind) {
    case "not_defended_by_us":
      return { key: "disputes.outcomeExplanation.notDefendedByUs" };
    case "we_defended_no_facts":
      if (!formattedDate) return null;
      return {
        key: `disputes.outcomeExplanation.filedNoFactors.${outcome}`,
        params: { date: formattedDate },
      };
    case "we_defended_with_facts": {
      if (!formattedDate) return null;
      const top = explanation.factors[0];
      return {
        key: `disputes.outcomeExplanation.filedWithFactor.${outcome}`,
        params: {
          date: formattedDate,
          clause: { type: "i18n-key", key: top.token.key },
        },
      };
    }
  }
}
