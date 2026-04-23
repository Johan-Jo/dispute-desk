import { describe, it, expect } from "vitest";
import { normalizeMode } from "../normalizeMode";

/**
 * normalizeMode is the single compatibility layer between the legacy
 * four-mode rule store and the simplified two-mode public model
 * (auto | review). Every inbound mode value must resolve deterministically:
 * anything that isn't clearly "auto" becomes "review".
 */

describe("normalizeMode", () => {
  it("maps auto_pack -> auto", () => {
    expect(normalizeMode("auto_pack")).toBe("auto");
  });

  it("passes through auto unchanged", () => {
    expect(normalizeMode("auto")).toBe("auto");
  });

  it("maps notify -> review", () => {
    expect(normalizeMode("notify")).toBe("review");
  });

  it("maps manual -> review", () => {
    expect(normalizeMode("manual")).toBe("review");
  });

  it("passes review through unchanged", () => {
    expect(normalizeMode("review")).toBe("review");
  });

  it("maps unknown strings to review", () => {
    expect(normalizeMode("something_else")).toBe("review");
  });

  it("maps null to review", () => {
    expect(normalizeMode(null)).toBe("review");
  });

  it("maps undefined to review", () => {
    expect(normalizeMode(undefined)).toBe("review");
  });

  it("maps non-string values to review", () => {
    expect(normalizeMode(42)).toBe("review");
    expect(normalizeMode({})).toBe("review");
    expect(normalizeMode([])).toBe("review");
  });
});
