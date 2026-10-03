import { describe, expect, it } from "vitest";
import { canMarkStable, monthCoverage } from "../canMarkStable";

const complete = (completedAt: string, since: string | null) => ({
  historical_import_status: "complete",
  historical_import_completed_at: completedAt,
  historical_import_since_date: since,
});

describe("canMarkStable", () => {
  const shop = complete("2026-07-21T10:00:00Z", "2010-01-01");

  it("waits until the 8th of the next month, 00:00 UTC", () => {
    expect(canMarkStable(shop, "2026-09-01", new Date("2026-10-07T23:59:59Z"))).toBe(false);
    expect(canMarkStable(shop, "2026-09-01", new Date("2026-10-08T00:00:00Z"))).toBe(true);
  });

  it("needs a complete import", () => {
    const now = new Date("2026-10-09T00:00:00Z");
    expect(canMarkStable({ ...shop, historical_import_status: "in_progress" }, "2026-09-01", now)).toBe(false);
    expect(canMarkStable({ ...shop, historical_import_completed_at: null }, "2026-09-01", now)).toBe(false);
  });

  it("never marks a month the import only partly covers", () => {
    const partial = complete("2026-07-21T10:00:00Z", "2026-09-15");
    expect(monthCoverage(partial, "2026-09-01")).toBe("partial");
    expect(canMarkStable(partial, "2026-09-01", new Date("2026-10-09T00:00:00Z"))).toBe(false);
  });

  // The rule an earlier draft had — completed_at ≥ month end — would have
  // kept every month after the import provisional forever. These are the
  // four prod shops' real import dates.
  it("marks September final for all four prod shops on 2026-10-08", () => {
    const now = new Date("2026-10-08T02:00:00Z");
    for (const s of [
      complete("2026-07-21T00:00:00Z", "2010-01-01"), // blume-box
      complete("2026-08-29T00:00:00Z", null), // Mein Maison
      complete("2026-07-02T00:00:00Z", null), // cay-collective
      complete("2026-05-11T00:00:00Z", null), // surasvenne
    ]) {
      expect(canMarkStable(s, "2026-09-01", now)).toBe(true);
    }
  });
});
