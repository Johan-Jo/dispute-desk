import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
  createMockQueryBuilder,
} from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/security/encryption", () => ({
  encrypt: vi.fn(() => ({
    keyVersion: 1,
    iv: "aabbcc",
    tag: "ddeeff",
    ciphertext: "encrypted",
  })),
  serializeEncrypted: vi.fn(() => "v1:aabbcc:ddeeff:encrypted"),
}));

vi.mock("@/lib/setup/events", () => ({
  logSetupEvent: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logSetupEvent } from "@/lib/setup/events";
import { POST } from "@/app/api/integrations/gorgias/connect/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogEvent = vi.mocked(logSetupEvent);

function makeRequest(shopId: string | null, body: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (shopId) headers.set("x-shop-id", shopId);
  return { headers, json: async () => body } as any;
}

describe("POST /api/integrations/gorgias/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await POST(makeRequest(null, { subdomain: "test", email: "a@b.c", apiKey: "key" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when subdomain is missing", async () => {
    const res = await POST(makeRequest("shop-1", { email: "a@b.c", apiKey: "key" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("subdomain");
  });

  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest("shop-1", { subdomain: "test", apiKey: "key" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when apiKey is missing", async () => {
    const res = await POST(makeRequest("shop-1", { subdomain: "test", email: "a@b.c" }));
    expect(res.status).toBe(400);
  });

  it("returns ok:true when Gorgias test connection succeeds", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    const client = createMockSupabaseClient();
    const intBuilder = createMockQueryBuilder({ data: { id: "int-1" }, error: null });
    client._builders.integrations = intBuilder;
    const secretBuilder = createMockQueryBuilder({ data: null, error: null });
    client._builders.integration_secrets = secretBuilder;
    client.from.mockImplementation((t: string) => {
      if (t === "integrations") return intBuilder;
      if (t === "integration_secrets") return secretBuilder;
      return createMockQueryBuilder();
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", {
      subdomain: "myshop",
      email: "user@test.com",
      apiKey: "secret123",
    }));

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("connected");

    // Verify fetch was called with correct Gorgias URL
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://myshop.gorgias.com/api/tickets?limit=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("Basic "),
        }),
      })
    );

    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "integration_connected",
      expect.objectContaining({ type: "gorgias", subdomain: "myshop" })
    );
  });

  it("returns ok:false when Gorgias test connection fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const client = createMockSupabaseClient();
    const intBuilder = createMockQueryBuilder({ data: { id: "int-2" }, error: null });
    client._builders.integrations = intBuilder;
    const secretBuilder = createMockQueryBuilder({ data: null, error: null });
    client._builders.integration_secrets = secretBuilder;
    client.from.mockImplementation((t: string) => {
      if (t === "integrations") return intBuilder;
      if (t === "integration_secrets") return secretBuilder;
      return createMockQueryBuilder();
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", {
      subdomain: "bad",
      email: "user@test.com",
      apiKey: "wrong",
    }));

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe("needs_attention");
    expect(body.error).toContain("401");

    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "integration_failed",
      expect.objectContaining({ type: "gorgias" })
    );
  });

  it("handles network error during Gorgias test", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network timeout")
    );

    const client = createMockSupabaseClient();
    const intBuilder = createMockQueryBuilder({ data: { id: "int-3" }, error: null });
    client._builders.integrations = intBuilder;
    const secretBuilder = createMockQueryBuilder({ data: null, error: null });
    client._builders.integration_secrets = secretBuilder;
    client.from.mockImplementation((t: string) => {
      if (t === "integrations") return intBuilder;
      if (t === "integration_secrets") return secretBuilder;
      return createMockQueryBuilder();
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", {
      subdomain: "test",
      email: "user@test.com",
      apiKey: "key",
    }));

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe("needs_attention");
    expect(body.error).toContain("Network timeout");
  });
});
