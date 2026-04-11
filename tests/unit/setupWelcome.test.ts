import { describe, it, expect } from "vitest";
import { WIZARD_STEP_IDS, WIZARD_STEPPER_IDS, SETUP_STEPS, STEP_BY_ID } from "@/lib/setup/constants";

describe("Setup welcome page and wizard structure", () => {
  it("has exactly 6 wizard steps", () => {
    expect(WIZARD_STEP_IDS).toHaveLength(6);
    expect(WIZARD_STEPPER_IDS).toHaveLength(6);
    expect(SETUP_STEPS).toHaveLength(6);
  });

  it("wizard and stepper IDs are identical", () => {
    expect(WIZARD_STEP_IDS).toEqual(WIZARD_STEPPER_IDS);
  });

  it("step order is connection → store_profile → coverage → automation → policies → activate", () => {
    expect(WIZARD_STEP_IDS).toEqual([
      "connection",
      "store_profile",
      "coverage",
      "automation",
      "policies",
      "activate",
    ]);
  });

  it("all step indexes are 0-based and sequential", () => {
    SETUP_STEPS.forEach((step, i) => {
      expect(step.index).toBe(i);
    });
  });

  it("every step has an entry in STEP_BY_ID", () => {
    for (const id of WIZARD_STEP_IDS) {
      expect(STEP_BY_ID[id]).toBeDefined();
      expect(STEP_BY_ID[id].id).toBe(id);
    }
  });

  it("no step has prerequisites in the new wizard", () => {
    for (const step of SETUP_STEPS) {
      expect(step.prerequisites).toEqual([]);
    }
  });

  it("every step has a non-empty title, dashboardLabel, and timeEstimate", () => {
    for (const step of SETUP_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.dashboardLabel.length).toBeGreaterThan(0);
      expect(step.timeEstimate.length).toBeGreaterThan(0);
    }
  });

  it("every step has at least one unlock", () => {
    for (const step of SETUP_STEPS) {
      expect(step.unlocks.length).toBeGreaterThan(0);
    }
  });
});
