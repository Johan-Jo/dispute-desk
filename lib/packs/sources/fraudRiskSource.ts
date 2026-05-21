/**
 * Fraud-risk evidence collector (Phase 1 of fraud-risk incorporation).
 *
 * For fraud-family disputes only, surface Shopify's own pre-authorization
 * risk screening as supporting evidence. The data comes from the
 * `shopify_order_risk_assessments` table, populated by the orders
 * backfill ingestion that's been running for weeks
 * (lib/shopify/queries/ordersForBackfill.ts).
 *
 * # Hard rules
 *
 * 1. **Fraud-family reasons only.** Risk screening is irrelevant to
 *    PRODUCT_NOT_RECEIVED, DUPLICATE, etc. The collector emits nothing
 *    outside FRAUDULENT / UNRECOGNIZED.
 *
 * 2. **Eligibility is strict.** Every condition must hold:
 *      - risk_level IN (LOW, NONE)
 *      - recommendation IN (ACCEPT, NONE)
 *      - provider = "shopify" (third-party app scores are not cited;
 *        their wording is unpredictable and may not be defensible)
 *      - at least one POSITIVE-sentiment fact
 *
 *    Note on risk_level=NONE: live Shopify responses (2026-05) show
 *    NONE returned alongside `recommendation: ACCEPT` and a populated
 *    facts array — i.e. Shopify analysed the order and found no
 *    concerning signals, not "Shopify didn't analyse." The
 *    recommendation field is the authoritative bank-facing verdict;
 *    risk_level is supporting detail. The recommendation gate below
 *    is the real safety check.
 *
 * 3. **No negative leakage.** The collector emits ONLY positive-sentiment
 *    facts. Neutral and negative facts are dropped. A HIGH or
 *    INVESTIGATE assessment produces NO section at all — absence is
 *    never a negative signal (same rule as 3-D Secure).
 *
 * 4. **Moderate, never Strong.** The categorizer in
 *    `lib/argument/canonicalEvidence.ts` pins `fraud_risk_screening`
 *    at moderate regardless of payload — see the supportingOnly:false,
 *    category:"moderate" entry there. Rationale: Shopify's risk facts
 *    are descriptive, not contractual.
 *
 * 5. **No re-fetch.** This collector reads only the snapshot persisted
 *    by the orders backfill. Shopify may rescore late; tracking that
 *    is a Phase 2 problem and not addressed here.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { isFraudFamilyReason } from "@/lib/disputes/networkReasonCode";
import type { BuildContext, EvidenceSection } from "../types";

const SHOPIFY_PROVIDER = "shopify";

/** Cap on facts cited in the bank-rebuttal sentence so we never produce
 *  a sprawling list that bores the reviewer. Tunable. */
export const MAX_POSITIVE_FACTS_CITED = 3;

/** Cap on the negative-sentiment facts surfaced on the internal-only
 *  branch. These NEVER reach the bank or the LLM — the categorizer
 *  returns "invalid" for fraud_risk_screening with empty positiveFacts
 *  (see `lib/argument/canonicalEvidence.ts`) so the row is skipped by
 *  the factClassifier. The negative-fact list is merchant-UI-only and
 *  exists so the "Kept internal" row can explain WHY Shopify
 *  recommended CANCEL/REJECT/INVESTIGATE. */
export const MAX_NEGATIVE_FACTS_CITED = 3;

interface RiskAssessmentRow {
  id: string;
  provider: string | null;
  risk_level: string | null;
  recommendation: string | null;
  facts_json: unknown;
  fact_sentiments: unknown;
  assessed_at: string | null;
  snapshot_at: string | null;
}

interface PositiveFact {
  description: string;
  /** Catalog of sentiment values we accept; "POSITIVE" or "positive". */
  sentiment: "POSITIVE";
}

interface NegativeFact {
  description: string;
  sentiment: "NEGATIVE";
}

