import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
}));

vi.mock("@/lib/resources/admin-queries", () => ({
  getContentForEditor: vi.fn(),
  updateWorkflowStatus: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { hasAdminSession } from "@/lib/admin/auth";
import { getContentForEditor, updateWorkflowStatus } from "@/lib/resources/admin-queries";
import { getServiceClient } from "@/lib/supabase/server";
import { GET, PUT } from "@/app/api/admin/resources/content/[id]/route";

const mockHasAdmin = vi.mocked(hasAdminSession);
const mockGetContent = vi.mocked(getContentForEditor);
const mockUpdateWorkflow = vi.mocked(updateWorkflowStatus);
const mockGetService = vi.mocked(getServiceClient);

describe("GET /api/admin/resources/content/[id]", () => {
  const id = "c64bb447-6efe-4353-a25c-344532facd75";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const res = await GET({} as never, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when content not found", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGetContent.mockResolvedValue(null);
    const res = await GET({} as never, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(404);
  });

  it("returns 200 with editor payload", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGetContent.mockResolvedValue({
      item: { id },
      localizations: [],
      tags: [],
      revisions: [],
    } as never);
    const res = await GET({} as never, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { item: { id: string } };
    expect(json.item.id).toBe(id);
  });

  it("returns 500 when getContentForEditor throws", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGetContent.mockRejectedValue(new Error("db boom"));
    const res = await GET({} as never, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("db boom");
  });
});

describe("PUT /api/admin/resources/content/[id]", () => {
  const id = "c64bb447-6efe-4353-a25c-344532facd75";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const req = new Request("http://localhost", {
      method: "PUT",
      body: JSON.stringify({}),
    });
    const res = await PUT(req as never, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid primary_pillar", async () => {
    mockHasAdmin.mockResolvedValue(true);
    const req = new Request("http://localhost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { primary_pillar: "not-a-real-pillar" } }),
    });
    const res = await PUT(req as never, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("primary_pillar");
  });

  it("returns 400 for invalid workflow transition status strings", async () => {
    mockHasAdmin.mockResolvedValue(true);
    const req = new Request("http://localhost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowTransition: { from: "not-real", to: "drafting" },
      }),
    });
    const res = await PUT(req as never, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(400);
  });

  it("calls updateWorkflowStatus for valid workflow transition", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockUpdateWorkflow.mockResolvedValue(undefined);
    const req = new Request("http://localhost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowTransition: { from: "drafting", to: "in-editorial-review" },
      }),
    });
    const res = await PUT(req as never, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(mockUpdateWorkflow).toHaveBeenCalledWith(
      id,
      "drafting",
      "in-editorial-review"
    );
  });

  it("updates content_items when item payload is valid", async () => {
    mockHasAdmin.mockResolvedValue(true);
    const eq = vi.fn().mockResolvedValue({ error: null });
    mockGetService.mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn().mockReturnValue({ eq }),
      })),
    } as never);

    const req = new Request("http://localhost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: { primary_pillar: "chargebacks", topic: "test" },
      }),
    });
    const res = await PUT(req as never, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(eq).toHaveBeenCalled();
  });
});
