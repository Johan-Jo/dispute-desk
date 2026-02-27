import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  setTableResult,
} from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/files/samples/delete/route";

const mockGetServiceClient = vi.mocked(getServiceClient);

function makeRequest(shopId: string | null, body: unknown) {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return { headers, json: async () => body } as any;
}

describe("POST /api/files/samples/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await POST(makeRequest(null, { fileId: "f1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when fileId is missing", async () => {
    const res = await POST(makeRequest("shop-1", {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("fileId");
  });

  it("returns 404 when file not found", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "evidence_files", null);
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", { fileId: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("deletes file from storage and db", async () => {
    const client = createMockSupabaseClient();
    const filesBuilder = createMockQueryBuilder({
      data: { id: "file-1", storage_path: "shop-1/samples/uuid-receipt.pdf" },
      error: null,
    });
    client._builders.evidence_files = filesBuilder;
    client.from.mockImplementation((t: string) => {
      if (t === "evidence_files") return filesBuilder;
      return createMockQueryBuilder();
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(makeRequest("shop-1", { fileId: "file-1" }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(client.storage.from).toHaveBeenCalledWith("evidence-samples");
    expect(filesBuilder.delete).toHaveBeenCalled();
  });
});
