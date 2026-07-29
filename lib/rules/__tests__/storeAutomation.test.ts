/**
 * Contract tests for the ONE read/write path of the store-wide automation
 * setting. These pin the invariants the whole redesign rests on:
 *
 *   - setup owns the two canonical rows plus at most one row per automation
 *     group, and NOTHING else;
 *   - deletes name exactly what they remove — never a `__dd_setup__:%` prefix,
 *     which would wipe the merchant's group overrides on every switch save;
 *   - merchant custom rules are NEVER touched;
 *   - the legacy `__dd_safeguard__:` name is self-healed away;
 *   - `shop_settings.auto_save_enabled` means "automation is enabled SOMEWHERE"
 *     (the switch or any group), not "the switch". Mirroring the switch alone
 *     is what would make Store=Review + Fraud=Auto render perfectly and do
 *     nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/automation/settings", () => ({
  updateShopSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/automation/reconcileParkedAutoDisputes", () => ({
  reconcileParkedAutoDisputes: vi.fn().mockResolvedValue({
    scanned: 0,
    reconciled: 0,
    disputeIds: [],
  }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { updateShopSettings } from "@/lib/automation/settings";
import { reconcileParkedAutoDisputes } from "@/lib/automation/reconcileParkedAutoDisputes";
import {
  readStoreAutomation,
  writeStoreAutomation,
  seedDefaultStoreAutomation,
  isSetupOwnedRuleName,
  FALLBACK_RULE_NAME,
  SAFEGUARD_RULE_NAME,
  LEGACY_SAFEGUARD_RULE_NAME,
  DEFAULT_SAFEGUARD_AMOUNT,
} from "../storeAutomation";
import {
  AUTOMATION_GROUPS,
  GROUP_RULE_PRIORITY,
  groupRuleName,
} from "../automationGroups";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockUpdateShopSettings = vi.mocked(updateShopSettings);
const mockReconcile = vi.mocked(reconcileParkedAutoDisputes);

interface Recorded {
  inserted: Array<Record<string, unknown>>;
  /**
   * `inNames` was added 2026-07-28 with the group work. The double previously
   * recorded only `like` / `eqName`, and routed `in()` into `selectNames` —
   * so it could not see what a DELETE targeted. Any test asserting "the delete
   * is scoped correctly" was therefore unfalsifiable against an `.in()` delete.
   */
  deletes: Array<{ like?: string; eqName?: string; inNames?: string[] }>;
}

/** Minimal supabase double covering the exact chains storeAutomation uses. */
function mockSb(existingRules: Array<Record<string, unknown>>, rec: Recorded) {
  function from(table: string) {
    if (table !== "rules") throw new Error(`unexpected table ${table}`);
    const pending: { like?: string; eqName?: string; inNames?: string[] } = {};
    let mode: "select" | "delete" | "insert" | null = null;
    let selectNames: string[] | null = null;
    let selectName: string | null = null;

    const chain: Record<string, unknown> = {
      select: () => {
        mode = "select";
        return chain;
      },
      delete: () => {
        mode = "delete";
        return chain;
      },
      insert: (rows: Array<Record<string, unknown>>) => {
        mode = "insert";
        rec.inserted.push(...rows);
        return Promise.resolve({ error: null });
      },
      eq: (col: string, val: string) => {
        if (col === "name") {
          if (mode === "delete") pending.eqName = val;
          else selectName = val;
        }
        return chain;
      },
      in: (_col: string, vals: string[]) => {
        if (mode === "delete") pending.inNames = vals;
        else selectNames = vals;
        return chain;
      },
      like: (_col: string, pattern: string) => {
        pending.like = pattern;
        return chain;
      },
      maybeSingle: async () => ({
        data: existingRules.find((r) => r.name === selectName) ?? null,
        error: null,
      }),
      then: (cb: (v: unknown) => unknown) => {
        if (mode === "delete") {
          rec.deletes.push({ ...pending });
          return cb({ error: null });
        }
        const rows = selectNames
          ? existingRules.filter((r) => selectNames!.includes(r.name as string))
          : existingRules;
        return cb({ data: rows, error: null });
      },
    };
    return chain;
  }
  return { from };
}

