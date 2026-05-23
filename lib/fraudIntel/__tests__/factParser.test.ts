import { describe, it, expect } from "vitest";
import { parseRiskFacts, PARSER_VERSION } from "@/lib/fraudIntel/factParser";

describe("parseRiskFacts", () => {
  it("exposes a parser_version constant", () => {
    expect(PARSER_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("returns all-null signals + empty misses on null/empty input", () => {
    const r = parseRiskFacts(null);
    expect(r.signals.proxy_detected).toBeNull();
    expect(r.misses).toEqual([]);
  });

  it("detects proxy when NEGATIVE 'Customer IP came from a proxy'", () => {
    const r = parseRiskFacts([
      { description: "Customer IP came from a proxy", sentiment: "NEGATIVE" },
    ]);
    expect(r.signals.proxy_detected).toBe(true);
  });

  it("captures payment attempt count", () => {
    const r = parseRiskFacts([
      { description: "3 payment attempts to charge", sentiment: "NEGATIVE" },
    ]);
    expect(r.signals.payment_attempt_count).toBe(3);
  });

  it("detects multiple cards tried", () => {
    const r = parseRiskFacts([
      {
        description: "Customer used 4 different credit cards",
        sentiment: "NEGATIVE",
      },
    ]);
    expect(r.signals.multiple_cards_tried).toBe(true);
  });

  it("captures IP-to-shipping distance", () => {
    const r = parseRiskFacts([
      {
        description: "8,400 km between the IP and shipping address",
        sentiment: "NEGATIVE",
      },
    ]);
    expect(r.signals.ip_ship_distance_km).toBe(8400);
  });

  it("detects fraud-cluster match on NEGATIVE", () => {
    const r = parseRiskFacts([
      {
        description: "Order matches a known fraudulent pattern",
        sentiment: "NEGATIVE",
      },
    ]);
    expect(r.signals.fraud_cluster_match).toBe(true);
  });

  it("does NOT flag fraud cluster on the POSITIVE inverse", () => {
    const r = parseRiskFacts([
      {
        description: "Order does not match known fraud patterns",
        sentiment: "POSITIVE",
      },
    ]);
    expect(r.signals.fraud_cluster_match).toBe(false);
  });

  it("does NOT match a NEGATIVE-only rule when fact is tagged POSITIVE", () => {
    // Sentiment-gated rule: proxy_detected=true should NOT fire on
    // a POSITIVE-tagged fact even if the text contains 'proxy'.
    const r = parseRiskFacts([
      {
        description: "Order did not originate from a proxy",
        sentiment: "POSITIVE",
      },
    ]);
    // The POSITIVE rule for "no proxy" should fire instead.
    expect(r.signals.proxy_detected).toBe(false);
  });

  it("collects misses for unmatched phrasing", () => {
    const r = parseRiskFacts([
      { description: "Some new Shopify phrasing we have never seen", sentiment: "NEUTRAL" },
    ]);
    expect(r.signals.proxy_detected).toBeNull();
    expect(r.misses.length).toBe(1);
    expect(r.misses[0].text).toContain("new Shopify phrasing");
  });

  it("supports multiple signals from a single string", () => {
    const r = parseRiskFacts([
      {
        description:
          "Customer IP came from a proxy, 5,200 km between the IP and shipping address",
        sentiment: "NEGATIVE",
      },
    ]);
    expect(r.signals.proxy_detected).toBe(true);
    expect(r.signals.ip_ship_distance_km).toBe(5200);
  });

  it("≥95% coverage on the canonical Shopify fact fixture set", () => {
    // Fixture set hand-curated to mirror the phrasings Shopify currently
    // returns. Each entry exercises exactly one rule. If Shopify rewords
    // a signal and this coverage drops, /admin/fraud-intel will alert
    // before the regression slips into prod.
    const fixtures: Array<{ description: string; sentiment: string }> = [
      { description: "Customer IP came from a proxy", sentiment: "NEGATIVE" },
      { description: "Order did not originate from a proxy", sentiment: "POSITIVE" },
      { description: "3 payment attempts to charge", sentiment: "NEGATIVE" },
      { description: "Customer attempted to pay 4 times", sentiment: "NEGATIVE" },
      { description: "Customer used 3 different credit cards", sentiment: "NEGATIVE" },
      { description: "Multiple payment methods used", sentiment: "NEGATIVE" },
      { description: "Billing country matches the IP", sentiment: "POSITIVE" },
      { description: "Billing address country differs from the IP", sentiment: "NEGATIVE" },
      { description: "IP located in NL", sentiment: "NEUTRAL" },
      { description: "8,400 km between the IP and shipping address", sentiment: "NEGATIVE" },
      { description: "Shipping address is 1,200 km from the customer IP", sentiment: "NEGATIVE" },
      { description: "Order matches a known fraudulent pattern", sentiment: "NEGATIVE" },
      { description: "Associated with known fraud", sentiment: "NEGATIVE" },
      { description: "Order doesn't match known fraud", sentiment: "POSITIVE" },
    ];

    const unmatched: string[] = [];
    let matched = 0;
    for (const f of fixtures) {
      const r = parseRiskFacts([f]);
      if (r.misses.length === 0) matched++;
      else unmatched.push(`${f.description} (${f.sentiment})`);
    }
    const coverage = matched / fixtures.length;
    if (coverage < 0.95) {
      // eslint-disable-next-line no-console
      console.error("Unmatched fixtures:", unmatched);
    }
    expect(coverage).toBeGreaterThanOrEqual(0.95);
  });
});
