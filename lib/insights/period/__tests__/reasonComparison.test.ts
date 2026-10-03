import { describe, expect, it } from "vitest";

import { compareReasons, readPreviousReasons } from "../reasonComparison";

/** The design's own example: September against August. */
const SEPTEMBER = [
  { reason: "FRAUDULENT", disputes: 2 },
  { reason: "PRODUCT_NOT_RECEIVED", disputes: 1 },
  { reason: "PRODUCT_UNACCEPTABLE", disputes: 1 },
];
const AUGUST = [
  { reason: "FRAUDULENT", disputes: 3 },
  { reason: "PRODUCT_NOT_RECEIVED", disputes: 1 },
  { reason: "CREDIT_NOT_PROCESSED", disputes: 1 },
];

describe("compareReasons", () => {
  const c = compareReasons(SEPTEMBER, AUGUST);

  it("totals each month and scales the bars on the largest single count", () => {
    expect(c.currentTotal).toBe(4);
    expect(c.previousTotal).toBe(5);
    expect(c.max).toBe(3);
  });

  it("orders by this month's count, then last month's", () => {
    expect(c.rows.map((r) => r.reason)).toEqual([
      "FRAUDULENT",
      "PRODUCT_NOT_RECEIVED",
      "PRODUCT_UNACCEPTABLE",
      "CREDIT_NOT_PROCESSED",
    ]);
  });

  it("gives each row its share of this month and its change", () => {
    expect(c.rows[0]).toMatchObject({ current: 2, previous: 3, share: 0.5, change: -1, isNew: false });
    expect(c.rows[1]).toMatchObject({ current: 1, previous: 1, share: 0.25, change: 0, isNew: false });
  });

  it("marks a reason that did not exist last month as new", () => {
    expect(c.rows[2]).toMatchObject({ current: 1, previous: 0, change: 1, isNew: true });
  });

  it("keeps a reason that disappeared, with no share of this month", () => {
    expect(c.rows[3]).toMatchObject({ current: 0, previous: 1, share: null, change: -1, isNew: false });
  });

  it("an unmeasured earlier month is null everywhere, never zero or 'new'", () => {
    const u = compareReasons(SEPTEMBER, null);
    expect(u.previousTotal).toBeNull();
    expect(u.rows.every((r) => r.previous === null && r.change === null && !r.isNew)).toBe(true);
    expect(u.rows).toHaveLength(3);
  });

  it("two months without disputes produce no rows and a bar scale of 1", () => {
    expect(compareReasons([], [])).toEqual({ rows: [], currentTotal: 0, previousTotal: 0, max: 1 });
  });
});

describe("readPreviousReasons", () => {
  const sb = (row: unknown) =>
    ({
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = () => Promise.resolve({ data: row, error: null });
        return b;
      },
    }) as never;

  it("reads the month before from its record", async () => {
    const r = await readPreviousReasons(sb({ coverage: "full", operational_metrics: { byReason: AUGUST } }), "s", "2026-09-01");
    expect(r).toEqual({ periodMonth: "2026-08-01", byReason: AUGUST });
  });

  it("is null for a missing row, a partial month, or a record without reasons", async () => {
    expect(await readPreviousReasons(sb(null), "s", "2026-09-01")).toBeNull();
    expect(await readPreviousReasons(sb({ coverage: "partial", operational_metrics: { byReason: AUGUST } }), "s", "2026-09-01")).toBeNull();
    expect(await readPreviousReasons(sb({ coverage: "full", operational_metrics: {} }), "s", "2026-09-01")).toBeNull();
  });
});
