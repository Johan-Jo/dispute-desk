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
import { POST } from "@/app/api/setup/skip/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogEvent = vi.mocked(logSetupEvent);

function makeRequest(shopId: string | null, body: unknown) {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return { headers, json: async () => body } as any;
}

describe("POST /api/setup/skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await POST(makeRequest(null, { stepId: "store_profile", reason: "do_later" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid stepId", async () => {
    const res = await POST(makeRequest("shop-1", { stepId: "fake", reason: "do_later" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid reason", async () => {
    const res = await POST(makeRequest("shop-1", { stepId: "store_profile", reason: "bored" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("reason required");
  });

  it("returns 400 when reason is missing", async () => {
    const res = await POST(makeRequest("shop-1", { stepId: "store_profile" }));
    expect(res.status).toBe(400);
  });

  it("marks step as skipped with valid reason", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-1",
      steps: { overview: { status: "todo" } },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", {
      stepId: "store_profile",
      reason: "do_later",
    }));

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("skipped");

    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "step_skipped",
      expect.objectContaining({ stepId: "store_profile", reason: "do_later" })
    );
  });

  it("accepts all three valid reasons", async () => {
    for (const reason of ["do_later", "not_relevant", "need_help"]) {
      const client = createMockSupabaseClient();
      setTableResult(client, "shop_setup", null);
      mockGetServiceClient.mockReturnValue(client as any);
      vi.clearAllMocks();
      mockGetServiceClient.mockReturnValue(client as any);

      const res = await POST(makeRequest("shop-1", {
        stepId: "connection",
        reason,
      }));
      const body = await res.json();
      expect(body.ok).toBe(true);
    }
  });
});
