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
  it("has exactly 5 onboarding steps", () => {
    expect(SETUP_STEPS).toHaveLength(5);
    expect(TOTAL_STEPS).toBe(5);
  });

  it("STEP_IDS matches SETUP_STEPS order", () => {
    expect(STEP_IDS).toEqual([
      "connection",
      "store_profile",
      "coverage",
      "automation",
      "activate",
    ]);
  });

  it("STEP_BY_ID contains all steps keyed by id", () => {
    for (const step of SETUP_STEPS) {
      expect(STEP_BY_ID[step.id]).toBe(step);
    }
  });

  it("each step has index 1-5 in order", () => {
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
    expect(result).toBe("connection");
  });

  it("returns first step when map has no entries", () => {
    const result = getNextActionableStep({});
    expect(result).toBe("connection");
  });

  it("skips done steps", () => {
    const result = getNextActionableStep({
      connection: { status: "done" },
    });
    expect(result).toBe("store_profile");
    expect(
      getNextActionableStep({
        connection: { status: "done" },
        store_profile: { status: "done" },
      })
    ).toBe("coverage");
  });

  it("skips skipped steps", () => {
    const result = getNextActionableStep({
      connection: { status: "skipped" },
    });
    expect(result).toBe("store_profile");
  });

  it("returns in_progress step", () => {
    const result = getNextActionableStep({
      connection: { status: "in_progress" },
    });
    expect(result).toBe("connection");
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
      allDoneOrSkipped[id] = { status: id === "connection" ? "skipped" : "done" };
    }
    const result = getNextActionableStep(allDoneOrSkipped);
    expect(result).toBeNull();
  });
});

describe("isPrerequisiteMet", () => {
  it("returns true for all steps with no prerequisites when map is empty", () => {
    // All steps in the new wizard have empty prerequisites
    for (const id of STEP_IDS) {
      expect(isPrerequisiteMet(id, {})).toBe(true);
    }
  });

  it("returns false for unknown step id", () => {
    expect(isPrerequisiteMet("nonexistent" as StepId, {})).toBe(false);
  });
});
