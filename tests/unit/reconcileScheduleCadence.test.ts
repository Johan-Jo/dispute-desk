import { describe, it, expect } from "vitest";
import { nextInterval } from "@/lib/disputes/reconcileSchedule";

const MIN = 15 * 60;
const MAX = 24 * 60 * 60;

describe("reconcile schedule — adaptive cadence", () => {
  it("halves the interval when drift is detected", () => {
    expect(nextInterval(3600, true, false)).toBe(1800);
  });

  it("multiplies by 1.5 on a clean reconcile", () => {
    expect(nextInterval(3600, false, false)).toBe(5400);
  });

  it("floors at 15 minutes — drift on an already-tight cadence stays tight", () => {
    expect(nextInterval(MIN, true, false)).toBe(MIN);
    expect(nextInterval(MIN + 60, true, false)).toBe(MIN);
  });

  it("ceilings at 24 hours — clean runs on a long cadence don't grow forever", () => {
    expect(nextInterval(MAX, false, false)).toBe(MAX);
    expect(nextInterval(MAX - 60, false, false)).toBe(MAX);
  });

  it("leaves the interval untouched when the run had errors (circuit-breaker handles repeated failures)", () => {
    expect(nextInterval(3600, true, true)).toBe(3600);
    expect(nextInterval(3600, false, true)).toBe(3600);
  });

  it("converges quickly toward MIN on repeated drift", () => {
    let v = MAX;
    for (let i = 0; i < 20; i++) v = nextInterval(v, true, false);
    expect(v).toBe(MIN);
  });

  it("converges toward MAX on repeated clean runs", () => {
    let v = MIN;
    for (let i = 0; i < 20; i++) v = nextInterval(v, false, false);
    expect(v).toBe(MAX);
  });
});
