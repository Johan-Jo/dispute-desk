import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/setup/readiness", () => ({
  evaluateReadiness: vi.fn(),
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
});
