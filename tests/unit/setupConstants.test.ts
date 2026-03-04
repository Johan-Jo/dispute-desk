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
  it("has exactly 7 steps", () => {
    expect(SETUP_STEPS).toHaveLength(7);
    expect(TOTAL_STEPS).toBe(7);
  });

  it("STEP_IDS matches SETUP_STEPS order", () => {
    expect(STEP_IDS).toEqual([
      "permissions",
      "welcome_goals",
      "sync_disputes",
      "business_policies",
      "evidence_sources",
      "automation_rules",
      "team_notifications",
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
      welcome_goals: { status: "done" },
    });
    expect(result).toBe("sync_disputes");
  });

  it("skips skipped steps", () => {
    const result = getNextActionableStep({
      permissions: { status: "skipped" },
    });
    expect(result).toBe("welcome_goals");
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
    expect(isPrerequisiteMet("automation_rules", {})).toBe(true);
    expect(isPrerequisiteMet("team_notifications", {})).toBe(true);
  });

  it("returns false for steps with unmet prerequisites when map is empty", () => {
    expect(isPrerequisiteMet("welcome_goals", {})).toBe(false);
  });

  it("returns false for sync_disputes when permissions is not done", () => {
    expect(isPrerequisiteMet("sync_disputes", {})).toBe(false);
    expect(
      isPrerequisiteMet("sync_disputes", {
        permissions: { status: "in_progress" },
      })
    ).toBe(false);
    expect(
      isPrerequisiteMet("sync_disputes", {
        permissions: { status: "skipped" },
      })
    ).toBe(false);
  });

  it("returns true for sync_disputes when permissions is done", () => {
    expect(
      isPrerequisiteMet("sync_disputes", {
        permissions: { status: "done" },
      })
    ).toBe(true);
  });

  it("returns false for business_policies when sync_disputes is not done", () => {
    expect(
      isPrerequisiteMet("business_policies", {
        permissions: { status: "done" },
      })
    ).toBe(false);
  });

  it("returns true for business_policies when sync_disputes is done", () => {
    expect(
      isPrerequisiteMet("business_policies", {
        sync_disputes: { status: "done" },
      })
    ).toBe(true);
  });

  it("returns false for evidence_sources when business_policies is not done", () => {
    expect(
      isPrerequisiteMet("evidence_sources", {
        permissions: { status: "done" },
        sync_disputes: { status: "done" },
      })
    ).toBe(false);
  });

  it("returns true for evidence_sources when business_policies is done", () => {
    expect(
      isPrerequisiteMet("evidence_sources", {
        business_policies: { status: "done" },
      })
    ).toBe(true);
  });

  it("returns false for unknown step id", () => {
    expect(isPrerequisiteMet("nonexistent" as StepId, {})).toBe(false);
  });
});
