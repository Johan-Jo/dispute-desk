import { describe, it, expect } from "vitest";
import {
  isDormantInquiry,
  DORMANT_INQUIRY_MAX_AGE_MS,
} from "../dormantInquiry";

// Fixed "now" for deterministic staleness math.
const NOW = Date.UTC(2026, 6, 5); // 2026-07-05
const OLD = new Date(NOW - DORMANT_INQUIRY_MAX_AGE_MS - 86_400_000).toISOString(); // just past window
const RECENT = new Date(NOW - 30 * 86_400_000).toISOString(); // 30 days ago

describe("isDormantInquiry", () => {
  it("flags an old inquiry with a null due date as dormant", () => {
    expect(
      isDormantInquiry(
        { phase: "inquiry", due_at: null, initiated_at: OLD },
        NOW,
      ),
    ).toBe(true);
  });

  it("flags an old inquiry with an epoch due date as dormant", () => {
    expect(
      isDormantInquiry(
        {
          phase: "inquiry",
          due_at: "1969-12-31T01:00:00+01:00",
          initiated_at: OLD,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("does NOT flag a recent inquiry with a null due date (fresh, deadline pending)", () => {
    expect(
      isDormantInquiry(
        { phase: "inquiry", due_at: null, initiated_at: RECENT },
        NOW,
      ),
    ).toBe(false);
  });

  it("does NOT flag an old inquiry that still has a real future deadline", () => {
    expect(
      isDormantInquiry(
        {
          phase: "inquiry",
          due_at: "2026-08-01T00:00:00Z",
          initiated_at: OLD,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("does NOT flag a chargeback (only inquiries can be dormant)", () => {
    expect(
      isDormantInquiry(
        { phase: "chargeback", due_at: null, initiated_at: OLD },
        NOW,
      ),
    ).toBe(false);
  });

  it("does NOT flag when initiated_at is missing (can't establish staleness)", () => {
    expect(
      isDormantInquiry(
        { phase: "inquiry", due_at: null, initiated_at: null },
        NOW,
      ),
    ).toBe(false);
  });

  it("matches the cay-collective ghost inquiries (regression)", () => {
    // #4577 / #5225 / #5263: PRODUCT_NOT_RECEIVED inquiries from 2025,
    // null due_at, still UNDER_REVIEW at Shopify. All must read dormant.
    const ghosts = [
      { phase: "inquiry", due_at: null, initiated_at: "2025-05-28T02:28:32Z" },
      { phase: "inquiry", due_at: null, initiated_at: "2025-08-13T15:30:45Z" },
      { phase: "inquiry", due_at: null, initiated_at: "2025-09-30T10:32:28Z" },
    ];
    for (const g of ghosts) {
      expect(isDormantInquiry(g, NOW)).toBe(true);
    }
  });
});
