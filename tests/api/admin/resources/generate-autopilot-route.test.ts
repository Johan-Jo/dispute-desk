import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(),
}));

vi.mock("@/lib/resources/generation/generate", () => ({
  isGenerationEnabled: vi.fn(),
}));

vi.mock("@/lib/resources/generation/pipeline", () => ({
  runGenerationPipeline: vi.fn(),
}));

vi.mock("@/lib/resources/admin-queries", () => ({
  getCmsSettings: vi.fn(),
}));

import { hasAdminSession } from "@/lib/admin/auth";
import { isGenerationEnabled } from "@/lib/resources/generation/generate";
import { runGenerationPipeline } from "@/lib/resources/generation/pipeline";
import { getCmsSettings } from "@/lib/resources/admin-queries";
import { POST } from "@/app/api/admin/resources/generate-autopilot/route";

const mockHasAdmin = vi.mocked(hasAdminSession);
const mockGenEnabled = vi.mocked(isGenerationEnabled);
const mockPipeline = vi.mocked(runGenerationPipeline);
const mockSettings = vi.mocked(getCmsSettings);

describe("POST /api/admin/resources/generate-autopilot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockHasAdmin.mockResolvedValue(false);
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ archiveItemId: "x" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 503 when generation is not enabled", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGenEnabled.mockReturnValue(false);
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ archiveItemId: "arch-1" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("GENERATION_ENABLED");
  });

  it("returns 400 when archiveItemId is missing", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGenEnabled.mockReturnValue(true);
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when autopilot is disabled in settings", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGenEnabled.mockReturnValue(true);
    mockSettings.mockResolvedValue({ autopilotEnabled: false });
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archiveItemId: "arch-1" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Autopilot is off");
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  it("runs pipeline with autopilot flags and returns 200 with contentItemId", async () => {
    mockHasAdmin.mockResolvedValue(true);
    mockGenEnabled.mockReturnValue(true);
    mockSettings.mockResolvedValue({ autopilotEnabled: true });
    mockPipeline.mockResolvedValue({
      contentItemId: "new-id",
      error: null,
      results: [{ locale: "en-US", content: {}, error: null, tokensUsed: 10 }],
    } as never);
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archiveItemId: "arch-1" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { contentItemId: string };
    expect(json.contentItemId).toBe("new-id");
    expect(mockPipeline).toHaveBeenCalledWith("arch-1", {
      autopilot: true,
      autopilotDrainBacklog: false,
    });
  });
});
