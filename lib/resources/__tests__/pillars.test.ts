import { describe, expect, it } from "vitest";
import {
  inferResourceHubPillarFromText,
  normalizeResourceHubPillar,
  resolvePrimaryPillarForGeneration,
} from "../pillars";

describe("normalizeResourceHubPillar", () => {
  it("accepts canonical slugs", () => {
    expect(normalizeResourceHubPillar("chargebacks")).toBe("chargebacks");
    expect(normalizeResourceHubPillar("dispute-resolution")).toBe("dispute-resolution");
  });

  it("trims and lowercases", () => {
    expect(normalizeResourceHubPillar("  Chargebacks  ")).toBe("chargebacks");
  });

  it("maps common aliases", () => {
    expect(normalizeResourceHubPillar("chargeback")).toBe("chargebacks");
    expect(normalizeResourceHubPillar("mediation")).toBe("mediation-arbitration");
  });

  it("returns null for garbage", () => {
    expect(normalizeResourceHubPillar("not-a-pillar")).toBeNull();
    expect(normalizeResourceHubPillar("")).toBeNull();
  });
});

describe("inferResourceHubPillarFromText", () => {
  it("infers chargebacks from chargeback vocabulary", () => {
    expect(
      inferResourceHubPillarFromText("Complete Guide to Chargeback Response Time")
    ).toBe("chargebacks");
  });
});

describe("resolvePrimaryPillarForGeneration", () => {
  it("uses normalized archive pillar when valid", () => {
    expect(
      resolvePrimaryPillarForGeneration({
        primaryPillar: "chargebacks",
        proposedTitle: "x",
      })
    ).toBe("chargebacks");
  });

  it("infers when archive value is invalid but text matches", () => {
    expect(
      resolvePrimaryPillarForGeneration({
        primaryPillar: "typo-pillar",
        proposedTitle: "Chargeback deadlines and issuer rules",
        targetKeyword: "chargeback",
      })
    ).toBe("chargebacks");
  });

  it("defaults to chargebacks when nothing matches", () => {
    expect(
      resolvePrimaryPillarForGeneration({
        primaryPillar: "???",
        proposedTitle: "zzz",
        targetKeyword: "zzz",
      })
    ).toBe("chargebacks");
  });
});