function fallbackRow(mode: string, enabled = true) {
  return {
    id: "r-fallback",
    name: FALLBACK_RULE_NAME,
    enabled,
    match: {},
    action: { mode },
    priority: 100000,
  };
}

function safeguardRow(name: string, min: number, enabled = true) {
  return {
    id: `r-${name}`,
    name,
    enabled,
    match: { amount_range: { min } },
    action: { mode: "review" },
    priority: 5,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateShopSettings.mockResolvedValue({} as never);
});

describe("readStoreAutomation", () => {
  it("reads the switch from the fallback rule and the amount from the safeguard", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 750)], rec) as never,
    );

    expect(await readStoreAutomation("shop-1")).toEqual({
      mode: "auto",
      safeguard: { enabled: true, amount: 750 },
      groups: {},
    });
  });

  it("a shop with no setup rows reads as review + safeguard off", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    expect(await readStoreAutomation("shop-1")).toEqual({
      mode: "review",
      safeguard: { enabled: false, amount: DEFAULT_SAFEGUARD_AMOUNT },
      groups: {},
    });
  });

  it("falls back to the legacy safeguard name when only that exists", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb(
        [fallbackRow("review"), safeguardRow(LEGACY_SAFEGUARD_RULE_NAME, 200)],
        rec,
      ) as never,
    );

    const cfg = await readStoreAutomation("shop-1");
    expect(cfg.safeguard).toEqual({ enabled: true, amount: 200 });
  });

  it("the canonical safeguard wins when both names are present", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb(
        [
          fallbackRow("auto"),
          safeguardRow(SAFEGUARD_RULE_NAME, 500),
          safeguardRow(LEGACY_SAFEGUARD_RULE_NAME, 200),
        ],
        rec,
      ) as never,
    );

    expect((await readStoreAutomation("shop-1")).safeguard.amount).toBe(500);
  });

  it("a disabled fallback rule reads as review (never silently auto)", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto", false)], rec) as never,
    );

    expect((await readStoreAutomation("shop-1")).mode).toBe("review");
  });

  it("a safeguard with a non-positive min reads as disabled", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 0)], rec) as never,
    );

    expect((await readStoreAutomation("shop-1")).safeguard.enabled).toBe(false);
  });
});

