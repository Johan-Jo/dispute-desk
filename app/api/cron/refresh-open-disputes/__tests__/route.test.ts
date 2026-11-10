/**
 * The nightly refresh rebuilt 28 disputes EVERY night (prod, 2026-11-10)
 * because the re-ingest wiped a carrier-derived "Delivered" to null and the
 * route counted null as a change. A rebuild is warranted only when a
 * delivery status APPEARS or MOVES, never when it merely reads as null.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron/envGate", () => ({ cronEnvGate: () => null }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/shopify/orderIngest", () => ({
  normalizeOrderIngest: vi.fn(async () => ({ status: "applied" })),
}));
vi.mock("@/lib/jobs/claimJobs", () => ({ enqueueJob: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn(async () => undefined) }));

import { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { GET } from "../route";

function sbWith(before: string | null, after: string | null) {
  const reads = [before, after];
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const k of ["select", "eq", "in", "not", "order"]) chain[k] = self;
      if (table === "disputes") {
        chain.limit = () =>
          Promise.resolve({ data: [{ id: "d1", shop_id: "s1", order_gid: "gid://o/1", status: "needs_response" }], error: null });
      } else if (table === "evidence_packs") {
        chain.maybeSingle = () => Promise.resolve({ data: { id: "p1" } });
      } else {
        chain.maybeSingle = () => Promise.resolve({ data: { delivery_status: reads.shift() ?? null } });
      }
      return chain;
    },
  };
}

async function run(before: string | null, after: string | null) {
  vi.mocked(getServiceClient).mockReturnValue(sbWith(before, after) as never);
  const res = await GET(new NextRequest("http://x/api/cron/refresh-open-disputes"));
  return res.json();
}

beforeEach(() => vi.mocked(enqueueJob).mockClear());

describe("refresh-open-disputes delivery comparison", () => {
  it("does not rebuild when the status reads null afterwards", async () => {
    const out = await run("Delivered", null);
    expect(out.rebuildsEnqueued).toBe(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("rebuilds exactly once on a real change", async () => {
    const out = await run("In transit", "Delivered");
    expect(out.rebuildsEnqueued).toBe(1);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when a status first appears", async () => {
    const out = await run(null, "Delivered");
    expect(out.rebuildsEnqueued).toBe(1);
  });

  it("does nothing when unchanged", async () => {
    const out = await run("Delivered", "Delivered");
    expect(out.rebuildsEnqueued).toBe(0);
  });
});
