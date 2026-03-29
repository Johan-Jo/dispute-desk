import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
}));

vi.mock("@/lib/resources/admin-queries", () => ({
  getCmsSettings: vi.fn(),
  updateCmsSettings: vi.fn(),
}));

import { hasAdminSession } from "@/lib/admin/auth";
import { getCmsSettings, updateCmsSettings } from "@/lib/resources/admin-queries";
import { GET, PUT } from "@/app/api/admin/resources/settings/route";

const mockHasAdmin = vi.mocked(hasAdminSession);
const mockGetCms = vi.mocked(getCmsSettings);
const mockUpdateCms = vi.mocked(updateCmsSettings);

describe("GET /api/admin/resources/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 200 with settings json", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGetCms.mockResolvedValue({ autopilot: true });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.autopilot).toBe(true);
  });

  it("returns 500 when getCmsSettings throws", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGetCms.mockRejectedValue(new Error("cms read failed"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/admin/resources/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const req = new Request("http://localhost", {
      method: "PUT",
      body: JSON.stringify({}),
    });
    const res = await PUT(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 200 on successful update", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockUpdateCms.mockResolvedValue(undefined);
    const req = new Request("http://localhost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autopilotEnabled: true, weekendsEnabled: false }),
    });
    const res = await PUT(req as never);
    expect(res.status).toBe(200);
    expect(mockUpdateCms).toHaveBeenCalledWith({ autopilotEnabled: true, weekendsEnabled: false });
  });

  it("strips unknown keys from payload", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockUpdateCms.mockResolvedValue(undefined);
    const req = new Request("http://localhost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autopilotEnabled: true, unknownKey: "evil" }),
    });
    const res = await PUT(req as never);
    expect(res.status).toBe(200);
    expect(mockUpdateCms).toHaveBeenCalledWith({ autopilotEnabled: true });
  });
});