describe("writeStoreAutomation", () => {
  it("writes exactly two rows for auto + safeguard", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
      groups: {},
    });

    expect(rec.inserted).toHaveLength(2);
    const fallback = rec.inserted.find((r) => r.name === FALLBACK_RULE_NAME);
    const safeguard = rec.inserted.find((r) => r.name === SAFEGUARD_RULE_NAME);
    expect(fallback).toMatchObject({
      match: {},
      action: { mode: "auto", pack_template_id: null },
      priority: 100000,
    });
    expect(safeguard).toMatchObject({
      match: { amount_range: { min: 500 } },
      action: { mode: "review" },
      priority: 5,
    });
  });

  it("writes only the fallback when the safeguard is off", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 500 },
      groups: {},
    });

    expect(rec.inserted).toHaveLength(1);
    expect(rec.inserted[0].name).toBe(FALLBACK_RULE_NAME);
  });

  it("NEVER prefix-deletes — every delete names exactly what it removes", async () => {
    // THE BLOCKER. `.like("__dd_setup__:%")` would wipe the merchant's group
    // overrides on every switch or safeguard save, so the feature would appear
    // to work and then silently reset itself.
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
      groups: {},
    });

    for (const d of rec.deletes) {
      expect(d.like).toBeUndefined();
    }
  });

  it("the delete names the canonical rows, the legacy safeguard and every group", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
      groups: {},
    });

    const names = rec.deletes.flatMap((d) => d.inNames ?? []);
    expect(names).toContain(FALLBACK_RULE_NAME);
    expect(names).toContain(SAFEGUARD_RULE_NAME);
    expect(names).toContain(LEGACY_SAFEGUARD_RULE_NAME);
    // Locked groups included: a row from an older build or written by hand
    // must still be swept, or it routes disputes invisibly.
    for (const group of AUTOMATION_GROUPS) {
      expect(names).toContain(groupRuleName(group.id));
    }
    // Legacy pack:/coverage: rows are deliberately NOT swept here — converting
    // them changes live behaviour and belongs to a dedicated migration, not to
    // a side effect of an unrelated safeguard edit.
    expect(names.some((n) => n.includes(":pack:") || n.includes(":coverage:"))).toBe(
      false,
    );
  });

  it("NEVER deletes merchant custom rules", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
      groups: {},
    });

    // Every delete is scoped to an explicit setup-owned name list. An unscoped
    // delete (no name filter at all) would wipe custom rules.
    for (const d of rec.deletes) {
      expect(d.inNames ?? d.eqName).toBeDefined();
      for (const name of d.inNames ?? []) {
        expect(isSetupOwnedRuleName(name)).toBe(true);
      }
    }
  });

  it("mirrors auto_save_enabled = true when the switch is auto", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: false, amount: 0 },
      groups: {},
    });

    expect(mockUpdateShopSettings).toHaveBeenCalledWith("shop-1", {
      auto_save_enabled: true,
    });
  });

  it("mirrors auto_save_enabled = false when the switch is review", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: {},
    });

    expect(mockUpdateShopSettings).toHaveBeenCalledWith("shop-1", {
      auto_save_enabled: false,
    });
  });

  it("a non-positive amount disables the safeguard rather than writing a junk rule", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 0 },
      groups: {},
    });

    expect(rec.inserted).toHaveLength(1);
    expect(rec.inserted[0].name).toBe(FALLBACK_RULE_NAME);
  });

  it("fires reconcile when flipping review → auto", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([fallbackRow("review")], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: false, amount: 0 },
      groups: {},
    });

    expect(mockReconcile).toHaveBeenCalledWith("shop-1");
  });

  it("does NOT fire reconcile when staying on review", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([fallbackRow("review")], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: {},
    });

    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("fires reconcile when the safeguard is relaxed while already on auto", async () => {
    // Cases parked only because they exceeded the old threshold may now be
    // eligible — raising the bar must unstick them.
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 200)], rec) as never,
    );

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 900 },
      groups: {},
    });

    expect(mockReconcile).toHaveBeenCalledWith("shop-1");
  });

  it("fires reconcile when the safeguard is turned off while already on auto", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 200)], rec) as never,
    );

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: false, amount: 0 },
      groups: {},
    });

    expect(mockReconcile).toHaveBeenCalledWith("shop-1");
  });

  it("does NOT fire reconcile when the safeguard is TIGHTENED on auto", async () => {
    // A lower threshold can only park more cases, never free any.
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 900)], rec) as never,
    );

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 200 },
      groups: {},
    });

    expect(mockReconcile).not.toHaveBeenCalled();
  });
});

