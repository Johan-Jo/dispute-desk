import { describe, it, expect } from "vitest";
import {
  classifyScopeGrant,
  deriveSinceDate,
  tomorrowUtcIso,
  READ_ALL_ORDERS_SINCE_ANCHOR,
  DEFAULT_WINDOW_DAYS,
} from "@/lib/disputes/backfillOrders";

/**
 * Pure helper tests for the Phase 1 fraud-intel backfill orchestrator.
 * The full stateful path (Shopify pagination + Supabase upserts) is
 * covered end-to-end by manual verification on a test shop; these
 * tests pin the scope detection + window derivation rules so a future
 * refactor can't silently widen the import window.
 */

describe("classifyScopeGrant", () => {
  it("treats null/undefined scopes as default_window", () => {
    expect(classifyScopeGrant(null)).toBe("default_window");
    expect(classifyScopeGrant(undefined)).toBe("default_window");
    expect(classifyScopeGrant("")).toBe("default_window");
  });

  it("returns read_all_orders when the scope is present", () => {
    expect(classifyScopeGrant("read_orders,read_all_orders")).toBe(
      "read_all_orders",
    );
    expect(classifyScopeGrant("read_all_orders")).toBe("read_all_orders");
    expect(
      classifyScopeGrant(
        "read_orders, read_all_orders, read_shopify_payments_disputes",
      ),
    ).toBe("read_all_orders");
  });

  it("returns default_window when only read_orders is granted", () => {
    expect(classifyScopeGrant("read_orders")).toBe("default_window");
    expect(
      classifyScopeGrant("read_orders,read_shopify_payments_disputes"),
    ).toBe("default_window");
  });

  it("is case-insensitive on the token", () => {
    expect(classifyScopeGrant("READ_ALL_ORDERS")).toBe("read_all_orders");
  });

  it("does not match substrings (e.g. read_all_orderss)", () => {
    expect(classifyScopeGrant("read_orders,read_all_orderss")).toBe(
      "default_window",
    );
  });
});

describe("deriveSinceDate", () => {
  it("anchors read_all_orders to the pre-Shopify epoch", () => {
    expect(deriveSinceDate("read_all_orders")).toBe(READ_ALL_ORDERS_SINCE_ANCHOR);
  });

  it("derives default_window as today minus DEFAULT_WINDOW_DAYS in UTC", () => {
    // Fix today to a known date so the assertion is deterministic.
    const today = new Date("2026-05-10T12:34:56Z");
    const expected = new Date("2026-03-11T00:00:00Z").toISOString().slice(0, 10);
    expect(deriveSinceDate("default_window", today)).toBe(expected);
    // Sanity: the gap is exactly DEFAULT_WINDOW_DAYS days.
    const sinceMs = new Date(expected + "T00:00:00Z").getTime();
    const todayMs = new Date(
      today.toISOString().slice(0, 10) + "T00:00:00Z",
    ).getTime();
    expect((todayMs - sinceMs) / 86_400_000).toBe(DEFAULT_WINDOW_DAYS);
  });
});

describe("tomorrowUtcIso", () => {
  it("returns the next UTC day relative to the supplied 'now'", () => {
    expect(tomorrowUtcIso(new Date("2026-05-10T23:59:59Z"))).toBe("2026-05-11");
    expect(tomorrowUtcIso(new Date("2026-05-10T00:00:00Z"))).toBe("2026-05-11");
  });
});
