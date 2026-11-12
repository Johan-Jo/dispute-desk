/**
 * /admin/fraud-intel. It used to read at most 1000 orders (PostgREST row cap)
 * and count disputes from shopify_orders.has_chargeback, which is never set, so
 * every bucket showed 0%. It now renders the SQL aggregation
 * (dd_admin_fraud_intel_buckets) — these pin that wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    rpc,
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "gte", "order", "limit", "range", "in"]) chain[m] = () => chain;
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return chain;
    },
  }),
}));

import AdminFraudIntelPage from "@/app/admin/fraud-intel/page";

const render = async () => renderToStaticMarkup(await AdminFraudIntelPage());

beforeEach(() => rpc.mockReset());

describe("AdminFraudIntelPage", () => {
  it("renders window totals and real dispute rates from the aggregation", async () => {
    rpc.mockResolvedValue({
      error: null,
      data: [
        { dimension: "total", bucket: "all", orders: "34284", disputes: "299" },
        { dimension: "avs", bucket: "unknown", orders: "19232", disputes: "291" },
        { dimension: "avs", bucket: "Y", orders: "6121", disputes: "4" },
      ],
    });
    const html = await render();
    expect(rpc).toHaveBeenCalledWith("dd_admin_fraud_intel_buckets", expect.objectContaining({ p_since: expect.any(String) }));
    expect(html).toContain("34,284");
    expect(html).toContain("299");
    // 291 / 19232 = 1.51% — not the 0% the has_chargeback flag produced.
    expect(html).toContain("1.51% (291/19232)");
    expect(html).not.toContain("aggregation failed");
  });

  it("says so when the aggregation fails instead of rendering silent zeros", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const html = await render();
    expect(html).toContain("The signal aggregation failed");
    expect(html).toContain("permission denied");
  });
});
