/**
 * Contract tests for the ONE read/write path of the store-wide automation
 * setting. These pin the invariants the whole redesign rests on:
 *
 *   - setup owns exactly TWO rows, never more;
 *   - merchant custom rules are NEVER touched;
 *   - the legacy `__dd_safeguard__:` name is self-healed away;
 *   - `shop_settings.auto_save_enabled` is a strict 1:1 mirror of the switch
 *     (the bug class that made wizard-configured auto-pilot silently inert).
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
  FALLBACK_RULE_NAME,
  SAFEGUARD_RULE_NAME,
  LEGACY_SAFEGUARD_RULE_NAME,
  DEFAULT_SAFEGUARD_AMOUNT,
} from "../storeAutomation";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockUpdateShopSettings = vi.mocked(updateShopSettings);
const mockReconcile = vi.mocked(reconcileParkedAutoDisputes);

interface Recorded {
  inserted: Array<Record<string, unknown>>;
  deletes: Array<{ like?: string; eqName?: string }>;
  /** Args passed to the atomic write_store_automation RPC. */
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
}

/** Minimal supabase double covering the exact chains storeAutomation uses. */
function mockSb(existingRules: Array<Record<string, unknown>>, rec: Recorded) {
  function from(table: string) {
    if (table !== "rules") throw new Error(`unexpected table ${table}`);
    const pending: { like?: string; eqName?: string } = {};
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
        selectNames = vals;
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
  return {
    from,
    // The swap is one atomic RPC (migration 20260728120100) — the three
    // separate round-trips it replaced could leave a shop with no rules at
    // all if the process died between them.
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rec.rpcCalls.push({ fn, args });
      if (fn === "write_store_automation") {
        rec.deletes.push({ like: "__dd_setup__:%" });
        rec.deletes.push({ eqName: LEGACY_SAFEGUARD_RULE_NAME });
        rec.inserted.push({
          name: FALLBACK_RULE_NAME,
          match: {},
          action: { mode: args.p_mode, pack_template_id: null },
          priority: 100000,
        });
        if (args.p_safeguard_enabled && (args.p_safeguard_amount as number) > 0) {
          rec.inserted.push({
            name: SAFEGUARD_RULE_NAME,
            match: { amount_range: { min: args.p_safeguard_amount } },
            action: { mode: "review" },
            priority: 5,
          });
        }
      }
      return { data: null, error: null };
    },
  };
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
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 750)], rec) as never,
    );

    expect(await readStoreAutomation("shop-1")).toEqual({
      mode: "auto",
      safeguard: { enabled: true, amount: 750 },
    });
  });

  it("a shop with no setup rows reads as review + safeguard off", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    expect(await readStoreAutomation("shop-1")).toEqual({
      mode: "review",
      safeguard: { enabled: false, amount: DEFAULT_SAFEGUARD_AMOUNT },
    });
  });

  it("falls back to the legacy safeguard name when only that exists", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
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
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
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
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto", false)], rec) as never,
    );

    expect((await readStoreAutomation("shop-1")).mode).toBe("review");
  });

  it("a safeguard with a non-positive min reads as disabled", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 0)], rec) as never,
    );

    expect((await readStoreAutomation("shop-1")).safeguard.enabled).toBe(false);
  });
});

describe("writeStoreAutomation", () => {
  it("writes exactly two rows for auto + safeguard", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
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
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 500 },
    });

    expect(rec.inserted).toHaveLength(1);
    expect(rec.inserted[0].name).toBe(FALLBACK_RULE_NAME);
  });

  it("clears the whole __dd_setup__ prefix AND the legacy safeguard name", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
    });

    // Prefix delete self-heals leftover pack:/coverage: rows from the
    // per-dispute-type era on any shop that missed the migration.
    expect(rec.deletes.some((d) => d.like === "__dd_setup__:%")).toBe(true);
    expect(rec.deletes.some((d) => d.eqName === LEGACY_SAFEGUARD_RULE_NAME)).toBe(true);
  });

  it("NEVER deletes merchant custom rules", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
    });

    // Every delete is scoped to a setup-owned name. An unscoped delete
    // (no `like` and no `eq(name)`) would wipe custom rules.
    for (const d of rec.deletes) {
      expect(d.like ?? d.eqName).toBeDefined();
      if (d.like) expect(d.like).toBe("__dd_setup__:%");
      if (d.eqName) expect(d.eqName).toBe(LEGACY_SAFEGUARD_RULE_NAME);
    }
  });

  it("performs the swap in ONE atomic RPC, not separate deletes+inserts", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
    });

    expect(rec.rpcCalls).toHaveLength(1);
    expect(rec.rpcCalls[0].fn).toBe("write_store_automation");
    expect(rec.rpcCalls[0].args).toMatchObject({
      p_shop_id: "shop-1",
      p_mode: "auto",
      p_safeguard_enabled: true,
      p_safeguard_amount: 500,
    });
  });

  it("mirrors auto_save_enabled = true when the switch is auto", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: false, amount: 0 },
    });

    expect(mockUpdateShopSettings).toHaveBeenCalledWith("shop-1", {
      auto_save_enabled: true,
    });
  });

  it("mirrors auto_save_enabled = false when the switch is review", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
    });

    expect(mockUpdateShopSettings).toHaveBeenCalledWith("shop-1", {
      auto_save_enabled: false,
    });
  });

  it("a non-positive amount disables the safeguard rather than writing a junk rule", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 0 },
    });

    expect(rec.inserted).toHaveLength(1);
    expect(rec.inserted[0].name).toBe(FALLBACK_RULE_NAME);
  });

  it("fires reconcile when flipping review → auto", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([fallbackRow("review")], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: false, amount: 0 },
    });

    expect(mockReconcile).toHaveBeenCalledWith("shop-1");
  });

  it("does NOT fire reconcile when staying on review", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([fallbackRow("review")], rec) as never);

    await writeStoreAutomation("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
    });

    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("fires reconcile when the safeguard is relaxed while already on auto", async () => {
    // Cases parked only because they exceeded the old threshold may now be
    // eligible — raising the bar must unstick them.
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 200)], rec) as never,
    );

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 900 },
    });

    expect(mockReconcile).toHaveBeenCalledWith("shop-1");
  });

  it("fires reconcile when the safeguard is turned off while already on auto", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 200)], rec) as never,
    );

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: false, amount: 0 },
    });

    expect(mockReconcile).toHaveBeenCalledWith("shop-1");
  });

  it("does NOT fire reconcile when the safeguard is TIGHTENED on auto", async () => {
    // A lower threshold can only park more cases, never free any.
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(
      mockSb([fallbackRow("auto"), safeguardRow(SAFEGUARD_RULE_NAME, 900)], rec) as never,
    );

    await writeStoreAutomation("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 200 },
    });

    expect(mockReconcile).not.toHaveBeenCalled();
  });
});

describe("seedDefaultStoreAutomation", () => {
  it("seeds auto-pilot + $500 safeguard for a brand-new shop", async () => {
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
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
    const rec: Recorded = { inserted: [], deletes: [], rpcCalls: [] };
    mockGetServiceClient.mockReturnValue(mockSb([fallbackRow("review")], rec) as never);

    await seedDefaultStoreAutomation("shop-1");

    expect(rec.inserted).toHaveLength(0);
    expect(mockUpdateShopSettings).not.toHaveBeenCalled();
  });
});
