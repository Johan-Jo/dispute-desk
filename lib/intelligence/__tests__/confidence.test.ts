import { describe, it, expect } from "vitest";
import { scoreConfidence } from "@/lib/intelligence/stats/confidence";

describe("confidence_rubric_v1", () => {
  it("descriptive totals are NOT capped by confounder availability or FDR", () => {
    // A correct portfolio total with huge N, low missingness → high, even
    // though confounders are unmeasured and FDR is exploratory (both N/A).
    const r = scoreConfidence("descriptive_data", {
      events: 100000,
      missingnessPct: 1,
      measurementValidity: "valid",
      confounders: "principal_unmeasured", // must be ignored for descriptive
      fdr: "exploratory", // must be ignored for descriptive
    });
    expect(r.confidence).toBe("high");
    expect(r.caps.confounders).toBeUndefined();
    expect(r.caps.fdr).toBeUndefined();
  });

  it("100%-inferred classification caps a statistical estimate at low", () => {
    const r = scoreConfidence("statistical_estimate", {
      events: 100000,
      ciWidth: 0.02,
      missingnessPct: 1,
      temporalStability: "stable",
      classification: "inferred",
      measurementValidity: "valid",
      fdr: "q05",
    });
    expect(r.confidence).toBe("low");
  });

  it("recommendation confidence is capped low by unmeasured principal confounders", () => {
    const r = scoreConfidence("recommendation", {
      events: 100000, ciWidth: 0.02, missingnessPct: 1,
      temporalStability: "stable", classification: "direct_derived",
      measurementValidity: "valid", fdr: "q05",
      confounders: "principal_unmeasured",
    });
    expect(r.confidence).toBe("low");
  });

  it("invalid measurement (retrospective risk feature) forces insufficient", () => {
    const r = scoreConfidence("model", { events: 100000, measurementValidity: "invalid" });
    expect(r.confidence).toBe("insufficient");
  });

  it("is deterministic and stamps the rubric version", () => {
    const inputs = { events: 40, missingnessPct: 3, measurementValidity: "valid" as const };
    const a = scoreConfidence("descriptive_data", inputs);
    const b = scoreConfidence("descriptive_data", inputs);
    expect(a.confidence).toBe(b.confidence);
    expect(a.rubricVersion).toBe("confidence_rubric_v1");
  });
});
