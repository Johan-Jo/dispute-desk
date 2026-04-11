import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockSupabaseClient,
  setTableResult,
} from "@/tests/helpers/supabaseMock";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/setup/state/route";

const mockGetServiceClient = vi.mocked(getServiceClient);

function makeRequest(shopId?: string) {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return new Request("http://localhost/api/setup/state", { headers }) as any;
}

describe("GET /api/setup/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when shop_id header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("shop_id");
  });

  it("returns default todo state when no shop_setup row exists", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", null);
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-123"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.progress.doneCount).toBe(0);
    expect(body.progress.total).toBe(6);
    expect(body.allDone).toBe(false);
    expect(body.nextStepId).toBe("connection");

    // All steps should be todo
    for (const step of Object.values(body.steps)) {
      expect((step as any).status).toBe("todo");
    }
  });

  it("returns correct progress for partially complete setup", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-123",
      steps: {
        connection: { status: "done", completed_at: "2026-01-01" },
        store_profile: { status: "done", completed_at: "2026-01-01" },
        coverage: { status: "in_progress" },
      },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-123"));
    const body = await res.json();

    expect(body.progress.doneCount).toBe(2);
    expect(body.progress.total).toBe(6);
    expect(body.nextStepId).toBe("coverage");
    expect(body.allDone).toBe(false);
  });

  it("migrates legacy step ids to new ids", async () => {
    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-123",
      steps: {
        permissions: { status: "done", completed_at: "2026-01-01" },
        overview: { status: "done" },
        disputes: { status: "in_progress" },
      },
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-123"));
    const body = await res.json();

    expect(body.steps.connection?.status).toBe("done");
    expect(body.steps.coverage?.status).toBe("in_progress");
    expect(body.nextStepId).toBe("store_profile");
  });

  it("returns allDone when all 6 onboarding steps are done", async () => {
    const allDoneSteps: Record<string, { status: string }> = {};
    const ids = [
      "connection", "store_profile", "coverage", "automation", "policies", "activate",
    ];
    for (const id of ids) {
      allDoneSteps[id] = { status: "done", completed_at: "2026-01-01" } as any;
    }

    const client = createMockSupabaseClient();
    setTableResult(client, "shop_setup", {
      shop_id: "shop-123",
      steps: allDoneSteps,
    });
    mockGetServiceClient.mockReturnValue(client as any);

    const res = await GET(makeRequest("shop-123"));
    const body = await res.json();

    expect(body.progress.doneCount).toBe(6);
    expect(body.allDone).toBe(true);
    expect(body.nextStepId).toBeNull();
  });
});
