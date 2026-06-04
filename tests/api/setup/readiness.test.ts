import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/setup/readiness", () => ({
  evaluateReadiness: vi.fn(),
}));

const mockMaybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/setup/readiness/route";
import { evaluateReadiness } from "@/lib/setup/readiness";

const mockEvaluate = vi.mocked(evaluateReadiness);

function makeRequest(shopId?: string) {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return new Request("http://localhost/api/setup/readiness", { headers }) as any;
}

describe("GET /api/setup/readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("shop_id required");
  });

  it("returns readiness result for valid shop_id", async () => {
    const mockResult = {
      rows: [
        { id: "shopify_connected", status: "ready", blocking: true },
        { id: "dispute_access", status: "ready", blocking: true },
        { id: "evidence_access", status: "ready", blocking: true },
        { id: "webhooks_active", status: "ready", blocking: false },
        { id: "store_data", status: "ready", blocking: false },
      ],
      hasBlockers: false,
      hasPending: false,
      allReady: true,
    };
    mockEvaluate.mockResolvedValue(mockResult as any);

    const res = await GET(makeRequest("shop-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allReady).toBe(true);
    expect(body.rows).toHaveLength(5);
    expect(mockEvaluate).toHaveBeenCalledWith("shop-1");
  });

  it("reads shop_id from query param", async () => {
    mockEvaluate.mockResolvedValue({ rows: [], hasBlockers: false, hasPending: false, allReady: true } as any);

    const req = new Request("http://localhost/api/setup/readiness?shop_id=shop-q") as any;
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockEvaluate).toHaveBeenCalledWith("shop-q");
  });

  // Regression: embedded-only install where the shopify_shop_id CHIPS cookie
  // didn't arrive → middleware injects x-shop-id="demo". With a real ?shop=
  // domain the route must resolve the real shop row by domain, so a connected
  // shop is never reported as "not connected". (Sharp desk, 2026-06-04.)
  it("resolves real shop by domain when middleware injected demo", async () => {
    mockEvaluate.mockResolvedValue({ rows: [], hasBlockers: false, hasPending: false, allReady: true } as any);
    mockMaybeSingle.mockResolvedValue({ data: { id: "real-shop-uuid" }, error: null });

    const req = new Request(
      "http://localhost/api/setup/readiness?shop=sharpdesk.myshopify.com",
      { headers: { "x-shop-id": "demo" } },
    ) as any;
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockEvaluate).toHaveBeenCalledWith("real-shop-uuid");
  });

  it("does not domain-resolve when a real shopId is already present", async () => {
    mockEvaluate.mockResolvedValue({ rows: [], hasBlockers: false, hasPending: false, allReady: true } as any);
    mockMaybeSingle.mockClear();

    const req = new Request(
      "http://localhost/api/setup/readiness?shop=sharpdesk.myshopify.com",
      { headers: { "x-shop-id": "real-id" } },
    ) as any;
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockEvaluate).toHaveBeenCalledWith("real-id");
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });
});
