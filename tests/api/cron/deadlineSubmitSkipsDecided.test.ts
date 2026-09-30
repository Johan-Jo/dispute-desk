/**
 * A dispute Shopify already decided (lost / won / accepted) is skipped by the
 * deadline cron before anything else runs — no pack lookup, no refusal, no
 * "filed nothing" admin alert. #100411 (2026-09-30) lost on 09-27 but its
 * due_at was still 10-01, so the cron paged a stale_response_cycle refusal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email/sendDefenceDeadlineFallbackAlert", () => ({
  sendDefenceDeadlineFallbackAlert: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/email/sendDeadlineNoFileAdminAlert", () => ({
  sendDeadlineNoFileAdminAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/featureFlags", () => ({ isDefencePackageBuilderEnabled: () => true }));
vi.mock("@/lib/cron/envGate", () => ({ cronEnvGate: () => null }));

import { getServiceClient } from "@/lib/supabase/server";
import { sendDeadlineNoFileAdminAlert } from "@/lib/email/sendDeadlineNoFileAdminAlert";
import { GET } from "@/app/api/cron/defence-package-deadline-submit/route";
import { NextRequest } from "next/server";
import { CANONICAL_PIPELINE_ENV, CANONICAL_PIPELINE_ON } from "@/lib/pipeline/activation";
import { isDecidedDispute } from "@/lib/disputes/reopenAfterClose";

const DECIDED = {
  id: "dispute-1",
  shop_id: "shop-1",
  dispute_gid: "gid://shopify/ShopifyPaymentsDispute/1",
  order_name: "#100411",
  reason: "PRODUCT_UNACCEPTABLE",
  network_reason_code: null,
  amount: 46.85,
  currency_code: "EUR",
  due_at: new Date().toISOString(),
  status: "lost",
  normalized_status: null,
  review_state: "approved",
  response_cycle: 2,
  closed_at: "2026-09-27T05:07:13Z",
  final_outcome: "lost",
};

function makeSupabase() {
  const from = vi.fn((table: string) => {
    if (table === "disputes") {
      const chain: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [DECIDED], error: null }),
      };
      return chain;
    }
    throw new Error(`decided dispute must not reach table: ${table}`);
  });
  vi.mocked(getServiceClient).mockReturnValue({ from, rpc: vi.fn() } as never);
  return { from };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env[CANONICAL_PIPELINE_ENV] = CANONICAL_PIPELINE_ON;
});
afterEach(() => {
  delete process.env[CANONICAL_PIPELINE_ENV];
});

describe("deadline submit — decided disputes", () => {
  it("skips a lost dispute without a pack lookup or admin alert", async () => {
    const { from } = makeSupabase();
    const res = await GET(new NextRequest("https://x.test/api/cron/defence-package-deadline-submit"));
    const body = await res.json();
    expect(body.scanned).toBe(0);
    expect(from).not.toHaveBeenCalledWith("evidence_packs");
    expect(sendDeadlineNoFileAdminAlert).not.toHaveBeenCalled();
  });
});

describe("isDecidedDispute", () => {
  it("is true once Shopify closed or decided it", () => {
    expect(isDecidedDispute({ closed_at: "2026-09-27T05:07:13Z", final_outcome: "lost" })).toBe(true);
    expect(isDecidedDispute({ closed_at: null, final_outcome: "won" })).toBe(true);
    expect(isDecidedDispute({ closed_at: "2026-09-27T05:07:13Z", final_outcome: null })).toBe(true);
  });
  it("is false while open, including a reopened dispute", () => {
    expect(isDecidedDispute({ closed_at: null, final_outcome: null })).toBe(false);
    expect(isDecidedDispute({ closed_at: null, final_outcome: "pending" })).toBe(false);
  });
});
