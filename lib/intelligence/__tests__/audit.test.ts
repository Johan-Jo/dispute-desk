import { describe, it, expect } from "vitest";
import { buildReport } from "@/lib/intelligence/dataQuality/audit";
import { assertShopId, scopedSelectAll } from "@/lib/intelligence/db/tenantScope";
import type { DataQualityFacts } from "@/lib/intelligence/types";

// Facts modeled on the measured Blume Box coverage probe.
const BLUME_FACTS: DataQualityFacts = {
  generated_at: "2026-07-21T00:00:00Z",
  orders: {
    count: 354412, min_processed_at: "2018-05-24T13:59:12Z", max_processed_at: "2026-07-21T16:35:50Z",
    coverage_start: "2018-05-24T13:59:12Z", distinct_currencies: 1,
    by_year: { "2018": 20000, "2019": 40000 },
    pct_null_risk_initial: 3.9, pct_null_country: 0.3, pct_null_payment_gateway: 7.4,
    pct_null_delivery_status: 36.8, pct_has_chargeback_true: 0.0, implausible_dates: 0,
  },
  leakage: { median_ingest_lag_hours: 45767, pct_ingested_within_48h: 0.1 },
  disputes: {
    count: 454, min_initiated_at: "2018-11-16Z", max_initiated_at: "2026-07-20Z",
    distinct_currencies: 1, by_year: { "2018": 5 },
    pct_orphan_no_order: 0.0, pct_null_phase: 0.0, pct_unclassified_reason: 10,
    pct_null_final_outcome: 17.4, count_adjudicated: 375, count_submitted: 371,
    pct_network_code_direct_or_derived: 0.0, count_with_outcome_amount: 375,
    orders_with_multiple_disputes: 3, missing_deadline_count: 0, count_with_response_opportunity: 454,
  },
  evidence: { pack_count: 100, item_count: 800 },
};

describe("dataQuality/buildReport — Blume-Box-shaped facts", () => {
  const report = buildReport(BLUME_FACTS);

  it("flags risk-based prevention as NOT supported (leakage)", () => {
    expect(report.riskPreventionSupported).toBe(false);
    const risk = report.areas.find((a) => a.area === "risk_features")!;
    expect(risk.status).toBe("insufficient");
  });

  it("marks network reason codes insufficient (100% inferred)", () => {
    expect(report.areas.find((a) => a.area === "network_reason_codes")!.status).toBe("insufficient");
  });

  it("treats order↔dispute linkage as reliable (0% orphan)", () => {
    expect(report.areas.find((a) => a.area === "order_dispute_linkage")!.status).toBe("reliable");
  });

  it("surfaces small-N and leakage limitations globally", () => {
    const joined = report.globalLimitations.join(" ");
    expect(joined).toMatch(/Small dispute N/);
    expect(joined).toMatch(/retrospective-only/);
  });

  it("supports risk prevention only when ingest lag is small", () => {
    const fresh = { ...BLUME_FACTS, leakage: { median_ingest_lag_hours: 2, pct_ingested_within_48h: 99 } };
    expect(buildReport(fresh).riskPreventionSupported).toBe(true);
  });
});

describe("tenantScope — fails closed on bad shopId", () => {
  it("assertShopId throws on missing / empty", () => {
    expect(() => assertShopId(undefined)).toThrow(/required/);
    expect(() => assertShopId("")).toThrow(/required/);
    expect(() => assertShopId("   ")).toThrow(/required/);
  });

  it("assertShopId accepts a non-empty id", () => {
    expect(() => assertShopId("shop-uuid")).not.toThrow();
  });

  it("scopedSelectAll rejects an unknown view before any DB call", async () => {
    await expect(scopedSelectAll("secret_table", "shop-uuid")).rejects.toThrow(/unknown intel view/);
  });

  it("scopedSelectAll requires a shopId", async () => {
    await expect(scopedSelectAll("intel_order_records", "")).rejects.toThrow(/required/);
  });
});