describe("writeStoreAutomation — group overrides", () => {
  it("a switch write PRESERVES the group rows it was asked to keep", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "auto" },
    });

    const fraud = rec.inserted.find((r) => r.name === groupRuleName("fraud"));
    expect(fraud).toBeDefined();
    expect(fraud!.match).toEqual({ reason: ["FRAUDULENT", "UNRECOGNIZED"] });
    expect(fraud!.priority).toBe(GROUP_RULE_PRIORITY);
    expect(fraud!.action).toMatchObject({ mode: "auto" });
  });

  it("a group left unset writes no row at all (absence == inherit)", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: false, amount: 0 },
      groups: { pnr: "review" },
    });

    expect(rec.inserted.find((r) => r.name === groupRuleName("pnr"))).toBeDefined();
    expect(rec.inserted.find((r) => r.name === groupRuleName("fraud"))).toBeUndefined();
  });

  it("a redundant pin (group == switch) IS stored, so it survives a later flip", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "auto" },
    });

    expect(rec.inserted.find((r) => r.name === groupRuleName("fraud"))).toBeDefined();
  });

  it("NEVER writes a row for a locked group", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      // The route rejects this, but the writer must not depend on the route.
      groups: { not_as_described: "auto" },
    });

    expect(
      rec.inserted.find((r) => r.name === groupRuleName("not_as_described")),
    ).toBeUndefined();
  });

  it("auto_save_enabled is TRUE when only a group is auto and the store is review", async () => {
    // The single most important assertion in this file: mirroring the switch
    // alone would leave the override inert — the rule resolves to `auto`, the
    // gate says "Auto-save is disabled for this store", nothing saves.
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "auto" },
    });

    expect(mockUpdateShopSettings).toHaveBeenCalledWith("shop-1", {
      auto_save_enabled: true,
    });
  });

  it("auto_save_enabled goes FALSE when the last auto group is removed on a review store", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "review" },
    });

    expect(mockUpdateShopSettings).toHaveBeenCalledWith("shop-1", {
      auto_save_enabled: false,
    });
  });

  it("fires reconcile when a group flips to auto, even though the store stays on review", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([fallbackRow("review")], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "auto" },
    });

    expect(mockReconcile).toHaveBeenCalledWith("shop-1");
  });

  it("does NOT fire reconcile when a group is only tightened to review", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([fallbackRow("review")], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
      groups: { fraud: "review" },
    });

    expect(mockReconcile).not.toHaveBeenCalled();
  });
});

describe("readStoreAutomation — group overrides", () => {
  function groupRow(id: string, mode: string, enabled = true) {
    const group = AUTOMATION_GROUPS.find((g) => g.id === id)!;
    return {
      id: `r-group-${id}`,
      name: groupRuleName(group.id),
      enabled,
      match: { reason: group.reasons },
      action: { mode },
      priority: GROUP_RULE_PRIORITY,
    };
  }

  it("derives overrides from the stored rows", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("review"), groupRow("fraud", "auto")], rec) as never,
    );

    expect((await readStoreAutomation("shop-1")).groups).toEqual({ fraud: "auto" });
  });

  it("a shop with no group rows reads as no overrides", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([fallbackRow("auto")], rec) as never);

    expect((await readStoreAutomation("shop-1")).groups).toEqual({});
  });

  it("skips a disabled group row", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("review"), groupRow("pnr", "auto", false)], rec) as never,
    );

    expect((await readStoreAutomation("shop-1")).groups).toEqual({});
  });

  it("never surfaces a locked group's row, even if one exists", async () => {
    // A read that reports an override the engine ignores is how a UI ends up
    // lying to the merchant.
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb(
        [fallbackRow("review"), groupRow("not_as_described", "auto")],
        rec,
      ) as never,
    );

    expect((await readStoreAutomation("shop-1")).groups).toEqual({});
  });
});

describe("seedDefaultStoreAutomation", () => {
  it("seeds auto-pilot + $500 safeguard for a brand-new shop", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await seedDefaultStoreAutomation("shop-1");

    expect(rec.inserted).toHaveLength(2);
    expect(
      rec.inserted.find((r) => r.name === FALLBACK_RULE_NAME)?.action,
    ).toMatchObject({ mode: "auto" });
    expect(
      rec.inserted.find((r) => r.name === SAFEGUARD_RULE_NAME)?.match,
    ).toEqual({ amount_range: { min: DEFAULT_SAFEGUARD_AMOUNT } });
    expect(mockUpdateShopSettings).toHaveBeenCalledWith("shop-1", {
      auto_save_enabled: true,
    });
  });

  it("is idempotent — never resets a shop that already chose review", async () => {
    const rec: Recorded = { inserted: [], deletes: [] };
    mockGetServiceClient.mockReturnValue(mockSb([fallbackRow("review")], rec) as never);

    await seedDefaultStoreAutomation("shop-1");

    expect(rec.inserted).toHaveLength(0);
    expect(mockUpdateShopSettings).not.toHaveBeenCalled();
  });
});
