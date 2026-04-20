import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { POST as saveToShopifyPOST } from "@/app/api/packs/[packId]/save-to-shopify/route";
import { POST as approvePOST } from "@/app/api/packs/[packId]/approve/route";

const mockGetServiceClient = vi.mocked(getServiceClient);

/** Build a minimal Supabase mock that returns a single evidence_packs row. */
function mockEvidencePacksSingle(packRow: Record<string, unknown> | null) {
  const mockFrom = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: packRow,
      error: packRow ? null : { message: "not found" },
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }));
  mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
}

const packId = "pack-uuid-1";

describe("Failed-pack submission guards", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("POST /api/packs/:packId/save-to-shopify rejects non-ready packs", () => {
    it("returns 409 PACK_NOT_READY when pack.status === 'failed'", async () => {
      mockEvidencePacksSingle({
        id: packId,
        shop_id: "shop-1",
        dispute_id: "dispute-1",
        status: "failed",
        completeness_score: 0,
        submission_readiness: null,
      });

      const req = new NextRequest("http://localhost/api/packs/pack-uuid-1/save-to-shopify", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await saveToShopifyPOST(req, {
        params: Promise.resolve({ packId }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("PACK_NOT_READY");
      expect(body.status).toBe("failed");
    });

    it("returns 409 PACK_NOT_READY when pack.status === 'building'", async () => {
      mockEvidencePacksSingle({
        id: packId,
        shop_id: "shop-1",
        dispute_id: "dispute-1",
        status: "building",
        completeness_score: null,
        submission_readiness: null,
      });

      const req = new NextRequest("http://localhost/api/packs/pack-uuid-1/save-to-shopify", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await saveToShopifyPOST(req, {
        params: Promise.resolve({ packId }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("PACK_NOT_READY");
    });
  });

  describe("POST /api/packs/:packId/approve rejects non-ready packs", () => {
    it("returns 409 PACK_NOT_READY when pack.status === 'failed'", async () => {
      mockEvidencePacksSingle({
        id: packId,
        shop_id: "shop-1",
        dispute_id: "dispute-1",
        status: "failed",
        completeness_score: 0,
      });

      const req = new NextRequest("http://localhost/api/packs/pack-uuid-1/approve", {
        method: "POST",
        body: JSON.stringify({ user_id: "user-1" }),
      });
      const res = await approvePOST(req, {
        params: Promise.resolve({ packId }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("PACK_NOT_READY");
      expect(body.status).toBe("failed");
    });

    it("returns 409 PACK_NOT_READY when pack.status === 'queued'", async () => {
      mockEvidencePacksSingle({
        id: packId,
        shop_id: "shop-1",
        dispute_id: "dispute-1",
        status: "queued",
        completeness_score: null,
      });

      const req = new NextRequest("http://localhost/api/packs/pack-uuid-1/approve", {
        method: "POST",
        body: JSON.stringify({ user_id: "user-1" }),
      });
      const res = await approvePOST(req, {
        params: Promise.resolve({ packId }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("PACK_NOT_READY");
    });
  });
});
