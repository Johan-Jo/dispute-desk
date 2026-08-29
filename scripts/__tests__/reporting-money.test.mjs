import { describe, expect, it } from "vitest";
import {
  singleCurrencySummary,
  summarizeAmountsByCurrency,
} from "../lib/reporting-money.mjs";

describe("reporting money summaries", () => {
  it("keeps monetary values separated by currency", () => {
    const summary = summarizeAmountsByCurrency([
      { amount: 100, currency_code: "USD", initiated_at: "2026-01-01T00:00:00Z" },
      { amount: 200, currency_code: "USD", initiated_at: "2026-01-02T00:00:00Z" },
      { amount: 3_139_148, currency_code: "VND", initiated_at: "2026-01-02T00:00:00Z" },
    ]);

    expect(summary.USD).toMatchObject({
      count: 2,
      total: 300,
      average: 150,
      median: 150,
    });
    expect(summary.VND).toMatchObject({
      count: 1,
      total: 3_139_148,
      average: 3_139_148,
      median: 3_139_148,
    });
    expect(singleCurrencySummary(summary)).toBeNull();
  });

  it("supports legacy scalar fields for a single known currency", () => {
    const summary = summarizeAmountsByCurrency([
      { amount: 10, currency_code: "CAD", initiated_at: "2026-01-01T00:00:00Z" },
      { amount: 30, currency_code: "CAD", initiated_at: "2026-01-03T00:00:00Z" },
    ]);

    expect(singleCurrencySummary(summary)).toMatchObject({
      count: 2,
      total: 40,
      average: 20,
      median: 20,
    });
  });

  it("annualizes against the explicit reporting period", () => {
    const summary = summarizeAmountsByCurrency([
      { amount: 100, currency_code: "USD", initiated_at: "2026-01-10T00:00:00Z" },
    ], 30);

    expect(summary.USD.span_days).toBe(30);
    expect(summary.USD.annualized_case_run_rate).toBeCloseTo(365 / 30);
    expect(summary.USD.annualized_disputed_value_run_rate).toBeCloseTo(3650 / 3);
  });

  it("does not expose unknown-currency amounts as a safe scalar", () => {
    const summary = summarizeAmountsByCurrency([
      { amount: 50, currency_code: null, initiated_at: "2026-01-01T00:00:00Z" },
    ]);

    expect(summary.UNKNOWN.total).toBe(50);
    expect(singleCurrencySummary(summary)).toBeNull();
  });
});
