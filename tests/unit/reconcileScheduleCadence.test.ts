import { describe, it, expect } from "vitest";
import { nextInterval } from "@/lib/disputes/reconcileSchedule";

// Bounds reflect webhook-primary world (since 2026-05-20):
//   - floor 1 h: webhook is the latency path, cron is reconciliation
//   - ceiling 6 h: a dormant shop never goes longer than 6h without a sync
const MIN = 60 * 60;
const MAX = 6 * 60 * 60;

describe("reconcile schedule — adaptive cadence (webhook-primary bounds)", () => {
  it("halves the interval when drift is detected", () => {
    expect(nextInterval(4 * 3600, true, false)).toBe(2 * 3600);
  });

  it("multiplies by 1.5 on a clean reconcile", () => {
    expect(nextInterval(2 * 3600, false, false)).toBe(3 * 3600);
  });

  it("floors at 1 hour — drift on an already-tight cadence stays tight", () => {
    expect(nextInterval(MIN, true, false)).toBe(MIN);
    expect(nextInterval(MIN + 60, true, false)).toBe(MIN);
  });

  it("ceilings at 6 hours — clean runs on a long cadence don't grow forever", () => {
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
