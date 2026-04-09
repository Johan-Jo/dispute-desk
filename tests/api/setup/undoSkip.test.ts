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
import { POST } from "@/app/api/setup/undo-skip/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogEvent = vi.mocked(logSetupEvent);

function makeRequest(shopId: string | null, body: unknown) {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return { headers, json: async () => body } as any;
}

describe("POST /api/setup/undo-skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await POST(makeRequest(null, { stepId: "store_profile" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid stepId", async () => {
    const res = await POST(makeRequest("shop-1", { stepId: "bad" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when no shop_setup exists", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", null);
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", { stepId: "store_profile" }));
    expect(res.status).toBe(404);
  });

  it("resets a skipped step to todo", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-1",
      steps: {
        overview: { status: "skipped", skipped_reason: "do_later" },
      },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", { stepId: "store_profile" }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.status).toBe("todo");

    expect(client._builders.shop_setup.update).toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "step_undo_skip",
      expect.objectContaining({ stepId: "store_profile" })
    );
  });
});
