import { describe, it, expect } from "vitest";
import {
  SETUP_STEPS,
  STEP_IDS,
  STEP_BY_ID,
  TOTAL_STEPS,
  getNextActionableStep,
  isPrerequisiteMet,
  resolveStepId,
  LEGACY_STEP_ID_MAP,
} from "@/lib/setup/constants";
import type { StepId } from "@/lib/setup/types";

describe("SETUP_STEPS constants", () => {
  it("has exactly 5 onboarding steps", () => {
    // 6→5 (2026-07-27): `coverage` + `automation` merged into `handling`.
    expect(SETUP_STEPS).toHaveLength(5);
    expect(TOTAL_STEPS).toBe(5);
  });

  it("STEP_IDS matches SETUP_STEPS order", () => {
    expect(STEP_IDS).toEqual([
      "connection",
      "store_profile",
      "handling",
      "policies",
      "activate",
    ]);
  });

  it("STEP_BY_ID contains all steps keyed by id", () => {
    for (const step of SETUP_STEPS) {
      expect(STEP_BY_ID[step.id]).toBe(step);
    }
  });

  it("each step has 0-based index in order", () => {
    SETUP_STEPS.forEach((step, i) => {
      expect(step.index).toBe(i);
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
    ).toBe("handling");
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

describe("resolveStepId / LEGACY_STEP_ID_MAP", () => {
  it("passes canonical ids through unchanged", () => {
    for (const id of STEP_IDS) {
      expect(resolveStepId(id)).toBe(id);
    }
  });

  it("maps the merged legacy ids onto handling", () => {
    // A stale client tab or bookmarked URL can still say coverage/automation.
    expect(resolveStepId("coverage")).toBe("handling");
    expect(resolveStepId("automation")).toBe("handling");
  });

  it("tolerates hyphens as separators", () => {
    // Regression (2026-07-28): /app/setup/store-profile rendered a blank
    // "Setup Wizard" fallback card because only the underscore form resolved.
    // Hyphens read as natural in a URL, so hand-written links hit this.
    expect(resolveStepId("store-profile")).toBe("store_profile");
    expect(resolveStepId("store_profile")).toBe("store_profile");
  });

  it("tolerates casing and surrounding whitespace", () => {
    expect(resolveStepId("Store-Profile")).toBe("store_profile");
    expect(resolveStepId("  handling  ")).toBe("handling");
    expect(resolveStepId("COVERAGE")).toBe("handling");
  });

  it("every canonical id survives a hyphenated round-trip", () => {
    // Closes the class rather than the one instance.
    for (const id of STEP_IDS) {
      expect(resolveStepId(id.replace(/_/g, "-"))).toBe(id);
    }
  });

  it("returns null for unknown or empty input", () => {
    expect(resolveStepId("nonexistent")).toBeNull();
    expect(resolveStepId("")).toBeNull();
    expect(resolveStepId("   ")).toBeNull();
    expect(resolveStepId(undefined)).toBeNull();
    expect(resolveStepId(42)).toBeNull();
  });

  it("EVERY legacy alias points at a step that still exists", () => {
    // Guards the class of bug where a step is renamed but an alias is left
    // pointing at the removed id — that alias would silently drop its state.
    for (const [alias, target] of Object.entries(LEGACY_STEP_ID_MAP)) {
      expect(STEP_IDS, `alias "${alias}" → "${target}"`).toContain(target);
    }
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
