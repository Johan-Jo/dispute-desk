import { describe, it, expect } from "vitest";
import {
  SETUP_STEPS,
  STEP_IDS,
  STEP_BY_ID,
  TOTAL_STEPS,
  getNextActionableStep,
  isPrerequisiteMet,
} from "@/lib/setup/constants";
import type { StepId } from "@/lib/setup/types";

describe("SETUP_STEPS constants", () => {
  it("has exactly 8 onboarding steps (billing, settings, help are app-only)", () => {
    expect(SETUP_STEPS).toHaveLength(8);
    expect(TOTAL_STEPS).toBe(8);
  });

  it("STEP_IDS matches SETUP_STEPS order", () => {
    expect(STEP_IDS).toEqual([
      "permissions",
      "open_in_admin",
      "overview",
      "disputes",
      "packs",
      "rules",
      "policies",
      "team",
    ]);
  });

  it("STEP_BY_ID contains all steps keyed by id", () => {
    for (const step of SETUP_STEPS) {
      expect(STEP_BY_ID[step.id]).toBe(step);
    }
  });

  it("each step has index 1-7 in order", () => {
    SETUP_STEPS.forEach((step, i) => {
      expect(step.index).toBe(i + 1);
    });
  });

  it("each step has a non-empty title and dashboardLabel", () => {
    for (const step of SETUP_STEPS) {
      expect(step.title).toBeTruthy();
      expect(step.dashboardLabel).toBeTruthy();
    }
  });

  it("each step has at least one unlock item", () => {
    for (const step of SETUP_STEPS) {
      expect(step.unlocks.length).toBeGreaterThan(0);
    }
  });
});

describe("getNextActionableStep", () => {
  it("returns first step when all are todo", () => {
    const result = getNextActionableStep({});
    expect(result).toBe("permissions");
  });

  it("returns first step when map has no entries", () => {
    const result = getNextActionableStep({});
    expect(result).toBe("permissions");
  });

  it("skips done steps", () => {
    const result = getNextActionableStep({
      permissions: { status: "done" },
      overview: { status: "done" },
    });
    expect(result).toBe("open_in_admin");
    expect(
      getNextActionableStep({
        permissions: { status: "done" },
        open_in_admin: { status: "done" },
        overview: { status: "done" },
      })
    ).toBe("disputes");
  });

  it("skips skipped steps", () => {
    const result = getNextActionableStep({
      permissions: { status: "skipped" },
    });
    expect(result).toBe("open_in_admin");
  });

  it("returns in_progress step", () => {
    const result = getNextActionableStep({
      permissions: { status: "in_progress" },
    });
    expect(result).toBe("permissions");
  });

  it("returns null when all steps are done", () => {
    const allDone: Partial<Record<StepId, { status: string }>> = {};
    for (const id of STEP_IDS) {
      allDone[id] = { status: "done" };
    }
    const result = getNextActionableStep(allDone);
    expect(result).toBeNull();
  });

  it("returns null when all steps are done or skipped", () => {
    const allDoneOrSkipped: Partial<Record<StepId, { status: string }>> = {};
    for (const id of STEP_IDS) {
      allDoneOrSkipped[id] = { status: id === "permissions" ? "skipped" : "done" };
    }
    const result = getNextActionableStep(allDoneOrSkipped);
    expect(result).toBeNull();
  });
});

describe("isPrerequisiteMet", () => {
  it("returns true for steps with no prerequisites when map is empty", () => {
    expect(isPrerequisiteMet("permissions", {})).toBe(true);
    expect(isPrerequisiteMet("rules", {})).toBe(true);
    expect(isPrerequisiteMet("team", {})).toBe(true);
  });

  it("returns false for steps with unmet prerequisites when map is empty", () => {
    expect(isPrerequisiteMet("overview", {})).toBe(false);
  });

  it("returns false for disputes when permissions is not done", () => {
    expect(isPrerequisiteMet("disputes", {})).toBe(false);
    expect(
      isPrerequisiteMet("disputes", {
        permissions: { status: "in_progress" },
      })
    ).toBe(false);
    expect(
      isPrerequisiteMet("disputes", {
        permissions: { status: "skipped" },
      })
    ).toBe(false);
  });

  it("returns true for disputes when permissions is done", () => {
    expect(
      isPrerequisiteMet("disputes", {
        permissions: { status: "done" },
      })
    ).toBe(true);
  });

  it("returns false for policies when disputes is not done", () => {
    expect(
      isPrerequisiteMet("policies", {
        permissions: { status: "done" },
      })
    ).toBe(false);
  });

  it("returns true for policies when disputes is done", () => {
    expect(
      isPrerequisiteMet("policies", {
        disputes: { status: "done" },
      })
    ).toBe(true);
  });

  it("returns false for packs when disputes is not done", () => {
    expect(
      isPrerequisiteMet("packs", {
        permissions: { status: "done" },
        overview: { status: "done" },
      })
    ).toBe(false);
  });

  it("returns true for packs when disputes is done", () => {
    expect(
      isPrerequisiteMet("packs", {
        disputes: { status: "done" },
      })
    ).toBe(true);
  });

  it("returns false for unknown step id", () => {
    expect(isPrerequisiteMet("nonexistent" as StepId, {})).toBe(false);
  });
});
