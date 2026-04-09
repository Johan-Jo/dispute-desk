import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
  setTableResult,
} from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/setup/events", () => ({
  logSetupEvent: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logSetupEvent } from "@/lib/setup/events";
import { POST } from "@/app/api/setup/step/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogEvent = vi.mocked(logSetupEvent);

function makeRequest(shopId: string | null, body: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (shopId) headers.set("x-shop-id", shopId);
  return {
    headers,
    json: async () => body,
  } as any;
}

describe("POST /api/setup/step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await POST(makeRequest(null, { stepId: "store_profile" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid stepId", async () => {
    const res = await POST(makeRequest("shop-1", { stepId: "invalid_step" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid stepId");
  });

  it("creates a new shop_setup row when none exists", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", null);
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", {
      stepId: "store_profile",
      payload: { primaryGoal: "win" },
    }));

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.stepId).toBe("store_profile");
    expect(body.status).toBe("done");

    expect(client._builders.shop_setup.insert).toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "step_completed",
      expect.objectContaining({ stepId: "store_profile" })
    );
  });

  it("updates existing shop_setup row", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-1",
      steps: {
        overview: { status: "done" },
      },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", {
      stepId: "connection",
      payload: { verified: true },
    }));

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.stepId).toBe("connection");

    expect(client._builders.shop_setup.update).toHaveBeenCalled();
  });
});
