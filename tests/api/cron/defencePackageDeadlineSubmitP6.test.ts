/**
 * P-6 at the ACTUAL submitter (CP-C, risk R3).
 *
 * Before this change the deadline cron consulted no strength, no completeness,
 * no coverage and no guards: it filed every non-conceded case with a valid PDF
 * inside the due window. Every gate the rest of the product enforced was
 * therefore advisory — whatever the pipeline blocked in the morning, this route
 * filed at the deadline.
 *
 * Each case below is a gate that USED TO BE IGNORED HERE. A deadline relaxes
 * none of them.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/sendDefenceDeadlineFallbackAlert", () => ({
  sendDefenceDeadlineFallbackAlert: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/featureFlags", () => ({ isDefencePackageBuilderEnabled: () => true }));
vi.mock("@/lib/cron/envGate", () => ({ cronEnvGate: () => null }));
vi.mock("@/lib/automation/settings", () => ({
  getShopSettings: vi.fn().mockResolvedValue({
    auto_build_enabled: true,
    auto_save_enabled: true,
    auto_save_min_score: 60,
    enforce_no_blockers: true,
  }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { sendDefenceDeadlineFallbackAlert } from "@/lib/email/sendDefenceDeadlineFallbackAlert";
import { GET } from "@/app/api/cron/defence-package-deadline-submit/route";
import { NextRequest } from "next/server";
import {
  CLEAN_FACTS,
  CLEAN_NARRATIVE,
} from "@/tests/fixtures/defencePackageShapes";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockAudit = vi.mocked(logAuditEvent);
const mockEmail = vi.mocked(sendDefenceDeadlineFallbackAlert);

const SHOP_ID = "shop-1";
const DISPUTE_ID = "dispute-1";

const SAFE_FINAL = {
  id: "pkg-4",
  version: 4,
  status: "final",
  validation_status: "ok",
  pdf_path: "p.pdf",
  failure_code: null,
  content_revision: "11111111-1111-4111-8111-111111111111",
  facts_json: CLEAN_FACTS,
  narrative_json: CLEAN_NARRATIVE,
};

const HEALTHY_PACK_JSON = {
  case_strength: { overall: "strong" },
  coverage: { state: "not_covered" },
  fatal_loss: { triggered: false },
};

function setup(opts: {
  packJson?: Record<string, unknown>;
  completenessScore?: number;
  readiness?: string;
  dueAt?: string;
}) {
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const rpc = vi.fn(async () => ({
    data: { outcome: "enqueued", job_id: "job-1" },
    error: null,
  }));

  const dispute = {
    id: DISPUTE_ID,
    shop_id: SHOP_ID,
    dispute_gid: "gid://shopify/ShopifyPaymentsDispute/1",
    reason: "fraudulent",
    amount: 100,
    currency_code: "USD",
    due_at: opts.dueAt ?? new Date().toISOString(),
    status: "needs_response",
    normalized_status: "in_progress",
    review_state: null,
  };

  const from = vi.fn((table: string) => {
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [dispute], error: null }),
      };
    }
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "pack-1",
            status: "ready",
            completeness_score: opts.completenessScore ?? 90,
            blockers: [],
            submission_readiness: opts.readiness ?? "ready",
            pack_json: opts.packJson ?? HEALTHY_PACK_JSON,
          },
          error: null,
        }),
      };
    }
    if (table === "defence_packages") {
      const q: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: SAFE_FINAL, error: null }),
      };
      return q;
    }
    if (table === "jobs") return { insert: jobsInsert };
    throw new Error(`unexpected table: ${table}`);
  });

  mockGetServiceClient.mockReturnValue({ from, rpc } as never);
  return { rpc, jobsInsert };
}

const req = () => new NextRequest("https://x.test/api/cron/defence-package-deadline-submit");

beforeEach(() => vi.clearAllMocks());

describe("deadline submit — a deadline relaxes NOTHING (P-6)", () => {
  it("baseline: a strong, complete, safe case IS filed", async () => {
    const { rpc } = setup({});
    const body = await (await GET(req())).json();
    expect(rpc).toHaveBeenCalled();
    expect(body.enqueuedSubmit).toBe(1);
    expect(body.blockedByDecision).toBe(0);
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it("COVERAGE — a Shopify-Protect case is not filed at the deadline", async () => {
    const { rpc } = setup({
      packJson: { ...HEALTHY_PACK_JSON, coverage: { state: "covered_shopify" } },
    });
    const body = await (await GET(req())).json();
    expect(rpc).not.toHaveBeenCalled();
    expect(body.enqueuedSubmit).toBe(0);
    expect(body.blockedByDecision).toBe(1);
    expect(mockEmail).toHaveBeenCalled();
  });

  it("FATAL LOSS — a structurally unwinnable case is not filed at the deadline", async () => {
    const { rpc } = setup({
      packJson: {
        ...HEALTHY_PACK_JSON,
        fatal_loss: { triggered: true, reason: "refund_issued" },
      },
    });
    const body = await (await GET(req())).json();
    expect(rpc).not.toHaveBeenCalled();
    expect(body.enqueuedSubmit).toBe(0);
    expect(body.blockedByDecision).toBe(1);
  });

  it("HARD BLOCK — a blocked readiness is not relaxed by the deadline", async () => {
    const { rpc } = setup({ readiness: "blocked" });
    const body = await (await GET(req())).json();
    expect(rpc).not.toHaveBeenCalled();
    expect(body.enqueuedSubmit).toBe(0);
    expect(body.blockedByDecision).toBe(1);
  });

  it("STRENGTH — a weak case is not filed at the deadline", async () => {
    const { rpc } = setup({
      packJson: { ...HEALTHY_PACK_JSON, case_strength: { overall: "weak" } },
    });
    const body = await (await GET(req())).json();
    expect(rpc).not.toHaveBeenCalled();
    expect(body.enqueuedSubmit).toBe(0);
    expect(body.blockedByDecision).toBe(1);
  });

  it("COMPLETENESS below threshold is NOT a hard block — the deadline still files", async () => {
    // The honest asymmetry: a thin case still gets a response rather than a
    // forfeit. Only a BLOCK stops the deadline.
    const { rpc } = setup({
      completenessScore: 20,
      packJson: { ...HEALTHY_PACK_JSON, case_strength: { overall: "moderate" } },
    });
    const body = await (await GET(req())).json();
    expect(rpc).toHaveBeenCalled();
    expect(body.enqueuedSubmit).toBe(1);
  });

  it("MODERATE strength is held, not blocked — the deadline files it", async () => {
    const { rpc } = setup({
      packJson: { ...HEALTHY_PACK_JSON, case_strength: { overall: "moderate" } },
    });
    const body = await (await GET(req())).json();
    expect(rpc).toHaveBeenCalled();
    expect(body.enqueuedSubmit).toBe(1);
  });

  it("names the failing P-6 conditions in the audit row", async () => {
    setup({ packJson: { ...HEALTHY_PACK_JSON, case_strength: { overall: "weak" } } });
    await GET(req());
    const call = mockAudit.mock.calls.find(
      (c) => (c[0] as { eventPayload?: Record<string, unknown> }).eventPayload?.deadlineConditions,
    );
    expect(call).toBeDefined();
    const payload = (call![0] as { eventPayload: Record<string, unknown> }).eventPayload;
    expect(payload.deadlineConditions).toMatchObject({ noHardBlock: false });
    expect(payload.decisionAction).toBe("block");
    expect(payload.decisionReasonCodes).toEqual(["strength_insufficient"]);
    expect(payload.deadlineWindow).toBe("in_window");
    // The decision's hash travels with the refusal so a replay can prove which
    // inputs produced it.
    expect(typeof payload.decisionInputHash).toBe("string");
  });
});
