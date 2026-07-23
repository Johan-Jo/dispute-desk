import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// POST /api/disputes/:id/review — merchant review lifecycle
// (hold/approve/concede/clear). Asserts the update payload written per
// action + the guard behaviour, with the Supabase client + audit stubbed.

const state: {
  dispute: Record<string, unknown> | null;
  lastUpdate: Record<string, unknown> | null;
} = { dispute: null, lastUpdate: null };

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => makeMockClient(),
}));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn() }));

function makeMockClient() {
  return {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: state.dispute, error: state.dispute ? null : { message: "not found" } }),
        update: (payload: Record<string, unknown>) => {
          state.lastUpdate = payload;
          return {
            eq: () => ({ eq: async () => ({ error: null }) }),
          };
        },
      };
      return chain;
    },
  };
}

import { POST } from "@/app/api/disputes/[id]/review/route";

function req(body: unknown, shopId: string | null = "s1") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (shopId) headers["x-shop-id"] = shopId;
  return new NextRequest("http://localhost/api/disputes/d1/review", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ id: "d1" });

beforeEach(() => {
  state.dispute = {
    id: "d1",
    shop_id: "s1",
    due_at: "2026-08-31T23:00:00Z",
    review_state: null,
    needs_attention: true,
  };
  state.lastUpdate = null;
});

describe("POST /api/disputes/:id/review", () => {
  it("401 without shop context", async () => {
    const res = await POST(req({ action: "hold" }, null), { params });
    expect(res.status).toBe(401);
  });

  it("400 on an unknown action", async () => {
    const res = await POST(req({ action: "submit" }), { params });
    expect(res.status).toBe(400);
  });

  it("404 when the dispute isn't found for this shop", async () => {
    state.dispute = null;
    const res = await POST(req({ action: "hold" }), { params });
    expect(res.status).toBe(404);
  });

  it("hold → in_review, snapshots due_at, keeps needs_attention", async () => {
    const res = await POST(req({ action: "hold" }), { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate?.review_state).toBe("in_review");
    expect(state.lastUpdate?.review_due_at).toBe("2026-08-31T23:00:00Z");
    // hold does not clear needs_attention (still WIP)
    expect(state.lastUpdate).not.toHaveProperty("needs_attention");
  });

  it("approve → approved, clears needs_attention + review_due_at", async () => {
    const res = await POST(req({ action: "approve" }), { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate?.review_state).toBe("approved");
    expect(state.lastUpdate?.needs_attention).toBe(false);
    expect(state.lastUpdate?.attention_reason).toBeNull();
    expect(state.lastUpdate?.review_due_at).toBeNull();
  });

  it("concede → conceded, clears needs_attention", async () => {
    const res = await POST(req({ action: "concede" }), { params });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(state.lastUpdate?.review_state).toBe("conceded");
    expect(state.lastUpdate?.needs_attention).toBe(false);
    expect(json.conceded).toBe(true);
  });

  it("clear → null review_state", async () => {
    state.dispute = { ...state.dispute!, review_state: "in_review" };
    const res = await POST(req({ action: "clear" }), { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate?.review_state).toBeNull();
  });
});
