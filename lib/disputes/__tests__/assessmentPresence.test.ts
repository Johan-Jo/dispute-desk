import { describe, expect, it } from "vitest";
import { resolveAssessmentGate } from "../assessmentPresence";

/* --- plan §3.5: four presence states, not two --- */
describe("assessment presence — absent / stale / unknown", () => {
  it("a FAILED read is unknown and licenses nothing", () => {
    // Plan §3.1 — the read contract. An infrastructure failure must never
    // assert "we have not assessed this yet".
    const g = resolveAssessmentGate({ needsRecalculation: true, readOk: false });
    expect(g.presence).toBe("unknown");
    expect(g.mayRenderVerdict).toBe(false);
    expect(g.mayRenderRecommendation).toBe(false);
    expect(g.mayOfferFilingAction).toBe(false);
  });

  it("readOk:false wins even when the case looks current", () => {
    expect(resolveAssessmentGate({ needsRecalculation: false, readOk: false }).presence).toBe("unknown");
  });

  it("snapshot_absent -> absent", () => {
    expect(
      resolveAssessmentGate({ needsRecalculation: true, recalculationReason: "snapshot_absent" }).presence,
    ).toBe("absent");
  });

  it("a missing reason is absent, never stale", () => {
    expect(resolveAssessmentGate({ needsRecalculation: true }).presence).toBe("absent");
  });

  it.each(["input_hash_mismatch", "policy_version_superseded"] as const)(
    "%s -> stale, with its own title",
    (reason) => {
      // PROD REGRESSION: caffd60d showed "Not assessed yet" over completeness
      // 97. It WAS assessed — under a policy since retired.
      const g = resolveAssessmentGate({ needsRecalculation: true, recalculationReason: reason });
      expect(g.presence).toBe("stale");
      expect(g.titleToken.key).toBe("disputes.assessmentState.stale.title");
    },
  );

  it("stale and absent never share a title token", () => {
    const stale = resolveAssessmentGate({ needsRecalculation: true, recalculationReason: "input_hash_mismatch" });
    const absent = resolveAssessmentGate({ needsRecalculation: true, recalculationReason: "snapshot_absent" });
    expect(stale.titleToken.key).not.toBe(absent.titleToken.key);
  });

  it("stale is no more permissive than absent", () => {
    // A number computed under a retired policy is not a number.
    const g = resolveAssessmentGate({ needsRecalculation: true, recalculationReason: "policy_version_superseded" });
    expect(g.mayRenderVerdict).toBe(false);
    expect(g.mayOfferFilingAction).toBe(false);
  });
});
