/**
 * PATCH /api/admin/jobs/:id — Retry/Cancel are guarded by the job's current
 * status. A stale click (job already moved on) matched zero rows but the route
 * still answered `ok: true`, so the page claimed success for a no-op.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let matched: Array<{ id: string }> = [];
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      update: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["eq", "in"]) chain[m] = () => chain;
        chain.select = () => Promise.resolve({ data: matched, error: null });
        return chain;
      },
    }),
  }),
}));

import { PATCH } from "@/app/api/admin/jobs/[id]/route";

const ctx = { params: Promise.resolve({ id: "job-1" }) };
const call = (body: unknown) => PATCH({ json: async () => body } as never, ctx);

beforeEach(() => {
  matched = [];
});

describe("PATCH /api/admin/jobs/:id", () => {
  it("retry on a job that is no longer failed is a 409, not a fake success", async () => {
    const res = await call({ action: "retry" });
    expect(res.status).toBe(409);
  });

  it("cancel on a finished job is a 409", async () => {
    expect((await call({ action: "cancel" })).status).toBe(409);
  });

  it("succeeds when a row matched", async () => {
    matched = [{ id: "job-1" }];
    const res = await call({ action: "retry" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, action: "retried" });
  });

  it("unknown action and malformed body are 400", async () => {
    expect((await call({ action: "explode" })).status).toBe(400);
    expect((await PATCH({ json: async () => { throw new Error("x"); } } as never, ctx)).status).toBe(400);
  });
});
