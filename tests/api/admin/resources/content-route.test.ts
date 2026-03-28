import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
}));

vi.mock("@/lib/resources/admin-queries", () => ({
  getContentList: vi.fn(),
}));

import { hasAdminSession } from "@/lib/admin/auth";
import { getContentList } from "@/lib/resources/admin-queries";
import { GET } from "@/app/api/admin/resources/content/route";

const mockHasAdmin = vi.mocked(hasAdminSession);
const mockGetContentList = vi.mocked(getContentList);

describe("GET /api/admin/resources/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const req = new NextRequest("http://localhost/api/admin/resources/content");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 with list result", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGetContentList.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never);
    const req = new NextRequest("http://localhost/api/admin/resources/content?page=1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { total: number };
    expect(json.total).toBe(0);
    expect(mockGetContentList).toHaveBeenCalled();
  });

  it("returns 500 when getContentList throws", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGetContentList.mockRejectedValue(new Error("list failed"));
    const req = new NextRequest("http://localhost/api/admin/resources/content");
    const res = await GET(req);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("list failed");
  });
});
