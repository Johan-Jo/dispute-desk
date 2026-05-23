import { describe, it, expect } from "vitest";
import { computeRiskPayloadHash } from "@/lib/fraudIntel/riskPayloadHash";

describe("computeRiskPayloadHash", () => {
  it("produces a stable hex string", () => {
    const h = computeRiskPayloadHash({
      recommendation: "ACCEPT",
      assessments: [
        {
          riskLevel: "LOW",
          provider: "shopify",
          facts: [{ description: "AVS Match", sentiment: "POSITIVE" }],
        },
      ],
    });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is identical for two payloads that differ only in array order", () => {
    const a = computeRiskPayloadHash({
      recommendation: "ACCEPT",
      assessments: [
        {
          riskLevel: "LOW",
          provider: "shopify",
          facts: [
            { description: "AVS Match", sentiment: "POSITIVE" },
            { description: "CVV Match", sentiment: "POSITIVE" },
          ],
        },
      ],
    });
    const b = computeRiskPayloadHash({
      recommendation: "ACCEPT",
      assessments: [
        {
          riskLevel: "LOW",
          provider: "shopify",
          facts: [
            { description: "CVV Match", sentiment: "POSITIVE" },
            { description: "AVS Match", sentiment: "POSITIVE" },
          ],
        },
      ],
    });
    expect(a).toBe(b);
  });

  it("changes when a fact is added", () => {
    const base = computeRiskPayloadHash({
      recommendation: "ACCEPT",
      assessments: [
        {
          riskLevel: "LOW",
          provider: "shopify",
          facts: [{ description: "AVS Match", sentiment: "POSITIVE" }],
        },
      ],
    });
    const withExtra = computeRiskPayloadHash({
      recommendation: "ACCEPT",
      assessments: [
        {
          riskLevel: "LOW",
          provider: "shopify",
          facts: [
            { description: "AVS Match", sentiment: "POSITIVE" },
            { description: "Proxy detected", sentiment: "NEGATIVE" },
          ],
        },
      ],
    });
    expect(base).not.toBe(withExtra);
  });

  it("changes when riskLevel flips LOW → HIGH", () => {
    const low = computeRiskPayloadHash({
      recommendation: "ACCEPT",
      assessments: [{ riskLevel: "LOW", provider: "shopify", facts: [] }],
    });
    const high = computeRiskPayloadHash({
      recommendation: "INVESTIGATE",
      assessments: [{ riskLevel: "HIGH", provider: "shopify", facts: [] }],
    });
    expect(low).not.toBe(high);
  });

  it("is stable for an empty payload (and dedups other empty payloads)", () => {
    const empty1 = computeRiskPayloadHash({
      recommendation: null,
      assessments: null,
    });
    const empty2 = computeRiskPayloadHash({
      recommendation: null,
      assessments: [],
    });
    expect(empty1).toBe(empty2);
  });

  it("treats whitespace and case as canonical (POSITIVE === positive)", () => {
    const a = computeRiskPayloadHash({
      recommendation: "ACCEPT",
      assessments: [
        {
          riskLevel: "LOW",
          provider: "shopify",
          facts: [{ description: "AVS Match", sentiment: "positive" }],
        },
      ],
    });
    const b = computeRiskPayloadHash({
      recommendation: "ACCEPT",
      assessments: [
        {
          riskLevel: "LOW",
          provider: "shopify",
          facts: [{ description: "AVS Match", sentiment: "POSITIVE" }],
        },
      ],
    });
    expect(a).toBe(b);
  });
});
