import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
  createMockQueryBuilder,
} from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/integrations/status/route";

const mockGetServiceClient = vi.mocked(getServiceClient);

function makeRequest(shopId?: string) {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return new Request("http://localhost/api/integrations/status", { headers }) as any;
}

describe("GET /api/integrations/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it("returns list of integrations", async () => {
    const client = createMockSupabaseClient();
    const builder = createMockQueryBuilder({
      data: [
        { id: "int-1", type: "gorgias", status: "connected", meta: {}, created_at: "", updated_at: "" },
      ],
      error: null,
    });
    client._builders.integrations = builder;
    client.from.mockImplementation((t: string) => {
      if (t === "integrations") return builder;
      return createMockQueryBuilder();
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.integrations).toHaveLength(1);
    expect(body.integrations[0].type).toBe("gorgias");
  });

  it("returns empty array when no integrations exist", async () => {
    const client = createMockSupabaseClient();
    const builder = createMockQueryBuilder({ data: [], error: null });
    client._builders.integrations = builder;
    client.from.mockImplementation((t: string) => {
      if (t === "integrations") return builder;
      return createMockQueryBuilder();
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-1"));
    const body = await res.json();
    expect(body.integrations).toEqual([]);
  });
});
