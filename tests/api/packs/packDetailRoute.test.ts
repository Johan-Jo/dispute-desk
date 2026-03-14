import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/db/packs", () => ({
  getPackById: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { getPackById } from "@/lib/db/packs";
import { GET } from "@/app/api/packs/[packId]/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockGetPackById = vi.mocked(getPackById);

describe("GET /api/packs/[packId]", () => {
  const packId = "ed33a8d0-66cd-4f18-beaa-1278a1f0affe";

  beforeEach(() => {
    vi.clearAllMocks();
    // evidence_packs: no row (so route falls back to library pack)
    const mockFrom = vi.fn((table: string) => {
      if (table === "evidence_packs") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "PGRST116" },
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });
    mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
  });

  it("returns 404 when pack is in neither evidence_packs nor packs", async () => {
    mockGetPackById.mockResolvedValue(null);

    const res = await GET(
      {} as never,
      { params: Promise.resolve({ packId }) }
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Pack not found");
    expect(mockGetPackById).toHaveBeenCalledWith(packId);
  });

  it("returns 200 with library pack shape when getPackById returns a pack", async () => {
    mockGetPackById.mockResolvedValue({
      id: packId,
      shop_id: "shop-uuid",
      name: "Fraud evidence pack",
      code: null,
      dispute_type: "FRAUD",
      status: "DRAFT",
      source: "TEMPLATE",
      template_id: "tpl-uuid",
      documents_count: 0,
      usage_count: 0,
      last_used_at: null,
      created_at: "2025-03-07T12:00:00Z",
      updated_at: "2025-03-07T12:00:00Z",
      shop_domain: "test.myshopify.com",
    });

    const res = await GET(
      {} as never,
      { params: Promise.resolve({ packId }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(packId);
    expect(data.name).toBe("Fraud evidence pack");
    expect(data.dispute_id).toBeNull();
    expect(data.dispute_gid).toBeNull();
    expect(data.evidence_items).toEqual([]);
    expect(data.audit_events).toEqual([]);
    expect(data.active_build_job).toBeNull();
    expect(data.active_pdf_job).toBeNull();
    expect(data.shop_domain).toBe("test.myshopify.com");
  });
});
