import { describe, it, expect } from "vitest";
import { computeClusterKey } from "@/lib/signal-radar/cluster";

describe("computeClusterKey", () => {
  it("is deterministic", () => {
    const a = computeClusterKey("Shopify froze my payouts last night");
    const b = computeClusterKey("Shopify froze my payouts last night");
    expect(a).toBe(b);
    expect(a.length).toBe(16);
  });

  it("is case-insensitive", () => {
    const a = computeClusterKey("Shopify Froze My Payouts");
    const b = computeClusterKey("shopify froze my payouts");
    expect(a).toBe(b);
  });

  it("collapses near-duplicates that share top tokens", () => {
    const a = computeClusterKey(
      "Shopify froze our payouts again — payouts frozen for the third time. shopify reserve is killing us."
    );
    const b = computeClusterKey(
      "Shopify reserve killing us. Shopify froze payouts AGAIN, payouts frozen for the third time."
    );
    expect(a).toBe(b);
  });

  it("differentiates unrelated topics", () => {
    const a = computeClusterKey("Chargeflow support disappeared on me");
    const b = computeClusterKey("Looking for tax software recommendations");
    expect(a).not.toBe(b);
  });

  it("returns empty string when no usable tokens remain", () => {
    expect(computeClusterKey("a an the of for")).toBe("");
    expect(computeClusterKey("")).toBe("");
  });

  it("strips URLs and code fences", () => {
    const a = computeClusterKey(
      "Shopify froze payouts ```const x = 1;``` https://reddit.com/x"
    );
    const b = computeClusterKey("Shopify froze payouts");
    expect(a).toBe(b);
  });
});
