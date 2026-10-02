import { describe, expect, it } from "vitest";
import {
  VAMP_EARLY_WARNING,
  VAMP_EXCESSIVE,
  MC_ECM_RATIO,
  ecmSeverity,
  vampSeverity,
} from "@/lib/liabilityShift/ratios/thresholds";
import * as programme from "@/lib/insights/programmeThresholds";
import { roundRatio } from "@/lib/insights/programmeThresholds";

describe("thresholds re-export the one programme table", () => {
  // Two tables used to disagree on one page (0.65%/1.00% vs 0.9%/1.5%).
  it("carries the programme numbers, not its own", () => {
    expect(VAMP_EARLY_WARNING).toBe(programme.VAMP_EARLY_WARNING);
    expect(VAMP_EXCESSIVE).toBe(0.015);
    expect(MC_ECM_RATIO).toBe(0.015);
  });
});

describe("vampSeverity", () => {
  it("healthy below 0.9%", () => {
    expect(vampSeverity(0.00149, 2)).toBe("healthy");
  });
  it("info above the ratio while under 1,500 disputes a month", () => {
    expect(vampSeverity(0.02369, 2)).toBe("info");
    expect(vampSeverity(0.02, 1499)).toBe("info");
  });
  it("consider then breach once the floor is met", () => {
    expect(vampSeverity(0.01, 1500)).toBe("consider");
    expect(vampSeverity(0.015, 1500)).toBe("breach");
  });
});

describe("ecmSeverity", () => {
  it("healthy below 1.5%", () => {
    expect(ecmSeverity(0.0006, 2, true)).toBe("healthy");
  });
  it("info above the ratio while under 100 chargebacks", () => {
    expect(ecmSeverity(0.0513, 71, true)).toBe("info");
  });
  it("breach when both criteria are met", () => {
    expect(ecmSeverity(0.016, 100, false)).toBe("breach");
  });
  it("lower-bound denominator: the count floor alone means at least consider", () => {
    expect(ecmSeverity(0.008, 120, true)).toBe("consider");
    expect(ecmSeverity(0.008, 120, false)).toBe("healthy");
  });
});

describe("roundRatio", () => {
  it("rounds once to 5 decimals", () => {
    expect(roundRatio(0.0014446)).toBe(0.00144);
    expect(roundRatio(4 / 2686)).toBe(0.00149);
  });
});
