import { describe, it, expect } from "vitest";
import { evaluateAutoSaveGate } from "../autoSaveGate";
import type { ShopSettings } from "../settings";

function makeSettings(overrides: Partial<ShopSettings> = {}): ShopSettings {
  return {
    shop_id: "test-shop",
    auto_build_enabled: true,
    auto_save_enabled: true,
    require_review_before_save: false,
    auto_save_min_score: 80,
    enforce_no_blockers: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("evaluateAutoSaveGate", () => {
  it("returns auto_save when all gates pass", () => {
    const result = evaluateAutoSaveGate({
      settings: makeSettings(),
      completenessScore: 90,
      blockers: [],
      isApproved: false,
    });

    expect(result.action).toBe("auto_save");
  });

  it("blocks when auto_save is disabled", () => {
    const result = evaluateAutoSaveGate({
      settings: makeSettings({ auto_save_enabled: false }),
      completenessScore: 100,
      blockers: [],
      isApproved: false,
    });

    expect(result.action).toBe("block");
    if (result.action === "block") {
      expect(result.reasons).toContain("Auto-save is disabled for this store");
    }
  });

  it("blocks when score is below threshold", () => {
    const result = evaluateAutoSaveGate({
      settings: makeSettings({ auto_save_min_score: 80 }),
      completenessScore: 65,
      blockers: [],
      isApproved: false,
    });

    expect(result.action).toBe("block");
    if (result.action === "block") {
      expect(result.reasons[0]).toContain("65%");
      expect(result.reasons[0]).toContain("80%");
    }
  });

  it("blocks when blockers exist and gate is enforced", () => {
    const result = evaluateAutoSaveGate({
      settings: makeSettings({ enforce_no_blockers: true }),
      completenessScore: 90,
      blockers: ["Shipping Tracking", "Delivery Proof"],
      isApproved: false,
    });

    expect(result.action).toBe("block");
    if (result.action === "block") {
      expect(result.reasons[0]).toContain("2 blocker(s)");
    }
  });

  it("allows save when blockers exist but gate is not enforced", () => {
    const result = evaluateAutoSaveGate({
      settings: makeSettings({ enforce_no_blockers: false }),
      completenessScore: 90,
      blockers: ["Shipping Tracking"],
      isApproved: false,
    });

    expect(result.action).toBe("auto_save");
  });

  it("parks for review when require_review is true and not approved", () => {
    const result = evaluateAutoSaveGate({
      settings: makeSettings({ require_review_before_save: true }),
      completenessScore: 90,
      blockers: [],
      isApproved: false,
    });

    expect(result.action).toBe("park_for_review");
    if (result.action === "park_for_review") {
      expect(result.reason).toContain("Review required");
    }
  });

  it("allows save when require_review is true but already approved", () => {
    const result = evaluateAutoSaveGate({
      settings: makeSettings({ require_review_before_save: true }),
      completenessScore: 90,
      blockers: [],
      isApproved: true,
    });

    expect(result.action).toBe("auto_save");
  });

  it("blocks take priority over park_for_review", () => {
    const result = evaluateAutoSaveGate({
      settings: makeSettings({
        require_review_before_save: true,
        auto_save_min_score: 80,
      }),
      completenessScore: 50,
      blockers: [],
      isApproved: false,
    });

    expect(result.action).toBe("block");
  });

  it("score exactly at threshold passes", () => {
    const result = evaluateAutoSaveGate({
      settings: makeSettings({ auto_save_min_score: 80 }),
      completenessScore: 80,
      blockers: [],
      isApproved: false,
    });

    expect(result.action).toBe("auto_save");
  });
});
