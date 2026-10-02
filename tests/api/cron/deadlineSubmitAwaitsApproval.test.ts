/**
 * "Require my approval before saving" (or a Review rule) means the deadline
 * cron files NOTHING until the merchant approves. On 2026-10-01 dispute
 * 16ece0c5 (6a8848-dd, review mode, auto_save off) was auto-finalized and
 * filed with no approval: the old gate excluded `normalized_status =
 * needs_review`, but the parked dispute sat at `new`.
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
vi.mock("@/lib/automation/settings", () => ({ getShopSettings: vi.fn() }));
vi.mock("@/lib/rules/evaluateRules", () => ({ evaluateRules: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { sendDeadlineNoFileAdminAlert } from "@/lib/email/sendDeadlineNoFileAdminAlert";
import { getShopSettings } from "@/lib/automation/settings";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { GET } from "@/app/api/cron/defence-package-deadline-submit/route";
import { NextRequest } from "next/server";
import { CANONICAL_PIPELINE_ENV, CANONICAL_PIPELINE_ON } from "@/lib/pipeline/activation";
import { awaitsMerchantApproval } from "@/lib/automation/merchantApprovalGate";

function dispute(reviewState: string | null) {
  return {
    id: "16ece0c5",
    shop_id: "shop-1",
    dispute_gid: "gid://shopify/ShopifyPaymentsDispute/14564655438",
    order_name: "#101350",
    reason: "PRODUCT_UNACCEPTABLE",
    network_reason_code: null,
    amount: "37.9",
    currency_code: "EUR",
    due_at: new Date().toISOString(),
    status: "needs_response",
    phase: "chargeback",
    normalized_status: "new",
    review_state: reviewState,
    response_cycle: 1,
    closed_at: null,
    final_outcome: null,
  };
}

/** Only `disputes` may be read; reaching `evidence_packs` means the gate let
 *  the case through to the filing path. */
function makeSupabase(row: ReturnType<typeof dispute>) {
  const from = vi.fn((table: string) => {
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [row], error: null }),
      };
    }
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { shop_domain: "x" }, error: null }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  vi.mocked(getServiceClient).mockReturnValue({ from, rpc: vi.fn() } as never);
  return { from };
}

function setMode(autoSaveEnabled: boolean, ruleMode: "auto" | "review") {
  vi.mocked(getShopSettings).mockResolvedValue({ auto_save_enabled: autoSaveEnabled } as never);
  vi.mocked(evaluateRules).mockResolvedValue({
    action: { mode: ruleMode, pack_template_id: null },
    matchedRule: null,
  } as never);
}

const run = async () =>
  (await GET(new NextRequest("https://x.test/api/cron/defence-package-deadline-submit"))).json();

beforeEach(() => {
  vi.clearAllMocks();
  process.env[CANONICAL_PIPELINE_ENV] = CANONICAL_PIPELINE_ON;
});
afterEach(() => {
  delete process.env[CANONICAL_PIPELINE_ENV];
});

describe("deadline submit — merchant approval gate", () => {
  it("files nothing for an unapproved dispute on a 'Require my approval' store", async () => {
    const { from } = makeSupabase(dispute(null));
    setMode(false, "review");
    const body = await run();
    expect(body.awaitingApproval).toBe(1);
    expect(from).not.toHaveBeenCalledWith("evidence_packs");
    expect(sendDeadlineNoFileAdminAlert).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "deadline_submit_refused_awaiting_approval" }),
    );
  });

  it("files nothing when a Review rule matches, even with auto-save on", async () => {
    const { from } = makeSupabase(dispute(null));
    setMode(true, "review");
    const body = await run();
    expect(body.awaitingApproval).toBe(1);
    expect(from).not.toHaveBeenCalledWith("evidence_packs");
  });

  it("files nothing when the rules lookup fails (fails closed)", async () => {
    const { from } = makeSupabase(dispute(null));
    vi.mocked(getShopSettings).mockResolvedValue({ auto_save_enabled: true } as never);
    vi.mocked(evaluateRules).mockRejectedValue(new Error("db down"));
    const body = await run();
    expect(body.awaitingApproval).toBe(1);
    expect(from).not.toHaveBeenCalledWith("evidence_packs");
  });

  it("proceeds to the filing path once the merchant approved", async () => {
    const { from } = makeSupabase(dispute("approved"));
    setMode(false, "review");
    const body = await run();
    expect(body.awaitingApproval).toBe(0);
    expect(from).toHaveBeenCalledWith("evidence_packs");
  });

  it("proceeds to the filing path in auto mode", async () => {
    const { from } = makeSupabase(dispute(null));
    setMode(true, "auto");
    const body = await run();
    expect(body.awaitingApproval).toBe(0);
    expect(from).toHaveBeenCalledWith("evidence_packs");
  });
});

describe("awaitsMerchantApproval", () => {
  it("is false only for an approved dispute or a fully automatic store", () => {
    expect(awaitsMerchantApproval({ autoSaveEnabled: true, ruleMode: "auto", reviewState: null })).toBe(false);
    expect(awaitsMerchantApproval({ autoSaveEnabled: false, ruleMode: "review", reviewState: "approved" })).toBe(false);
    expect(awaitsMerchantApproval({ autoSaveEnabled: false, ruleMode: "auto", reviewState: null })).toBe(true);
    expect(awaitsMerchantApproval({ autoSaveEnabled: true, ruleMode: "review", reviewState: null })).toBe(true);
    expect(awaitsMerchantApproval({ autoSaveEnabled: false, ruleMode: "review", reviewState: "in_review" })).toBe(true);
  });
});
