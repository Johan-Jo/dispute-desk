/**
 * Contract for the no-orders gate (docs/plans/no-orders-install-gate.plan.md).
 *
 * The property that matters most: it FAILS OPEN. A real merchant must never be
 * locked out because our own check broke.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let shopRow: { orders_verified_at: string | null } | null = null;
let shopError: { message: string } | null = null;
let disputeCount = 0;
const updateMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === "disputes") {
        return {
          select: () => ({
            eq: async () => ({ count: disputeCount, error: null }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: shopRow, error: shopError }),
          }),
        }),
        update: (...args: unknown[]) => {
          updateMock(...args);
          return { eq: () => ({ is: async () => ({ error: null }) }) };
        },
      };
    },
  }),
}));

const makeAuthedRequest = vi.fn();
vi.mock("@/lib/shopify/makeAuthedRequest", () => ({
  makeAuthedRequest: (...args: unknown[]) => makeAuthedRequest(...args),
}));

import { shopHasAnyOrders } from "@/lib/shopify/hasAnyOrders";
import { resolveOrdersGate, _resetOrdersGateCache } from "@/lib/shopify/ordersGate";

describe("shopHasAnyOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    disputeCount = 0;
  });

  it("true when Shopify returns an order", async () => {
    makeAuthedRequest.mockResolvedValue({
      data: { orders: { edges: [{ node: { id: "gid://shopify/Order/1" } }] } },
    });
    expect(await shopHasAnyOrders("s1")).toBe(true);
  });

  it("false only when Shopify positively answers with zero orders", async () => {
    makeAuthedRequest.mockResolvedValue({ data: { orders: { edges: [] } } });
    expect(await shopHasAnyOrders("s1")).toBe(false);
  });

  it("true from a dispute row alone, without calling Shopify (60-day blind spot)", async () => {
    disputeCount = 2;
    expect(await shopHasAnyOrders("s1")).toBe(true);
    expect(makeAuthedRequest).not.toHaveBeenCalled();
  });

  it("null (unknown) on a GraphQL errors-only response, never false", async () => {
    makeAuthedRequest.mockResolvedValue({
      data: null,
      errors: [{ message: "Access denied" }],
    });
    expect(await shopHasAnyOrders("s1")).toBeNull();
  });

  it("null when the request throws", async () => {
    makeAuthedRequest.mockRejectedValue(new Error("no session"));
    expect(await shopHasAnyOrders("s1")).toBeNull();
  });
});

describe("resolveOrdersGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    _resetOrdersGateCache();
    shopRow = { orders_verified_at: null };
    shopError = null;
    disputeCount = 0;
  });

  it("open, with no Shopify call, once the shop is verified", async () => {
    shopRow = { orders_verified_at: "2026-10-08T00:00:00Z" };
    expect(await resolveOrdersGate("s1")).toBe("open");
    expect(makeAuthedRequest).not.toHaveBeenCalled();
  });

  it("locked for an unverified shop with no orders", async () => {
    makeAuthedRequest.mockResolvedValue({ data: { orders: { edges: [] } } });
    expect(await resolveOrdersGate("s1")).toBe("locked");
  });

  it("caches a locked verdict so refreshes don't hammer Shopify", async () => {
    makeAuthedRequest.mockResolvedValue({ data: { orders: { edges: [] } } });
    await resolveOrdersGate("s1");
    await resolveOrdersGate("s1");
    expect(makeAuthedRequest).toHaveBeenCalledTimes(1);
  });

  it("unlocks AND stamps the shop as soon as an order appears", async () => {
    makeAuthedRequest.mockResolvedValueOnce({ data: { orders: { edges: [] } } });
    expect(await resolveOrdersGate("s1")).toBe("locked");

    _resetOrdersGateCache();
    makeAuthedRequest.mockResolvedValueOnce({
      data: { orders: { edges: [{ node: { id: "gid://shopify/Order/9" } }] } },
    });
    expect(await resolveOrdersGate("s1")).toBe("open");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toHaveProperty("orders_verified_at");
  });

  it("FAILS OPEN when Shopify can't be asked", async () => {
    makeAuthedRequest.mockRejectedValue(new Error("shopify down"));
    expect(await resolveOrdersGate("s1")).toBe("open");
  });

  it("FAILS OPEN on a shop-row read error or an unknown shop", async () => {
    shopError = { message: "db down" };
    expect(await resolveOrdersGate("s1")).toBe("open");
    shopError = null;
    shopRow = null;
    expect(await resolveOrdersGate("s1")).toBe("open");
  });
});
