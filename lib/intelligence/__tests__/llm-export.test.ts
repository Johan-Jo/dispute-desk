import { describe, it, expect } from "vitest";
import { buildExplanationPrompt } from "@/lib/intelligence/llm/explain";
import { buildMarkdownReport } from "@/lib/intelligence/export/report";
import type { RecommendationRow, AnalysisRunRow } from "@/lib/intelligence/types";

const REC: RecommendationRow = {
  id: "rec-1", analysis_run_id: "run-1", shop_id: "shop-1",
  category: "response", title: "Unanswered disputes with a response opportunity",
  summary: "15 disputes had a deadline but no submission.", suggested_action: "Submit packs for all disputes with a deadline.",
  affected_order_count: 15, affected_dispute_count: 15, affected_disputed_minor: "1500.00", currency: "USD",
  baseline_metric: { name: "any_recovery_rate", value: 0.6, numerator: 90, denominator: 150 },
  estimate_lower_minor: "300.00", estimate_point_minor: "900.00", estimate_upper_minor: "1200.00", estimate_period: "historical_total",
  evidence_grade: "descriptive", confidence: "low", confidence_kind: "recommendation",
  implementation_effort: "low", customer_friction_risk: "low",
  limitations: ["Selection bias: unanswered cases may be systematically weaker."],
  assumptions: [], required_data_quality_checks: [], supporting_segment_ids: [], created_at: "2026-07-21T00:00:00Z",
};

describe("LLM explanation prompt — hard guardrails (§22)", () => {
  const { system, user } = buildExplanationPrompt(REC);

  it("system prompt forbids recompute, causal claims, and auto-non-response", () => {
    const s = system[0].text;
    expect(s).toMatch(/do NOT recalculate/i);
    expect(s).toMatch(/do NOT make causal claims/i);
    expect(s).toMatch(/decision support only/i);
    expect(s).toMatch(/do NOT reclassify/i);
  });

  it("payload carries only structured aggregate fields + limitations", () => {
    expect(user).toMatch(/any_recovery_rate/);
    expect(user).toMatch(/Selection bias/);
    // No raw per-record / customer identifiers.
    expect(user).not.toMatch(/customer_email|customer_shopify_id|dispute_gid|order_gid/);
  });

  it("system block is cache-enabled", () => {
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("markdown export", () => {
  const run = {
    id: "run-1", shop_id: "shop-1", status: "succeeded", stage: "complete",
    created_at: "2026-07-21T00:00:00Z", completed_at: "2026-07-21T01:00:00Z",
    feature_registry_version: "feature_registry_v1", classification_version: "reason_catalog_2026-05-01", methodology_version: "methodology_v1",
    data_quality: {
      facts: { orders: { count: 354412, coverage_start: "2018-05-24" }, disputes: { count: 454, count_adjudicated: 375 } },
      riskPreventionSupported: false, globalLimitations: ["Risk-based prevention is retrospective-only."],
    },
    baseline: null, feasibility: { anyModelBuilt: false, summary: "No model passed.", verdicts: [] }, model_report: null,
  } as unknown as AnalysisRunRow;

  it("renders a faithful report with methodology + limitations", () => {
    const md = buildMarkdownReport(run as never, [REC], "blume-box.myshopify.com");
    expect(md).toMatch(/# Historical Dispute Intelligence Report/);
    expect(md).toMatch(/blume-box.myshopify.com/);
    expect(md).toMatch(/NOT supported — retrospective\/leakage/);
    expect(md).toMatch(/## Methodology/);
    expect(md).toMatch(/Unanswered disputes with a response opportunity/);
    expect(md).toMatch(/does not submit, skip, or decide any dispute/);
  });
});
