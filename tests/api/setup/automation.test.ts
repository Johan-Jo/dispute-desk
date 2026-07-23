import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  createMockSupabaseClient,
  setTableResult,
} from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/db/packs", () => ({
  listLibraryPacksForAutomationRules: vi.fn(),
  listInstalledTemplateIdsForShop: vi.fn(),
}));

vi.mock("@/lib/rules/replacePackAutomationRules", () => ({
  replacePackBasedAutomationRules: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import {
  listLibraryPacksForAutomationRules,
  listInstalledTemplateIdsForShop,
} from "@/lib/db/packs";
import { replacePackBasedAutomationRules } from "@/lib/rules/replacePackAutomationRules";
import { GET, POST } from "@/app/api/setup/automation/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockListPacks = vi.mocked(listLibraryPacksForAutomationRules);
const mockListInstalled = vi.mocked(listInstalledTemplateIdsForShop);
const mockReplaceRules = vi.mocked(replacePackBasedAutomationRules);

function setupClient(plan: string) {
  const client = createMockSupabaseClient();
  setTableResult(client, "rules", []);
  setTableResult(client, "shops", { plan });
  mockGetServiceClient.mockReturnValue(client as any);
  return client;
}

function getRequest(shopId = "shop-1") {
  return new NextRequest(
    `http://localhost/api/setup/automation?shop_id=${shopId}`,
  );
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/setup/automation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/setup/automation — rulesAccess plan gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPacks.mockResolvedValue([]);
    mockListInstalled.mockResolvedValue([]);
  });

  it("reports rulesAccess.allowed=false with a reason on the free plan", async () => {
    setupClient("free");
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rulesAccess.allowed).toBe(false);
    expect(body.rulesAccess.reason).toBeTruthy();
  });

  it("reports rulesAccess.allowed=true on paid plans", async () => {
    setupClient("starter");
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rulesAccess).toEqual({ allowed: true, reason: null });
  });
});

describe("POST /api/setup/automation — plan gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPacks.mockResolvedValue([]);
    mockListInstalled.mockResolvedValue([]);
    mockReplaceRules.mockResolvedValue(undefined);
  });

  it("rejects free-plan saves with 403 upgrade_required and writes nothing", async () => {
    setupClient("free");
    const res = await POST(postRequest({ shop_id: "shop-1", pack_modes: {} }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.upgrade_required).toBe(true);
    expect(typeof body.error).toBe("string");
    expect(mockReplaceRules).not.toHaveBeenCalled();
  });

  it("saves pack modes on paid plans", async () => {
    setupClient("starter");
    const res = await POST(postRequest({ shop_id: "shop-1", pack_modes: {} }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockReplaceRules).toHaveBeenCalledWith("shop-1", [], {});
  });
});
