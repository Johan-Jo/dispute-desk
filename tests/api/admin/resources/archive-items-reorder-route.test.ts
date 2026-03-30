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
import { POST } from "@/app/api/admin/resources/archive-items/reorder/route";

const mockHasAdmin = vi.mocked(hasAdminSession);
const mockGetService = vi.mocked(getServiceClient);

describe("POST /api/admin/resources/archive-items/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const req = new NextRequest("http://localhost/api/admin/resources/archive-items/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds: ["a"] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when orderedIds missing", async () => {
    mockHasAdmin.mockResolvedValue(true);
    const req = new NextRequest("http://localhost/api/admin/resources/archive-items/reorder", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("updates each id", async () => {
    mockHasAdmin.mockResolvedValue(true);
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockGetService.mockReturnValue({
      from: vi.fn(() => ({ update })),
    } as never);

    const req = new NextRequest("http://localhost/api/admin/resources/archive-items/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds: ["id1", "id2"] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(2);
    const json = (await res.json()) as { updated: number };
    expect(json.updated).toBe(2);
  });
});
