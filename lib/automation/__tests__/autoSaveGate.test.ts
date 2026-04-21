import { describe, it, expect } from "vitest";
import { evaluateAutoSaveGate } from "../autoSaveGate";

interface GateOverrides {
  autoSaveEnabled?: boolean;
  autoSaveMinScore?: number;
  enforceNoBlockers?: boolean;
  completenessScore?: number;
  blockers?: string[];
  submissionReadiness?: "ready" | "ready_with_warnings" | "blocked" | "submitted";
}

function call(overrides: GateOverrides = {}) {
  return evaluateAutoSaveGate({
    autoSaveEnabled: overrides.autoSaveEnabled ?? true,
    autoSaveMinScore: overrides.autoSaveMinScore ?? 80,
    enforceNoBlockers: overrides.enforceNoBlockers ?? true,
    completenessScore: overrides.completenessScore ?? 90,
    blockers: overrides.blockers ?? [],
    submissionReadiness: overrides.submissionReadiness,
  });
}

describe("evaluateAutoSaveGate", () => {
  it("returns auto_save when all criteria pass", () => {
    expect(call().action).toBe("auto_save");
  });

  it("blocks when auto_save is disabled", () => {
    const result = call({ autoSaveEnabled: false, completenessScore: 100 });
    expect(result.action).toBe("block");
    if (result.action === "block") {
      expect(result.reasons).toContain("Auto-save is disabled for this store");
    }
  });

  it("blocks when score is below threshold", () => {
    const result = call({ autoSaveMinScore: 80, completenessScore: 65 });
    expect(result.action).toBe("block");
    if (result.action === "block") {
      expect(result.reasons[0]).toContain("65%");
      expect(result.reasons[0]).toContain("80%");
    }
  });

  it("blocks when blockers exist and gate is enforced", () => {
    const result = call({
      enforceNoBlockers: true,
      blockers: ["Shipping Tracking", "Delivery Proof"],
    });
    expect(result.action).toBe("block");
    if (result.action === "block") {
      expect(result.reasons[0]).toContain("2 blocker(s)");
    }
  });

  it("allows save when blockers exist but gate is not enforced", () => {
    const result = call({
      enforceNoBlockers: false,
      blockers: ["Shipping Tracking"],
    });
    expect(result.action).toBe("auto_save");
  });

  it("score exactly at threshold passes", () => {
    expect(call({ autoSaveMinScore: 80, completenessScore: 80 }).action).toBe(
      "auto_save",
    );
  });

  it("ready_with_warnings does not block when readiness is provided", () => {
    const result = call({
      enforceNoBlockers: true,
      submissionReadiness: "ready_with_warnings",
      blockers: ["some legacy blocker"], // ignored when readiness is set
    });
    expect(result.action).toBe("auto_save");
  });

  it("blocked readiness blocks", () => {
    const result = call({
      enforceNoBlockers: true,
      submissionReadiness: "blocked",
    });
    expect(result.action).toBe("block");
    if (result.action === "block") {
      expect(result.reasons.join(" ")).toContain("Submission is blocked");
    }
  });
});
