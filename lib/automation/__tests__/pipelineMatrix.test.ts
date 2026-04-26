/**
 * PRD §9 automation matrix audit + lock-in.
 *
 * Exercises every row of the documented matrix against the live
 * `evaluateAndMaybeAutoSave` orchestrator. Heavily mocked at the
 * dependency boundary (supabase, settings, rules, dispute events).
 *
 * Matrix under test:
 *
 *   pack.status === "failed"            → block (system error short-circuit)
 *   coverage.state === covered_shopify  → skip_covered                  (PRD §4)
 *   ruleMode === "review"               → park_for_review               (PRD §9)
 *   ruleMode === "auto" + strong + gate ok    → auto_save               (PRD §9)
 *   ruleMode === "auto" + moderate            → park_for_review         (PRD §9)
 *   ruleMode === "auto" + weak / insufficient → block                   (PRD §9)
 *   ruleMode === "auto" + strong + gate fails → block (existing gate)
 *
 * Older packs that predate the persisted `pack_json.case_strength`
 * field fall back to the gate-only behavior — covered separately.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/automation/settings", () => ({
  getShopSettings: vi.fn(),
}));
vi.mock("@/lib/rules/evaluateRules", () => ({
  evaluateRules: vi.fn(),
}));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({
  emitDisputeEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/disputeEvents/updateNormalizedStatus", () => ({
  updateNormalizedStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/sendNewDisputeAlert", () => ({
  claimAndSendDeferredNewDisputeReviewAlert: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { getShopSettings } from "@/lib/automation/settings";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { evaluateAndMaybeAutoSave } from "@/lib/automation/pipeline";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockGetShopSettings = vi.mocked(getShopSettings);
const mockEvaluateRules = vi.mocked(evaluateRules);

interface PackFixture {
  status?: string;
  completeness_score?: number;
  blockers?: string[];
  submission_readiness?: string | null;
  pack_json?: Record<string, unknown> | null;
}

interface DisputeFixture {
  reason?: string;
  status?: string;
  amount?: number;
  phase?: string | null;
}

function buildSb(pack: PackFixture, dispute: DisputeFixture) {
  const packRow = {
    id: "p1",
    shop_id: "s1",
    dispute_id: "d1",
    completeness_score: pack.completeness_score ?? 90,
    blockers: pack.blockers ?? [],
    submission_readiness: pack.submission_readiness ?? "ready",
    status: pack.status ?? "ready",
    pack_json: pack.pack_json ?? null,
  };
  const disputeRow = {
    reason: dispute.reason ?? "FRAUDULENT",
    status: dispute.status ?? "needs_response",
    amount: dispute.amount ?? 5000,
    phase: dispute.phase ?? "chargeback",
  };

  let evidencePacksReadCount = 0;

  return {
    from: vi.fn((table: string) => {
      if (table === "evidence_packs") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockImplementation(() => {
            evidencePacksReadCount++;
            return Promise.resolve({ data: packRow, error: null });
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === "disputes") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: disputeRow, error: null }),
        };
      }
      if (table === "audit_events") {
        return {
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === "jobs") {
        return {
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };
}

function setupMocks(opts: {
  pack?: PackFixture;
  dispute?: DisputeFixture;
  ruleMode?: "auto" | "review";
  settings?: Partial<Awaited<ReturnType<typeof getShopSettings>>>;
}) {
  const sb = buildSb(opts.pack ?? {}, opts.dispute ?? {});
  mockGetServiceClient.mockReturnValue(sb as never);
  mockEvaluateRules.mockResolvedValue({
    matchedRule: null,
    action: { mode: opts.ruleMode ?? "auto", pack_template_id: null },
    packTemplateId: null,
  });
  mockGetShopSettings.mockResolvedValue({
    auto_build_enabled: true,
    auto_save_enabled: true,
    auto_save_min_score: 80,
    enforce_no_blockers: true,
    require_review_before_save: false,
    ...(opts.settings ?? {}),
  } as never);
}

describe("evaluateAndMaybeAutoSave — PRD §9 matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("system failure short-circuit: pack.status === 'failed' → block", async () => {
    setupMocks({ pack: { status: "failed" } });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toContain("Pack build failed");
  });

  it("Coverage Gate: covered_shopify → skip_covered (PRD §4)", async () => {
    setupMocks({
      pack: {
        pack_json: {
          coverage: { state: "covered_shopify", shopifyProtectStatus: "PROTECTED" },
        },
      },
      ruleMode: "auto",
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("skip_covered");
    expect(r.details).toContain("Covered by Shopify Protect");
  });

  it("review mode: ALWAYS park, even with strong evidence (User control is absolute)", async () => {
    setupMocks({
      ruleMode: "review",
      pack: {
        pack_json: {
          case_strength: { overall: "strong", strongCount: 2, moderateCount: 0, supportingCount: 0 },
        },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("park_for_review");
  });

  it("auto + strong + gate ok → auto_save", async () => {
    setupMocks({
      ruleMode: "auto",
      pack: {
        completeness_score: 95,
        submission_readiness: "ready",
        pack_json: {
          case_strength: { overall: "strong", strongCount: 2, moderateCount: 0, supportingCount: 0 },
        },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("auto_save");
  });

  it("auto + moderate → park_for_review (PRD §9 strength gate)", async () => {
    setupMocks({
      ruleMode: "auto",
      pack: {
        completeness_score: 95, // gate would otherwise pass
        submission_readiness: "ready",
        pack_json: {
          case_strength: { overall: "moderate", strongCount: 1, moderateCount: 1, supportingCount: 0 },
        },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("park_for_review");
    expect(r.details).toContain("Moderate");
    expect(r.details).toContain("PRD §9");
  });

  it("auto + weak → block (PRD §9 strength gate)", async () => {
    setupMocks({
      ruleMode: "auto",
      pack: {
        completeness_score: 95,
        submission_readiness: "ready",
        pack_json: {
          case_strength: { overall: "weak", strongCount: 0, moderateCount: 0, supportingCount: 3 },
        },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toContain("Weak");
  });

  it("auto + insufficient → block (no decisive evidence at all)", async () => {
    setupMocks({
      ruleMode: "auto",
      pack: {
        completeness_score: 100,
        submission_readiness: "ready",
        pack_json: {
          case_strength: { overall: "insufficient", strongCount: 0, moderateCount: 0, supportingCount: 0 },
        },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toContain("Insufficient");
  });

  it("auto + strong + gate FAILS (low completeness) → block (existing quality gate)", async () => {
    setupMocks({
      ruleMode: "auto",
      pack: {
        completeness_score: 50,
        submission_readiness: "ready",
        pack_json: {
          case_strength: { overall: "strong", strongCount: 2, moderateCount: 0, supportingCount: 0 },
        },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toContain("below threshold");
  });

  it("auto + strong + gate FAILS (submission blocked) → block", async () => {
    setupMocks({
      ruleMode: "auto",
      pack: {
        completeness_score: 95,
        submission_readiness: "blocked",
        pack_json: {
          case_strength: { overall: "strong", strongCount: 2, moderateCount: 0, supportingCount: 0 },
        },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toContain("Submission is blocked");
  });

  it("auto + missing case_strength (legacy pack pre-P2) → falls through to existing gate", async () => {
    // No case_strength on pack_json. Existing gate decides — gate ok → auto_save.
    setupMocks({
      ruleMode: "auto",
      pack: {
        completeness_score: 95,
        submission_readiness: "ready",
        pack_json: { coverage: { state: "not_covered", shopifyProtectStatus: null } },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    // Legacy behavior preserved — old packs are not silently blocked.
    expect(r.action).toBe("auto_save");
  });

  it("Coverage Gate beats strength gate (covered overrides moderate)", async () => {
    setupMocks({
      ruleMode: "auto",
      pack: {
        pack_json: {
          coverage: { state: "covered_shopify", shopifyProtectStatus: "ACTIVE" },
          case_strength: { overall: "moderate", strongCount: 1, moderateCount: 1, supportingCount: 0 },
        },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("skip_covered");
  });

  it("Review mode beats strength gate (review with weak evidence still parks, doesn't block)", async () => {
    setupMocks({
      ruleMode: "review",
      pack: {
        pack_json: {
          case_strength: { overall: "weak", strongCount: 0, moderateCount: 0, supportingCount: 0 },
        },
      },
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("park_for_review");
  });
});
