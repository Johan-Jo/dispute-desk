/**
 * The top-bar bell used to be a decorative button with a hard-coded red dot.
 * /api/admin/notifications backs the real one: exact counts of what needs an
 * operator, zero-count items omitted, failures surfaced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type R = { count: number | null; error: { message: string } | null };
let byKey: Record<string, R> = {};

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const filters: string[] = [];
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.is = () => chain;
      chain.eq = (col: string, v: unknown) => { filters.push(`${col}=${v}`); return chain; };
      chain.neq = (col: string, v: unknown) => { filters.push(`${col}!=${v}`); return chain; };
      chain.then = (res: (v: unknown) => unknown) => {
        const key = table === "jobs" ? "failed_jobs"
          : filters.includes("needs_attention=true") ? "needs_attention"
          : filters.includes("sync_health!=ok") ? "sync_issues"
          : "uncertain_submissions";
        return Promise.resolve(byKey[key] ?? { count: 0, error: null }).then(res);
      };
      return chain;
    },
  }),
}));

import { GET } from "@/app/api/admin/notifications/route";

beforeEach(() => { byKey = {}; });

describe("GET /api/admin/notifications", () => {
  it("returns only non-zero items and the total", async () => {
    byKey = {
      needs_attention: { count: 1, error: null },
      failed_jobs: { count: 6, error: null },
    };
    const body = await (await GET()).json();
    expect(body.total).toBe(7);
    expect(body.items.map((i: { key: string }) => i.key)).toEqual(["needs_attention", "failed_jobs"]);
    expect(body.items[1]).toMatchObject({ href: "/admin/jobs", count: 6 });
  });

  it("is an empty list (no red dot) when nothing needs attention", async () => {
    const body = await (await GET()).json();
    expect(body).toEqual({ total: 0, items: [] });
  });

  it("surfaces a failed count as 500 instead of silently showing zero", async () => {
    byKey = { sync_issues: { count: null, error: { message: "boom" } } };
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});
