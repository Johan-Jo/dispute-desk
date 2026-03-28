import { describe, it, expect } from "vitest";
import {
  isResourceHubPillar,
  normalizeResourceHubPillar,
  inferResourceHubPillarFromText,
  resolvePrimaryPillarForGeneration,
} from "@/lib/resources/pillars";

describe("isResourceHubPillar", () => {
  it("accepts canonical slugs", () => {
    expect(isResourceHubPillar("chargebacks")).toBe(true);
    expect(isResourceHubPillar("dispute-resolution")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isResourceHubPillar("unknown")).toBe(false);
  });
});

describe("normalizeResourceHubPillar", () => {
  it("maps aliases to canonical pillars", () => {
    expect(normalizeResourceHubPillar("chargeback")).toBe("chargebacks");
    expect(normalizeResourceHubPillar("  CHARGEBACKS  ")).toBe("chargebacks");
  });

  it("returns null for unmapped input", () => {
    expect(normalizeResourceHubPillar("")).toBe(null);
    expect(normalizeResourceHubPillar(null)).toBe(null);
  });
});

describe("inferResourceHubPillarFromText", () => {
  it("infers chargebacks from keywords", () => {
    expect(inferResourceHubPillarFromText("Card network chargeback rules")).toBe("chargebacks");
  });

  it("returns null when no rule matches", () => {
    expect(inferResourceHubPillarFromText("hello world")).toBe(null);
  });
});

describe("resolvePrimaryPillarForGeneration", () => {
  it("returns normalized pillar when primaryPillar is valid", () => {
    const p = resolvePrimaryPillarForGeneration({
      primaryPillar: "chargebacks",
    });
    expect(p).toBe("chargebacks");
  });

  it("infers from title when primaryPillar is invalid", () => {
    const p = resolvePrimaryPillarForGeneration({
      primaryPillar: "garbage",
      proposedTitle: "Understanding chargeback representment",
    });
    expect(p).toBe("chargebacks");
  });

  it("defaults to chargebacks when nothing matches", () => {
    const p = resolvePrimaryPillarForGeneration({
      primaryPillar: "garbage",
      proposedTitle: "xyz",
    });
    expect(p).toBe("chargebacks");
  });
});
