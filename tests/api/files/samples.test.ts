import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
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
import { GET, POST } from "@/app/api/files/samples/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogEvent = vi.mocked(logSetupEvent);

function makeGetRequest(shopId?: string) {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return new Request("http://localhost/api/files/samples", { headers }) as any;
}

describe("GET /api/files/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
  });

  it("returns list of sample files", async () => {
    const client = createMockSupabaseClient();
    const builder = createMockQueryBuilder({
      data: [
        {
          id: "file-1",
          shop_id: "shop-1",
          filename: "receipt.pdf",
          storage_path: "shop-1/samples/uuid-receipt.pdf",
          mime_type: "application/pdf",
          size_bytes: 1024,
          kind: "sample",
          created_at: "2026-01-01",
        },
      ],
      error: null,
    });
    client._builders.evidence_files = builder;
    client.from.mockImplementation((t: string) => {
      if (t === "evidence_files") return builder;
      return createMockQueryBuilder();
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeGetRequest("shop-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].filename).toBe("receipt.pdf");
  });
});

describe("POST /api/files/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id is missing", async () => {
    const headers = new Headers();
    const req = {
      headers,
      formData: async () => new FormData(),
    } as any;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when no file is provided", async () => {
    const headers = new Headers();
    headers.set("x-shop-id", "shop-1");
    const req = {
      headers,
      formData: async () => new FormData(),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("file is required");
  });

  it("returns 400 for disallowed file type", async () => {
    const file = new File(["data"], "script.js", { type: "application/javascript" });
    const formData = new FormData();
    formData.append("file", file);

    const headers = new Headers();
    headers.set("x-shop-id", "shop-1");
    const req = {
      headers,
      formData: async () => formData,
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not allowed");
  });

  it("uploads pdf file successfully", async () => {
    const fileContent = new Uint8Array(100);
    const file = new File([fileContent], "evidence.pdf", { type: "application/pdf" });
    const formData = new FormData();
    formData.append("file", file);

    const headers = new Headers();
    headers.set("x-shop-id", "shop-1");
    const req = {
      headers,
      formData: async () => formData,
    } as any;

    const client = createMockSupabaseClient();
    const filesBuilder = createMockQueryBuilder({
      data: {
        id: "file-new",
        shop_id: "shop-1",
        filename: "evidence.pdf",
        storage_path: "shop-1/samples/uuid-evidence.pdf",
        mime_type: "application/pdf",
        size_bytes: 100,
        kind: "sample",
        created_at: "2026-01-01",
      },
      error: null,
    });
    client._builders.evidence_files = filesBuilder;
    client.from.mockImplementation((t: string) => {
      if (t === "evidence_files") return filesBuilder;
      return createMockQueryBuilder();
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await POST(req);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.file.filename).toBe("evidence.pdf");

    expect(client.storage.from).toHaveBeenCalledWith("evidence-samples");
    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "sample_file_uploaded",
      expect.objectContaining({ filename: "evidence.pdf" })
    );
  });
});
