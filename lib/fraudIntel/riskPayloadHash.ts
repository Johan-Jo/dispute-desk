/**
 * Deterministic SHA-256 of a Shopify risk payload.
 *
 * Used by the orders/* webhook ingest path to detect whether the latest
 * shopify_order_risk_assessments row already captures this exact payload.
 * Without dedup, orders/updated would append a fresh assessment row for
 * every fulfillment / tag / note / address edit — none of which change
 * the risk signals.
 *
 * The hash inputs (in canonical order):
 *   - recommendation: the top-level Order.risk.recommendation enum
 *   - assessments: each assessment's riskLevel + provider + sorted facts
 *     (facts sorted by description+sentiment so Shopify's array order
 *     never affects the hash).
 *
 * The hash deliberately does NOT include timestamps, IDs, or anything
 * Shopify might assign or vary between fetches. Two responses that
 * describe the same risk verdict must produce the same hash, full stop.
 *
 * Pure: zero IO, no DB, no Shopify. Trivially testable.
 */

import { createHash } from "node:crypto";

export interface RiskFact {
  description: string | null;
  sentiment: string | null;
}

export interface RiskAssessmentForHash {
  riskLevel: string | null;
  provider: string | null;
  facts: RiskFact[] | null;
}

export interface RiskPayloadForHash {
  recommendation: string | null;
  assessments: RiskAssessmentForHash[] | null;
}

/**
 * Compute the canonical SHA-256 of a risk payload. Returns a lowercase
 * hex string. Empty/null inputs are tolerated and produce a stable hash
 * for "no risk signal" — those payloads also dedup with each other so
 * downstream history doesn't grow with churn.
 */
export function computeRiskPayloadHash(payload: RiskPayloadForHash): string {
  const canonical = canonicalize(payload);
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json).digest("hex");
}

function canonicalize(payload: RiskPayloadForHash): {
  recommendation: string | null;
  assessments: Array<{
    riskLevel: string | null;
    provider: string | null;
    facts: Array<{ description: string; sentiment: string }>;
  }>;
} {
  const assessments = (payload.assessments ?? []).map((a) => {
    const facts = (a.facts ?? [])
      .map((f) => ({
        description: (f.description ?? "").trim(),
        sentiment: (f.sentiment ?? "").trim().toUpperCase(),
      }))
      .filter((f) => f.description.length > 0 || f.sentiment.length > 0);
    facts.sort((x, y) => {
      const byDesc = x.description.localeCompare(y.description);
      return byDesc !== 0 ? byDesc : x.sentiment.localeCompare(y.sentiment);
    });
    return {
      riskLevel: normalizeEnumish(a.riskLevel),
      provider: (a.provider ?? "").trim() || null,
      facts,
    };
  });

  // Sort assessments by (provider, riskLevel) so Shopify's array order
  // is irrelevant. Two responses with the same providers/levels/facts
  // hash identically.
  assessments.sort((x, y) => {
    const p = (x.provider ?? "").localeCompare(y.provider ?? "");
    if (p !== 0) return p;
    return (x.riskLevel ?? "").localeCompare(y.riskLevel ?? "");
  });

  return {
    recommendation: normalizeEnumish(payload.recommendation),
    assessments,
  };
}

function normalizeEnumish(v: string | null | undefined): string | null {
  if (v == null) return null;
  const trimmed = v.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}