export interface FraudRiskScreeningData extends Record<string, unknown> {
  /** Source provider — always "shopify" given the eligibility gate. */
  provider: string;
  /** Risk level as Shopify reported it. LOW / NONE on the positive path;
   *  anything else (HIGH, MEDIUM) on the internal-only path. */
  riskLevel: string;
  /** Recommendation as Shopify reported it. ACCEPT/NONE on the positive
   *  path; CANCEL/INVESTIGATE/REJECT on the internal-only path. */
  recommendation: string;
  /** Positive-sentiment fact descriptions, capped at
   *  MAX_POSITIVE_FACTS_CITED. Order preserves Shopify's response.
   *  Empty array on the internal-only path (a non-ACCEPT verdict). */
  positiveFacts: string[];
  /**
   * Negative-sentiment fact descriptions Shopify returned alongside an
   * unfavourable verdict (capped at MAX_NEGATIVE_FACTS_CITED). Populated
   * ONLY on the internal-only path so the merchant can read WHY Shopify
   * recommended CANCEL/REJECT/INVESTIGATE — e.g. "Shipping address is
   * 6709 km from IP address". Order preserves Shopify's response.
   *
   * **Safety contract:** these strings are merchant-UI-only and are
   * NEVER cited to the bank or fed to the LLM. The guarantee is
   * structural:
   *   1. `negativeFacts` is only set when `isNegativeVerdict === true`,
   *      which implies `positiveFacts.length === 0`.
   *   2. The canonical-evidence categorizer returns `"invalid"` for
   *      fraud_risk_screening payloads with empty `positiveFacts`
   *      (`lib/argument/canonicalEvidence.ts`), so the factClassifier
   *      skips the row entirely.
   *   3. The LLM payload extractor (`lib/defence/factClassifier.ts`
   *      `extractValue`) only ever reads `positiveFacts`, never
   *      `negativeFacts`.
   * Even if step 2 fails, step 3 still blocks the leak.
   *
   * Empty array on the ACCEPT path (no negative facts to cite anyway).
   */
  negativeFacts: string[];
  /** When the assessment was generated (Shopify's `assessed_at`). */
  assessedAt: string | null;
  /**
   * True when Shopify ran the screening AND returned an unfavorable
   * verdict (non-ACCEPT recommendation, or HIGH/MEDIUM risk_level). The
   * line-item resolver routes these rows to `internal_only` so the
   * merchant sees "we checked, kept the verdict off the bank submission"
   * instead of nothing at all. The LLM payload filter still skips this
   * data because the canonicalEvidence categorizer returns `"invalid"`
   * for fraud_risk_screening with no positiveFacts.
   */
  isNegativeVerdict?: boolean;
}

export async function collectFraudRiskEvidence(
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  // Rule #1 — fraud-family reasons only.
  if (!isFraudFamilyReason(ctx.disputeReason)) return [];

  // Need an order GID to join on.
  if (!ctx.orderGid) return [];

  const sb = getServiceClient();

  // Pull the persisted snapshot. We do NOT call Shopify here — the
  // orders backfill owns ingestion. If no row exists yet, the dispute
  // simply has no signal (same posture as 3-D Secure).
  const { data: rows, error } = await sb
    .from("shopify_order_risk_assessments")
    .select(
      "id, provider, risk_level, recommendation, facts_json, fact_sentiments, assessed_at, snapshot_at",
    )
    .eq("shop_id", ctx.shopId)
    .eq("shopify_order_id", ctx.orderGid);

  if (error) {
    // Read failure is silent. The build continues without the signal.
    console.warn(
      `[fraudRiskSource] read failed for order ${ctx.orderGid}:`,
      error.message,
    );
    return [];
  }
  if (!rows || rows.length === 0) return [];

  // Rule #2 — pick the Shopify-provider row. Third-party scores are
  // never cited in the rebuttal (see file header). If no Shopify row
  // exists, no signal.
  const shopifyRow = (rows as RiskAssessmentRow[]).find(
    (r) => (r.provider ?? "").toLowerCase() === SHOPIFY_PROVIDER,
  );
  if (!shopifyRow) return [];

  // Eligibility gate. See file header rule #2 — the positive (bank-
  // facing) path requires LOW/NONE risk_level + ACCEPT/NONE
  // recommendation + ≥1 POSITIVE fact. Anything else falls into the
  // internal-only branch below: we still emit a section so the merchant
  // sees "we checked, the verdict was unfavorable" instead of nothing
  // at all, but the line-item resolver routes it to "Kept internal"
  // and the canonicalEvidence categorizer returns `"invalid"` for the
  // empty positiveFacts payload — guaranteeing the data NEVER reaches
  // the LLM or the bank submission.
  const riskLevel = (shopifyRow.risk_level ?? "").toUpperCase();
  const recommendation = (shopifyRow.recommendation ?? "").toUpperCase();

  const positiveFacts = extractPositiveFacts(
    shopifyRow.facts_json,
    shopifyRow.fact_sentiments,
  );

  const isAcceptPath =
    (riskLevel === "LOW" || riskLevel === "NONE") &&
    (recommendation === "ACCEPT" || recommendation === "NONE") &&
    positiveFacts.length > 0;

  if (isAcceptPath) {
    const data: FraudRiskScreeningData = {
      provider: SHOPIFY_PROVIDER,
      riskLevel,
      recommendation,
      positiveFacts: positiveFacts
        .slice(0, MAX_POSITIVE_FACTS_CITED)
        .map((f) => f.description),
      negativeFacts: [],
      assessedAt: shopifyRow.assessed_at,
    };
    return [
      {
        type: "other",
        label: "Pre-authorization fraud screening",
        source: "shopify_order_risk_assessments",
        fieldsProvided: ["fraud_risk_screening"],
        data,
      },
    ];
  }

  // Internal-only path. Shopify ran the screening and returned an
  // unfavorable verdict (or there are no positive facts to cite, which
  // amounts to the same thing). Emit a section with positiveFacts:[]
  // so the row shows up in "Kept internal" on the Overview — citing
  // it to the bank would weaken the case, but hiding it entirely is
  // dishonest UX (looks like we never checked).
  //
  // Surface the NEGATIVE-sentiment facts that drove the verdict so the
  // merchant sees WHY Shopify recommended against the order ("Shipping
  // address is 6709 km from IP location" etc.) instead of a blank
  // "kept internal" row. These strings are merchant-UI-only and are
  // structurally blocked from the bank/LLM — see the negativeFacts
  // safety contract in FraudRiskScreeningData.
  //
  // The LLM safety contract is preserved by the canonicalEvidence
  // categorizer: `fraud_risk_screening` with empty positiveFacts
  // categorizes as `"invalid"`, which the factClassifier skips →
  // no fact in defence_packages.facts_json → no bank-facing leakage.
  const negativeFacts = extractNegativeFacts(
    shopifyRow.facts_json,
    shopifyRow.fact_sentiments,
  );
  const negativeData: FraudRiskScreeningData = {
    provider: SHOPIFY_PROVIDER,
    riskLevel,
    recommendation,
    positiveFacts: [],
    negativeFacts: negativeFacts
      .slice(0, MAX_NEGATIVE_FACTS_CITED)
      .map((f) => f.description),
    assessedAt: shopifyRow.assessed_at,
    isNegativeVerdict: true,
  };
  return [
    {
      type: "other",
      label: "Pre-authorization fraud screening",
      source: "shopify_order_risk_assessments",
      fieldsProvided: ["fraud_risk_screening"],
      data: negativeData,
    },
  ];
}

