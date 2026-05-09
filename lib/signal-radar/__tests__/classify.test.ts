import { describe, it, expect } from "vitest";
import { SignalAnalysisSchema } from "@/lib/signal-radar/schema";

const VALID = {
  merchant_relevance: true,
  frustration_score: 7,
  emotional_intensity_score: 8,
  signal_score: 9,
  source_confidence_score: 8,
  category: "transparency_frustration",
  competitor: "chargeflow",
  merchant_stage: "scaling",
  merchant_type: "high_ticket_physical",
  merchant_scale_signals: ["50k/mo", "100 orders/day"],
  suggested_angle: "Lean into transparency: show every uploaded file.",
  why_this_matters:
    "competitor_weakness — Chargeflow's opacity is recurring; positioning angle for transparency.",
  summary: "Merchant complains Chargeflow submits evidence without telling them.",
};

describe("SignalAnalysisSchema", () => {
  it("parses a fully valid 13-field response", () => {
    const result = SignalAnalysisSchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it("accepts null competitor and null suggested_angle", () => {
    const r = SignalAnalysisSchema.safeParse({
      ...VALID,
      competitor: null,
      suggested_angle: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts empty merchant_scale_signals", () => {
    const r = SignalAnalysisSchema.safeParse({ ...VALID, merchant_scale_signals: [] });
    expect(r.success).toBe(true);
  });

  it("rejects when a required field is missing", () => {
    const { why_this_matters: _, ...rest } = VALID;
    void _;
    const r = SignalAnalysisSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects invalid category enum", () => {
    const r = SignalAnalysisSchema.safeParse({ ...VALID, category: "bogus" });
    expect(r.success).toBe(false);
  });

  it("rejects out-of-range score", () => {
    const r = SignalAnalysisSchema.safeParse({ ...VALID, signal_score: 11 });
    expect(r.success).toBe(false);
  });

  it("rejects merchant_scale_signals beyond cap of 6", () => {
    const r = SignalAnalysisSchema.safeParse({
      ...VALID,
      merchant_scale_signals: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown merchant_type", () => {
    const r = SignalAnalysisSchema.safeParse({ ...VALID, merchant_type: "luxury" });
    expect(r.success).toBe(false);
  });

  it("requires non-empty why_this_matters", () => {
    const r = SignalAnalysisSchema.safeParse({ ...VALID, why_this_matters: "" });
    expect(r.success).toBe(false);
  });
});
