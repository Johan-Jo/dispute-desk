import { describe, expect, it } from "vitest";
import {
  isSyntheticDispute,
  reportingWindow,
} from "../lib/reporting-window.mjs";

describe("reporting window", () => {
  it("creates an inclusive-start, exclusive-end UTC window", () => {
    expect(reportingWindow("2026-07-28", "2026-08-29")).toEqual({
      from: "2026-07-28T00:00:00.000Z",
      to: "2026-08-29T00:00:00.000Z",
      days: 32,
    });
  });

  it("rejects invalid and reversed windows", () => {
    expect(() => reportingWindow("2026-02-30", "2026-03-02")).toThrow();
    expect(() => reportingWindow("2026-08-29", "2026-08-29")).toThrow();
  });
});

describe("synthetic dispute classification", () => {
  it("recognizes repository fixture identifiers", () => {
    expect(isSyntheticDispute({
      dispute_gid: "gid://shopify/ShopifyPaymentsDispute/seed-1",
    })).toBe(true);
  });

  it("recognizes explicit seed provenance in the raw snapshot", () => {
    expect(isSyntheticDispute({
      dispute_gid: "gid://shopify/ShopifyPaymentsDispute/123",
      raw_snapshot: { seed_v2: true },
    })).toBe(true);
  });

  it("does not classify a normal Shopify GID as synthetic", () => {
    expect(isSyntheticDispute({
      dispute_gid: "gid://shopify/ShopifyPaymentsDispute/11010670785",
      raw_snapshot: { status: "lost" },
    })).toBe(false);
  });
});
