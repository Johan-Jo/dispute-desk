/**
 * LLM explanation layer (design §22). Turns a VALIDATED recommendation object
 * into merchant-friendly prose — nothing more. The structured object stays
 * authoritative; the LLM must not recalculate, change amounts, upgrade
 * confidence, reclassify, invent recommendations, call evidence "strong"
 * without support, recommend automatic non-response, or suppress limitations.
 *
 * No raw PII ever crosses the boundary — recommendation objects are aggregate
 * by construction. The prompt builder is pure and unit-tested.
 */

import { callClaudeMessages, type ClaudeSystemBlock } from "@/lib/defence/anthropicClient";
import type { RecommendationRow } from "../types";

export const EXPLANATION_PROMPT_VERSION = "intel_explain_v1";
const MODEL = "claude-sonnet-4-6";

const SYSTEM_RULES = `You convert a single, already-validated dispute-intelligence recommendation into clear, professional prose for a Shopify merchant.

HARD RULES — you MUST follow all of them:
1. Use ONLY the numbers and facts in the provided recommendation object. Do NOT recalculate, re-derive, round differently, or invent any number.
2. Do NOT change any amount, rate, count, confidence level, or evidence grade.
3. Do NOT reclassify the dispute, its reason, or any evidence. Do NOT call any evidence "strong" unless the object already says so.
4. Do NOT make causal claims. This is a historical association, not proof that an action caused an outcome. Prefer wording like "is associated with" / "historically".
5. Do NOT recommend automatically skipping, not-responding to, or auto-submitting any dispute. This is decision support only.
6. Do NOT omit or soften the limitations — restate them plainly.
7. Keep it concise (2 short paragraphs max) and neutral. No hype.
8. Never invent a recommendation beyond the one provided.

Output plain prose only (no JSON, no headings).`;

/** Build the exact system + user payload. Pure — testable without the network. */
export function buildExplanationPrompt(rec: RecommendationRow): {
  system: ClaudeSystemBlock[];
  user: string;
} {
  // Only structured, aggregate fields — never raw records or PII.
  const payload = {
    category: rec.category,
    title: rec.title,
    summary: rec.summary,
    suggestedAction: rec.suggested_action,
    affectedDisputeCount: rec.affected_dispute_count,
    affectedOrderCount: rec.affected_order_count,
    currency: rec.currency,
    affectedDisputedMinor: rec.affected_disputed_minor,
    baselineMetric: rec.baseline_metric,
    estimate: {
      lower: rec.estimate_lower_minor,
      point: rec.estimate_point_minor,
      upper: rec.estimate_upper_minor,
      period: rec.estimate_period,
    },
    evidenceGrade: rec.evidence_grade,
    confidence: rec.confidence,
    implementationEffort: rec.implementation_effort,
    customerFrictionRisk: rec.customer_friction_risk,
    limitations: rec.limitations,
    assumptions: rec.assumptions,
  };
  return {
    system: [{ type: "text", text: SYSTEM_RULES, cache_control: { type: "ephemeral" } }],
    user: `Recommendation object (authoritative — do not alter any value):\n${JSON.stringify(payload, null, 2)}`,
  };
}

export interface ExplanationResult {
  prose: string | null;
  model: string;
  error: string | null;
}

export async function explainRecommendation(rec: RecommendationRow): Promise<ExplanationResult> {
  const { system, user } = buildExplanationPrompt(rec);
  const res = await callClaudeMessages({
    model: MODEL,
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 700,
    temperature: 0.2,
  });
  return { prose: res.raw, model: MODEL, error: res.error };
}
