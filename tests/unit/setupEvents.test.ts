import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabaseClient } from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";

const mockGetServiceClient = vi.mocked(getServiceClient);

describe("logSetupEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache so each test gets fresh import
    vi.resetModules();
  });

  it("inserts an event row into app_events", async () => {
    const client = createMockSupabaseClient();
    mockGetServiceClient.mockReturnValue(client as any);

    const { logSetupEvent } = await import("@/lib/setup/events");
    await logSetupEvent("shop-123", "step_completed", { stepId: "permissions" });

    expect(client.from).toHaveBeenCalledWith("app_events");
    const builder = client._builders.app_events;
    expect(builder.insert).toHaveBeenCalledWith({
      shop_id: "shop-123",
      name: "step_completed",
      payload: { stepId: "permissions" },
    });
  });

  it("works with empty payload", async () => {
    const client = createMockSupabaseClient();
    mockGetServiceClient.mockReturnValue(client as any);

    const { logSetupEvent } = await import("@/lib/setup/events");
    await logSetupEvent("shop-1", "wizard_started");

    const builder = client._builders.app_events;
    expect(builder.insert).toHaveBeenCalledWith({
      shop_id: "shop-1",
      name: "wizard_started",
      payload: {},
    });
  });
});
