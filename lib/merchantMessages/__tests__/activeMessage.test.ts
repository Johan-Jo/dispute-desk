/**
 * The active-message query decides whether the merchant still sees the
 * banner. Two exclusions matter and are easy to lose in a refactor:
 * a dismissed message, and an ANSWERED one.
 *
 * The answered case is the subtle one. The banner's "thanks, sent"
 * state is component state, so it survives only until the next
 * navigation. Without `responded_at` filtered here, a merchant who
 * replied got the empty form back on their next page view — asking
 * again for what they had just given us.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const filters: Array<[string, unknown]> = [];
let rows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: string, val: unknown) => {
        filters.push([`eq:${col}`, val]);
        return chain;
      };
      chain.is = (col: string, val: unknown) => {
        filters.push([`is:${col}`, val]);
        return chain;
      };
      chain.or = (expr: string) => {
        filters.push(["or", expr]);
        return chain;
      };
      chain.order = () => chain;
      chain.limit = async () => ({ data: rows, error: null });
      return chain;
    },
  }),
}));

import { getActiveMerchantMessage } from "@/lib/merchantMessages/activeMessage";

beforeEach(() => {
  filters.length = 0;
  rows = [];
});

describe("getActiveMerchantMessage", () => {
  it("excludes messages the merchant already answered", async () => {
    await getActiveMerchantMessage("shop-1");
    expect(filters).toEqual(
      expect.arrayContaining([["is:responded_at", null]]),
    );
  });

  it("excludes messages the merchant dismissed", async () => {
    await getActiveMerchantMessage("shop-1");
    expect(filters).toEqual(
      expect.arrayContaining([["is:dismissed_at", null]]),
    );
  });

  it("only considers published messages for this shop", async () => {
    await getActiveMerchantMessage("shop-1");
    expect(filters).toEqual(
      expect.arrayContaining([
        ["eq:shop_id", "shop-1"],
        ["eq:status", "published"],
      ]),
    );
  });

  it("returns null when nothing qualifies", async () => {
    rows = [];
    expect(await getActiveMerchantMessage("shop-1")).toBeNull();
  });

  it("maps a qualifying row to the merchant-facing shape", async () => {
    rows = [
      {
        id: "m1",
        title: "Hello",
        body: "We need to talk",
        ask_for_contact: true,
        tone: "critical",
        expires_at: null,
      },
    ];
    expect(await getActiveMerchantMessage("shop-1")).toEqual({
      id: "m1",
      title: "Hello",
      body: "We need to talk",
      askForContact: true,
      tone: "critical",
    });
  });
});