/**
 * Walk the (facts_json, fact_sentiments) pair and return only the
 * POSITIVE-sentiment facts.
 *
 * Tolerated shapes (verified against live Shopify backfill data):
 *
 *   a) facts_json is an array of strings; fact_sentiments is a parallel
 *      array of "POSITIVE" / "NEUTRAL" / "NEGATIVE" tags.
 *
 *   b) facts_json is an array of `{ description, sentiment }` objects
 *      (Shopify Admin GraphQL 2026-01 shape under `risk.assessments.facts[]`).
 *
 *   c) fact_sentiments is null and facts_json carries the sentiment
 *      inline. Fall back to (b).
 *
 *   d) Both null or unrecognized — return [].
 */
function extractPositiveFacts(
  factsJson: unknown,
  factSentiments: unknown,
): PositiveFact[] {
  const out: PositiveFact[] = [];

  // Shape (a): parallel arrays.
  if (Array.isArray(factsJson) && Array.isArray(factSentiments)) {
    for (let i = 0; i < factsJson.length; i++) {
      const sentiment = String(factSentiments[i] ?? "").toUpperCase();
      if (sentiment !== "POSITIVE") continue;
      const description = stringDescription(factsJson[i]);
      if (description) out.push({ description, sentiment: "POSITIVE" });
    }
    return out;
  }

  // Shape (b) / (c): array of objects with sentiment inline.
  if (Array.isArray(factsJson)) {
    for (const raw of factsJson) {
      if (!isPlainObject(raw)) {
        // String-only fact with no sentiment metadata: cannot classify,
        // skip. We refuse to assume any unclassified fact is positive.
        continue;
      }
      const sentiment = String(
        (raw.sentiment as unknown) ?? "",
      ).toUpperCase();
      if (sentiment !== "POSITIVE") continue;
      const description = stringDescription(raw.description);
      if (description) out.push({ description, sentiment: "POSITIVE" });
    }
    return out;
  }

  return out;
}

/**
 * Walk the (facts_json, fact_sentiments) pair and return only the
 * NEGATIVE-sentiment facts. Mirrors `extractPositiveFacts` shape-for-
 * shape so future Shopify response variations are handled uniformly.
 *
 * NEUTRAL facts are intentionally dropped: they're descriptive scaffolding
 * ("Location of IP address is Rio de Janeiro"), not reasons. Citing them
 * as "why Shopify said cancel" would mislead the merchant.
 */
function extractNegativeFacts(
  factsJson: unknown,
  factSentiments: unknown,
): NegativeFact[] {
  const out: NegativeFact[] = [];

  // Shape (a): parallel arrays.
  if (Array.isArray(factsJson) && Array.isArray(factSentiments)) {
    for (let i = 0; i < factsJson.length; i++) {
      const sentiment = String(factSentiments[i] ?? "").toUpperCase();
      if (sentiment !== "NEGATIVE") continue;
      const description = stringDescription(factsJson[i]);
      if (description) out.push({ description, sentiment: "NEGATIVE" });
    }
    return out;
  }

  // Shape (b) / (c): array of objects with sentiment inline.
  if (Array.isArray(factsJson)) {
    for (const raw of factsJson) {
      if (!isPlainObject(raw)) continue;
      const sentiment = String(
        (raw.sentiment as unknown) ?? "",
      ).toUpperCase();
      if (sentiment !== "NEGATIVE") continue;
      const description = stringDescription(raw.description);
      if (description) out.push({ description, sentiment: "NEGATIVE" });
    }
    return out;
  }

  return out;
}

function stringDescription(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
