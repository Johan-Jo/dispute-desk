import { describe, expect, it } from "vitest";
import {
  addMonths,
  finalOn,
  monthEnd,
  periodStateByDate,
  statementMonth,
  trendWindow,
} from "../months";

describe("statementMonth", () => {
  it("is always the last complete calendar month", () => {
    expect(statementMonth(new Date("2026-10-02T12:00:00Z"))).toBe("2026-09-01");
    expect(statementMonth(new Date("2026-01-03T00:00:00Z"))).toBe("2025-12-01");
    expect(statementMonth(new Date("2026-10-31T23:59:59Z"))).toBe("2026-09-01");
  });
});

describe("month arithmetic", () => {
  it("monthEnd and addMonths cross year boundaries", () => {
    expect(monthEnd("2025-12-01")).toBe("2026-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-09-01", -11)).toBe("2025-10-01");
  });
});

describe("periodStateByDate", () => {
  it("is provisional until the 8th of the next month, then final", () => {
    expect(finalOn("2026-09-01")).toBe("2026-10-08T00:00:00.000Z");
    expect(periodStateByDate("2026-09-01", new Date("2026-10-07T23:59:59Z"))).toBe("provisional");
    expect(periodStateByDate("2026-09-01", new Date("2026-10-08T00:00:00Z"))).toBe("final");
  });
});

describe("trendWindow", () => {
  const now = new Date("2026-10-02T12:00:00Z");

  it("covers 12 months ending at the statement month", () => {
    const w = trendWindow({ now, sinceDate: null, firstOrderAt: "2020-01-05T00:00:00Z" });
    expect(w).toHaveLength(12);
    expect(w[0]).toBe("2025-10-01");
    expect(w.at(-1)).toBe("2026-09-01");
  });

  it("never starts before the import's since date", () => {
    const w = trendWindow({ now, sinceDate: "2026-05-20", firstOrderAt: "2020-01-05T00:00:00Z" });
    expect(w[0]).toBe("2026-05-01");
    expect(w.at(-1)).toBe("2026-09-01");
  });

  it("never starts before the shop's first order", () => {
    const w = trendWindow({ now, sinceDate: null, firstOrderAt: "2026-08-14T00:00:00Z" });
    expect(w).toEqual(["2026-08-01", "2026-09-01"]);
  });
});
