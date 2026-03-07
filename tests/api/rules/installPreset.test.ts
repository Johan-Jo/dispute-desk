import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/rules/install-preset/route";

const mockGetServiceClient = vi.mocked(getServiceClient);

function makeRequest(body: { shop_id?: string; preset_ids?: string[] }): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe("POST /api/rules/install-preset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("shop_id");
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = { json: async () => { throw new Error("parse error"); } } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when shop plan is free", async () => {
    const mockFrom = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { plan: "free" }, error: null }),
      };
      return chain;
    });
    mockGetServiceClient.mockReturnValue({ from: mockFrom } as any);

    const res = await POST(makeRequest({ shop_id: "shop-1" }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.upgrade_required).toBe(true);
  });

  it("returns 201 when plan allows rules and no existing rules", async () => {
    let rulesCallCount = 0;
    const mockFrom = vi.fn((table: string) => {
      if (table === "shops") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { plan: "starter" }, error: null }),
        };
      }
      if (table === "rules") {
        rulesCallCount++;
        if (rulesCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "r1", name: "Auto-Pack Fraudulent Disputes", shop_id: "shop-1" },
            error: null,
          }),
        };
      }
      return {};
    });
    mockGetServiceClient.mockReturnValue({ from: mockFrom } as any);

    const res = await POST(makeRequest({ shop_id: "shop-1" }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
