import { describe, it, expect } from "vitest";
import {
  bandForVamp,
  bandForMcEcm,
  bandForMcEfm,
  VAMP_STANDARD,
  VAMP_EXCESSIVE,
  MC_ECM,
  MC_EFM,
  YELLOW_BAND_FACTOR,
} from "@/lib/liabilityShift/ratios/thresholds";

describe("ratio thresholds", () => {
  it("VAMP: green below 80% of 0.65%, yellow between, red ≥ 0.65%", () => {
    expect(bandForVamp(0.001)).toBe("green");
    expect(bandForVamp(VAMP_STANDARD * YELLOW_BAND_FACTOR + 0.0001)).toBe("yellow");
    expect(bandForVamp(VAMP_STANDARD)).toBe("red");
    expect(bandForVamp(VAMP_EXCESSIVE)).toBe("red");
  });

  it("Mastercard ECM bands", () => {
    expect(bandForMcEcm(0.001)).toBe("green");
    expect(bandForMcEcm(MC_ECM * 0.81)).toBe("yellow");
    expect(bandForMcEcm(MC_ECM)).toBe("red");
  });

  it("Mastercard EFM bands", () => {
    expect(bandForMcEfm(0.001)).toBe("green");
    expect(bandForMcEfm(MC_EFM * 0.81)).toBe("yellow");
    expect(bandForMcEfm(MC_EFM)).toBe("red");
  });
});
