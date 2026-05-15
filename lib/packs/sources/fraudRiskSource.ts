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
 *      - risk_level = LOW
 *      - recommendation IN (ACCEPT, NONE)
 *      - provider = "shopify" (third-party app scores are not cited;
 *        their wording is unpredictable and may not be defensible)
 *      - at least one POSITIVE-sentiment fact
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

export interface FraudRiskScreeningData extends Record<string, unknown> {
  /** Source provider — always "shopify" given the eligibility gate. */
  provider: string;
  /** Risk level as Shopify reported it. Always "LOW" given the gate. */
  riskLevel: string;
  /** Recommendation as Shopify reported it. ACCEPT or NONE. */
  recommendation: string;
  /** Positive-sentiment fact descriptions, capped at
   *  MAX_POSITIVE_FACTS_CITED. Order preserves Shopify's response. */
  positiveFacts: string[];
  /** When the assessment was generated (Shopify's `assessed_at`). */
  assessedAt: string | null;
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

  // Eligibility gate.
  const riskLevel = (shopifyRow.risk_level ?? "").toUpperCase();
  const recommendation = (shopifyRow.recommendation ?? "").toUpperCase();
  if (riskLevel !== "LOW") return [];
  if (recommendation !== "ACCEPT" && recommendation !== "NONE") return [];

  // Rule #3 — extract ONLY positive-sentiment facts.
  const positiveFacts = extractPositiveFacts(
    shopifyRow.facts_json,
    shopifyRow.fact_sentiments,
  );
  if (positiveFacts.length === 0) return [];

  const data: FraudRiskScreeningData = {
    provider: SHOPIFY_PROVIDER,
    riskLevel,
    recommendation,
    positiveFacts: positiveFacts
      .slice(0, MAX_POSITIVE_FACTS_CITED)
      .map((f) => f.description),
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

function stringDescription(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
