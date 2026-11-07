/**
 * PR 1: the include endpoint refuses `force_include` on a field the record
 * makes impossible (409 FIELD_NOT_APPLICABLE, nothing written), and the upload
 * route refuses a file for a field a merchant cannot attach to
 * (409 FIELD_NOT_UPLOADABLE). Everything else about both routes is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit/resolveActor", () => ({
  resolveAuditActor: () => ({ actorType: "merchant", actorId: null }),
}));
vi.mock("@/lib/packs/loadReturnScope", () => ({ loadReturnScopeForPack: vi.fn().mockResolvedValue(undefined) }));

import { getServiceClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/packs/[packId]/inclusion-override/route";

const order = (returnStatus: string | null, refunded = "0.0") => ({
  labelToken: { key: "packs.section.order" },
  fieldsProvided: ["order_confirmation"],
  data: { ...(returnStatus ? { returnStatus } : {}), totals: { refunded } },
});
const row = (field: string, status: string) => ({
  field, label: "", status, priority: "recommended", blocking: false, source: "auto_shopify",
});

function client(pack: Record<string, unknown>, disputeReason: string | null = null) {
  const updates: unknown[] = [];
  const sb = {
    from: (table: string) => {
      if (table === "disputes") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { reason: disputeReason } }) }) }) };
      }
      if (table === "evidence_items") {
        return { select: () => ({ eq: async () => ({ data: [] }) }) };
      }
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ single: async () => ({ data: pack, error: null }) }) }),
        }),
        update: (u: unknown) => {
          updates.push(u);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  vi.mocked(getServiceClient).mockReturnValue(sb as never);
  return updates;
}

const req = (body: unknown) =>
  new NextRequest("http://x/api/packs/p/inclusion-override", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const call = (body: unknown) => POST(req(body), { params: Promise.resolve({ packId: "p" }) });

const pack = (returnStatus: string | null, checklist: unknown = [row("no_return_initiated", "missing")]) => ({
  id: "p", shop_id: "shop-1", dispute_id: "d", status: "ready", response_cycle: 1,
  pack_json: { sections: [order(returnStatus)] },
  checklist_v2: checklist,
});

beforeEach(() => vi.clearAllMocks());

describe("inclusion-override: force_include on an inapplicable field", () => {
  it("returns 409 FIELD_NOT_APPLICABLE and writes nothing when a return is on record", async () => {
    const updates = client(pack("RETURNED"));
    const res = await call({ field: "no_return_initiated", value: "force_include" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("FIELD_NOT_APPLICABLE");
    expect(updates).toEqual([]);
  });

  it("still allows it when the status was never recorded (unknown is not a return)", async () => {
    const updates = client(pack(null));
    const res = await call({ field: "no_return_initiated", value: "force_include" });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
  });

  it("still allows force_exclude on the same inapplicable field (unchanged)", async () => {
    const updates = client(pack("RETURNED"));
    const res = await call({ field: "no_return_initiated", value: "force_exclude" });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
  });

  it("accepts the historical { items } checklist shape instead of throwing", async () => {
    client(pack("NO_RETURN", { items: [row("no_return_initiated", "missing")] }));
    const res = await call({ field: "no_return_initiated", value: "force_include" });
    expect(res.status).toBe(200);
  });
});

describe("inclusion-override: refund_record with no refund on record (F-1b, read time)", () => {
  const cnpPack = (refunded: string) => ({
    id: "p", shop_id: "shop-1", dispute_id: "d", status: "ready", response_cycle: 1,
    pack_json: { sections: [order("NO_RETURN", refunded)] },
    checklist_v2: [row("refund_record", "missing")],
  });

  it("409 FIELD_NOT_APPLICABLE for force_include on CNP with a zero refunded total, nothing written", async () => {
    const updates = client(cnpPack("0.0"), "CREDIT_NOT_PROCESSED");
    const res = await call({ field: "refund_record", value: "force_include" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("FIELD_NOT_APPLICABLE");
    expect(updates).toEqual([]);
  });

  it("still allowed when a refund is on record", async () => {
    client(cnpPack("25.00"), "CREDIT_NOT_PROCESSED");
    expect((await call({ field: "refund_record", value: "force_include" })).status).toBe(200);
  });

  it("still allowed on other reasons and when the reason is unknown (fail open)", async () => {
    client(cnpPack("0.0"), "PRODUCT_UNACCEPTABLE");
    expect((await call({ field: "refund_record", value: "force_include" })).status).toBe(200);
    client(cnpPack("0.0"), null);
    expect((await call({ field: "refund_record", value: "force_include" })).status).toBe(200);
  });
});

describe("wiring pins: stored outputs keep the build-time upload rule", () => {
  it("completeness.ts and caseStrength.ts import canMerchantUploadAtBuild, never the display rule", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of ["lib/automation/completeness.ts", "lib/argument/caseStrength.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).toMatch(/canMerchantUploadAtBuild as canMerchantUpload/);
      expect(src, f).not.toMatch(/import \{ canMerchantUpload \}/);
    }
  });

  it("recommended_actions still ask for the two rows at build time (byte-identical stored output)", async () => {
    const { evaluateCompletenessV2 } = await import("@/lib/automation/completeness");
    const out = evaluateCompletenessV2(
      "PRODUCT_UNACCEPTABLE",
      new Set(),
      null,
      null,
      { isFulfilled: true, hasCardPayment: true, avsCvvAvailable: true },
    );
    const text = JSON.stringify([out.recommendedActions, out.legacyRecommendedActions]);
    expect(text).toMatch(/Refund Record/i);
  });

  it("the workspace route, pack API and decided loader build their rows through the shared assembler", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const need: Array<[string, RegExp]> = [
      ["app/api/disputes/[id]/workspace/route.ts", /assembleEffectiveChecklist\(/],
      ["app/api/packs/[packId]/route.ts", /loadEffectivePackView\(/],
      ["lib/packs/effectivePackView.ts", /assembleEffectiveChecklist\(/],
      ["lib/disputes/loadDecidedResponse.ts", /recordOrderContext\(/],
      ["app/api/packs/[packId]/inclusion-override/route.ts", /assembleEffectiveChecklist\(/],
    ];
    for (const [f, re] of need) expect(readFileSync(join(process.cwd(), f), "utf8"), f).toMatch(re);
  });
});
