/**
 * A deleted store is a terminal failure, not a transient one.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────
 *
 * `Unavailable Shop` from Shopify's Admin API fell through to the generic
 * error branch in `ordersForSnapshot`, and `handleSnapshotShopDailyMetrics`
 * returned `Promise<void>` — so every throw was retriable and the cron
 * re-queued the job daily against a store Shopify will not serve.
 *
 * Measured on production 2026-08-13: `6mjjvm-tc` and `xxda51-v1` had 34
 * failed `snapshot_shop_daily_metrics` runs EACH — one per day since they
 * vanished — and both were still `uninstalled_at: null` in our records, so
 * nothing else knew either.
 *
 * Neither store holds a dispute, so the cost was noise rather than money. The
 * noise is the point: 68 fake failures are exactly what would hide a real
 * `Unavailable Shop` on a live merchant.
 *
 * ── WHY IT IS NOT THE SAME AS AUTH INVALIDATION ───────────────────────
 *
 * A bad token can be refreshed and a reinstall repairs it. No credential
 * reaches a store that no longer exists — retrying is guaranteed to fail,
 * forever. The two need different error types because they need different
 * answers.
 */

import { describe, it, expect } from "vitest";
import {
  assertShopAvailable,
  detectShopUnavailableReason,
  ShopUnavailableError,
  assertNotAuthInvalid,
} from "@/lib/shopify/sessions/getShopBackgroundSession";

const errs = (...messages: string[]) => ({ errors: messages.map((message) => ({ message })) });

describe("detectShopUnavailableReason", () => {
  it("matches the message production actually returned", () => {
    expect(detectShopUnavailableReason(errs("Unavailable Shop"))).toBe("Unavailable Shop");
  });

  for (const variant of ["unavailable shop", "This shop is unavailable", "Shop not found"]) {
    it(`matches the "${variant}" phrasing`, () => {
      expect(detectShopUnavailableReason(errs(variant))).not.toBeNull();
    });
  }

  it("returns null for unrelated GraphQL errors", () => {
    expect(detectShopUnavailableReason(errs("Throttled"))).toBeNull();
    expect(detectShopUnavailableReason(errs("Field 'foo' doesn't exist"))).toBeNull();
  });

  it("survives absent, empty and malformed error arrays", () => {
    expect(detectShopUnavailableReason({ errors: null })).toBeNull();
    expect(detectShopUnavailableReason({})).toBeNull();
    expect(detectShopUnavailableReason({ errors: [] })).toBeNull();
    expect(detectShopUnavailableReason({ errors: [null, undefined] as never })).toBeNull();
  });

  it("finds it among several errors", () => {
    expect(detectShopUnavailableReason(errs("Throttled", "Unavailable Shop"))).toBe(
      "Unavailable Shop",
    );
  });
});

describe("assertShopAvailable", () => {
  it("throws a typed error the dispatcher can act on", () => {
    expect(() => assertShopAvailable("shop-1", errs("Unavailable Shop"))).toThrow(
      ShopUnavailableError,
    );
  });

  it("names the shop, so the failure is diagnosable without a query", () => {
    try {
      assertShopAvailable("6mjjvm-tc.myshopify.com", errs("Unavailable Shop"));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("6mjjvm-tc.myshopify.com");
      expect((e as Error).message).toContain("Unavailable Shop");
    }
  });

  it("does NOT throw on unrelated errors — the caller keeps its own handling", () => {
    expect(() => assertShopAvailable("shop-1", errs("Throttled"))).not.toThrow();
    expect(() => assertShopAvailable("shop-1", { errors: null })).not.toThrow();
  });
});

describe("it stays distinct from auth invalidation", () => {
  /* A refreshable credential problem and a store that no longer exists must
   * not collapse into one type: the first is retriable after a reinstall, the
   * second never is. */
  it("an auth error is not read as an unavailable shop", () => {
    expect(detectShopUnavailableReason(errs("Invalid API key or access token"))).toBeNull();
  });

  it("an unavailable shop is not read as an auth error", () => {
    expect(() =>
      assertNotAuthInvalid("shop-1", "offline", errs("Unavailable Shop")),
    ).not.toThrow();
  });
});
