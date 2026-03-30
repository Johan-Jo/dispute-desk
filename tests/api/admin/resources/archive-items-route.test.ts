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
import { DELETE, POST } from "@/app/api/admin/resources/archive-items/route";

const mockHasAdmin = vi.mocked(hasAdminSession);
const mockGetService = vi.mocked(getServiceClient);

describe("POST /api/admin/resources/archive-items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const req = new NextRequest("http://localhost/api/admin/resources/archive-items", {
      method: "POST",
      body: JSON.stringify({ proposed_title: "Test" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when proposed_title is missing", async () => {
    mockHasAdmin.mockResolvedValue(true);
    const req = new NextRequest("http://localhost/api/admin/resources/archive-items", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 201 with inserted item", async () => {
    mockHasAdmin.mockResolvedValue(true);
    const inserted = { id: "new-id", proposed_title: "Hello", status: "idea" };
    mockGetService.mockReturnValue(
      {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { backlog_rank: 500 }, error: null }),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
            })),
          })),
        })),
      } as never,
    );

    const req = new NextRequest("http://localhost/api/admin/resources/archive-items", {
      method: "POST",
      body: JSON.stringify({
        proposed_title: "Hello",
        primary_pillar: "chargebacks",
        content_type: "cluster_article",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { item: { id: string } };
    expect(json.item.id).toBe("new-id");
  });
});

describe("DELETE /api/admin/resources/archive-items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("returns deleted count", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGetService.mockReturnValue({
      from: vi.fn(() => ({
        delete: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: [{ id: "a" }, { id: "b" }], error: null }),
      })),
    } as never);

    const res = await DELETE();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { deleted: number };
    expect(json.deleted).toBe(2);
  });
});
