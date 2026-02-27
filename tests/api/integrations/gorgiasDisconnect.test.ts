import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
  setTableResult,
  createMockQueryBuilder,
} from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/setup/events", () => ({
  logSetupEvent: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logSetupEvent } from "@/lib/setup/events";
import { POST } from "@/app/api/integrations/gorgias/disconnect/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogEvent = vi.mocked(logSetupEvent);

function makeRequest(shopId: string | null) {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return { headers, json: async () => ({}) } as any;
}

describe("POST /api/integrations/gorgias/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it("returns 404 when no gorgias integration exists", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "integrations", null);
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1"));
    expect(res.status).toBe(404);
  });

  it("deletes integration and secrets on disconnect", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "integrations", { id: "int-1" });

    const secretsBuilder = createMockQueryBuilder({ data: null, error: null });
    client._builders.integration_secrets = secretsBuilder;
    client.from.mockImplementation((t: string) => {
      if (t === "integrations") return client._builders.integrations;
      if (t === "integration_secrets") return secretsBuilder;
      return createMockQueryBuilder();
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1"));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(secretsBuilder.delete).toHaveBeenCalled();
    expect(client._builders.integrations.delete).toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "integration_disconnected",
      expect.objectContaining({ type: "gorgias" })
    );
  });
});
