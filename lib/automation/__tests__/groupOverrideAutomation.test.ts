/**
 * Per-group overrides, proven END-TO-END against `evaluateAndMaybeAutoSave`.
 *
 * Why this file exists rather than more `pickAutomationAction` cases: rule
 * selection was never the risk. The risk was that a group override would
 * resolve to `auto` correctly and then be swallowed by
 * `evaluateAutoSaveGate`, which reads the shop-level `auto_save_enabled`
 * kill-switch. Mirroring that flag 1:1 off the store switch — as the code did
 * until 2026-07-28 — means Store=Review + Fraud=Auto produces:
 *
 *     tier-1 group rule → "auto" → gate → BLOCKED,
 *     "Auto-save is disabled for this store."
 *
 * The feature would render perfectly and do nothing. A test that stopped at
 * `pickAutomationAction` would have been green throughout.
 *
 * So the chain here is real at both ends:
 *
 *   writeStoreAutomation(config)  →  the rule rows it actually inserts
 *                                 →  pickAutomationAction (real)
 *                                 →  evaluateAndMaybeAutoSave (real)
 *   writeStoreAutomation(config)  →  the auto_save_enabled it actually mirrors
 *                                 →  the gate inside that same run
 *
 * Only the DB and the notification side-effects are doubled.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/automation/settings", () => ({
  getShopSettings: vi.fn(),
  updateShopSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/automation/reconcileParkedAutoDisputes", () => ({
  reconcileParkedAutoDisputes: vi.fn().mockResolvedValue({
    scanned: 0,
    reconciled: 0,
    disputeIds: [],
  }),
}));
vi.mock("@/lib/rules/evaluateRules", () => ({ evaluateRules: vi.fn() }));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({
  emitDisputeEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/disputeEvents/updateNormalizedStatus", () => ({
  updateNormalizedStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/sendNewDisputeAlert", () => ({
  claimAndSendDeferredNewDisputeAlert: vi.fn().mockResolvedValue(undefined),
  claimAndSendDeferredNewDisputeReviewAlert: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { getShopSettings, updateShopSettings } from "@/lib/automation/settings";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { evaluateAndMaybeAutoSave } from "@/lib/automation/pipeline";
import {
  writeStoreAutomation,
  type StoreAutomationConfig,
} from "@/lib/rules/storeAutomation";
import { pickAutomationAction } from "@/lib/rules/pickAutomationAction";
import type { Rule } from "@/lib/rules/types";
import {
  CLEAN_FACTS,
  narrativeJson,
} from "@/tests/fixtures/defencePackageShapes";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockGetShopSettings = vi.mocked(getShopSettings);
const mockUpdateShopSettings = vi.mocked(updateShopSettings);
const mockEvaluateRules = vi.mocked(evaluateRules);

interface DisputeFixture {
  reason: string;
  amount?: number;
}

/**
 * Run a config through the REAL writer, capturing the rows it inserts and the
 * `auto_save_enabled` it mirrors. Nothing about the expected outcome is
 * hardcoded — if the writer changes its mind, this test changes with it.
 */
async function applyConfig(config: StoreAutomationConfig): Promise<{
  rules: Rule[];
  autoSaveEnabled: boolean;
}> {
  const inserted: Array<Record<string, unknown>> = [];
  const chain: Record<string, unknown> = {
    select: () => chain,
    delete: () => chain,
    eq: () => chain,
    in: () => chain,
    like: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: (rows: Array<Record<string, unknown>>) => {
      inserted.push(...rows);
      return Promise.resolve({ error: null });
    },
    then: (cb: (v: unknown) => unknown) => cb({ data: [], error: null }),
  };
  mockGetServiceClient.mockReturnValue({ from: () => chain } as never);
  mockUpdateShopSettings.mockResolvedValue({} as never);

  await writeStoreAutomation("shop-1", config);

  const call = mockUpdateShopSettings.mock.calls.at(-1);
  const autoSaveEnabled = Boolean(
    (call?.[1] as { auto_save_enabled?: boolean } | undefined)?.auto_save_enabled,
  );

  const rules = inserted.map((row, i) => ({
    id: `rule-${i}`,
    shop_id: "shop-1",
    enabled: true,
    match: row.match,
    action: row.action,
    priority: row.priority,
    name: row.name,
    created_at: "",
    updated_at: "",
  })) as Rule[];

  return { rules, autoSaveEnabled };
}

