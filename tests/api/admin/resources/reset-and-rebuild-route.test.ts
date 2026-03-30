import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { hasAdminSession } from "@/lib/admin/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/admin/resources/reset-and-rebuild/route";

const mockHasAdmin = vi.mocked(hasAdminSession);
const mockGetService = vi.mocked(getServiceClient);

const testId = "c64bb447-6efe-4353-a25c-344532facd75";

function mockClientForNoMatches() {
  mockGetService.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "content_items") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          neq: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {};
    }),
  } as never);
}

function mockClientForDryRunSuccess() {
  const locId = "11111111-1111-1111-1111-111111111111";
  mockGetService.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "content_items") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          neq: vi.fn().mockResolvedValue({ data: [{ id: testId }], error: null }),
          update: vi.fn().mockReturnThis(),
        };
      }
      if (table === "content_localizations") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [{ id: locId }], error: null }),
        };
      }
      if (table === "content_publish_queue") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ count: 2, error: null }),
        };
      }
      if (table === "content_archive_items") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ count: 1, error: null }),
        };
      }
      return {};
    }),
  } as never);
}

describe("POST /api/admin/resources/reset-and-rebuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const req = new NextRequest("http://localhost/api/admin/resources/reset-and-rebuild", {
      method: "POST",
      body: JSON.stringify({ ids: [testId] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when ids match no AI-tracked non-archived rows", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockClientForNoMatches();
    const req = new NextRequest("http://localhost/api/admin/resources/reset-and-rebuild", {
      method: "POST",
      body: JSON.stringify({ ids: [testId] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: string;
      skippedRequestedIds?: string[];
    };
    expect(json.error).toContain("No matching");
    expect(json.skippedRequestedIds).toEqual([testId]);
  });

  it("returns dry-run summary when ids are eligible", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockClientForDryRunSuccess();
    const req = new NextRequest("http://localhost/api/admin/resources/reset-and-rebuild", {
      method: "POST",
      body: JSON.stringify({ ids: [testId], dryRun: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      dryRun: boolean;
      found: number;
      wouldArchive: number;
    };
    expect(json.ok).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.found).toBe(1);
    expect(json.wouldArchive).toBe(1);
  });
});