/** Wire the captured rows + flag into a real pipeline run for one dispute. */
function runPipeline(
  applied: { rules: Rule[]; autoSaveEnabled: boolean },
  dispute: DisputeFixture,
  opts: { caseStrength?: string } = {},
) {
  const packRow = {
    id: "p1",
    shop_id: "shop-1",
    dispute_id: "d1",
    completeness_score: 95,
    blockers: [],
    submission_readiness: "ready",
    status: "ready",
    pack_json: {
      case_strength: {
        overall: opts.caseStrength ?? "strong",
        strongCount: 2,
        moderateCount: 0,
        supportingCount: 0,
      },
      disputeReason: dispute.reason,
    },
  };
  const disputeRow = {
    reason: dispute.reason,
    status: "needs_response",
    amount: dispute.amount ?? 100,
    phase: "chargeback",
  };

  mockGetServiceClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "evidence_packs") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: packRow, error: null }),
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
      // PR-C1: a *missing* defence package is now UNRESOLVED, not safe, and
      // defers the auto-save. These tests are about the gate matrix, not the
      // containment, so they supply a safe current candidate.
      if (table === "defence_packages") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "pkg-safe",
              version: 1,
              status: "final",
              facts_json: CLEAN_FACTS,
              narrative_json: narrativeJson({ executiveSummary: "The carrier confirmed delivery on 12 May 2026." }),
            },
            error: null,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  } as never);

  // The REAL tier engine, over the rows the REAL writer produced. Only the DB
  // fetch is stubbed out.
  mockEvaluateRules.mockImplementation(async () =>
    pickAutomationAction(applied.rules, {
      id: "d1",
      shop_id: "shop-1",
      reason: disputeRow.reason,
      status: disputeRow.status,
      amount: disputeRow.amount,
      phase: disputeRow.phase,
    } as never),
  );

  mockGetShopSettings.mockResolvedValue({
    auto_build_enabled: true,
    auto_save_enabled: applied.autoSaveEnabled,
    auto_save_min_score: 80,
    enforce_no_blockers: true,
    require_review_before_save: false,
  } as never);

  return evaluateAndMaybeAutoSave("p1");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("group overrides — end to end", () => {
  it("Store=Review + Fraud=Auto: a strong FRAUD dispute AUTO-SAVES", async () => {
    // The whole feature in one assertion. Against the old `mode === "auto"`
    // mirror this returns `block` / "Auto-save is disabled for this store".
    const applied = await applyConfig({
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "auto" },
    });
    expect(applied.autoSaveEnabled).toBe(true);

    const result = await runPipeline(applied, { reason: "FRAUDULENT" });
    expect(result.action).toBe("auto_save");
  });

  it("Store=Review + Fraud=Auto: UNRECOGNIZED rides with fraud", async () => {
    // It is scored with the fraud formula and absent from the custom-rule
    // reason list, so leaving it out of the group would strand it silently.
    const applied = await applyConfig({
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "auto" },
    });

    const result = await runPipeline(applied, { reason: "UNRECOGNIZED" });
    expect(result.action).toBe("auto_save");
  });

  it("Store=Review + Fraud=Auto: a strong PNR dispute still PARKS (no leak)", async () => {
    const applied = await applyConfig({
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "auto" },
    });

    const result = await runPipeline(applied, { reason: "PRODUCT_NOT_RECEIVED" });
    expect(result.action).toBe("park_for_review");
  });

  it("Store=Auto + Fraud=Review: a strong FRAUD dispute PARKS (restrictive override works)", async () => {
    const applied = await applyConfig({
      mode: "auto",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "review" },
    });

    const result = await runPipeline(applied, { reason: "FRAUDULENT" });
    expect(result.action).toBe("park_for_review");
  });

  it("the amount safeguard still beats an auto group (tier-0 over tier-1)", async () => {
    const applied = await applyConfig({
      mode: "review",
      safeguard: { enabled: true, amount: 500 },
      groups: { fraud: "auto" },
    });

    const result = await runPipeline(applied, { reason: "FRAUDULENT", amount: 900 });
    expect(result.action).toBe("park_for_review");
  });

  it("removing the last auto group turns the kill-switch back off", async () => {
    const applied = await applyConfig({
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: {},
    });
    expect(applied.autoSaveEnabled).toBe(false);

    const result = await runPipeline(applied, { reason: "FRAUDULENT" });
    expect(result.action).toBe("park_for_review");
  });

  it("proves the gate is genuinely on this path", async () => {
    // Guards the guard. If a future refactor stops routing group-resolved
    // disputes through `evaluateAutoSaveGate`, every assertion above would
    // keep passing for the wrong reason — they'd be re-proving rule selection,
    // which was never in doubt. Here the ONLY change is the kill-switch, and
    // the block must come back with the store-level message.
    const applied = await applyConfig({
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "auto" },
    });

    const result = await runPipeline(
      { rules: applied.rules, autoSaveEnabled: false },
      { reason: "FRAUDULENT" },
    );
    expect(result.action).toBe("block");
    expect(result.details).toContain("Auto-save is disabled for this store");
  });

  it("a group override cannot rescue a WEAK case — engine guards still rule", async () => {
    const applied = await applyConfig({
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "auto" },
    });

    const result = await runPipeline(
      applied,
      { reason: "FRAUDULENT" },
      { caseStrength: "weak" },
    );
    expect(result.action).toBe("block");
  });
});
