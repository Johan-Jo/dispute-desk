/**
 * Tests for `handleBuildDefencePackage`.
 *
 * Focused on orchestration short-circuits (missing entity, non-draft status,
 * coverage-gated skip, no-bank-eligible-facts skip, validation failure).
 * The full happy path is covered by the validateNarrative + factClassifier
 * + renderDefencePdf unit suites and a manual smoke test on a deployed
 * environment (per CLAUDE.md feedback_test_in_prod).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/defence/narrativeWriter", () => ({
  generateNarrative: vi.fn(),
}));
vi.mock("@/lib/defence/renderDefencePdf", () => ({
  renderDefencePdf: vi.fn(),
}));
vi.mock("@/lib/defence/storage", () => ({
  uploadDefencePdf: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { handleBuildDefencePackage } from "../buildDefencePackageJob";
import type { ClaimedJob } from "../../claimJobs";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogAudit = vi.mocked(logAuditEvent);

function makeJob(entityId: string | null = "pkg-1"): ClaimedJob {
  return {
    id: "job-1",
    shopId: "shop-1",
    jobType: "build_defence_package",
    entityId: entityId as string,
    attempts: 0,
    maxAttempts: 3,
  };
}

interface ChainBuilderArgs {
  pkg?: Record<string, unknown> | null;
  pack?: Record<string, unknown> | null;
  dispute?: Record<string, unknown> | null;
  items?: Array<Record<string, unknown>>;
  manualRows?: Array<Record<string, unknown>>;
  moduleOverride?: Record<string, unknown> | null;
}

function mockSb(args: ChainBuilderArgs) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];

  function fromTable(table: string) {
    type Chain = {
      select: (cols: string) => Chain;
      eq: (k: string, v: unknown) => Chain;
      order: (k: string, opts?: unknown) => Chain;
      limit: (n: number) => Chain;
      single: () => Promise<{ data: unknown; error: null }>;
      maybeSingle: () => Promise<{ data: unknown; error: null }>;
      update: (values: Record<string, unknown>) => Chain;
    };
    let returningData: unknown = null;
    if (table === "defence_packages") returningData = args.pkg;
    if (table === "evidence_packs") returningData = args.pack;
    if (table === "disputes") returningData = args.dispute;
    if (table === "defence_manual_evidence") returningData = args.manualRows ?? [];
    if (table === "evidence_items") returningData = args.items ?? [];
    if (table === "defence_prompt_modules") returningData = args.moduleOverride ?? null;

    const chain: Chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => ({ data: returningData, error: null }),
      maybeSingle: async () => ({ data: returningData, error: null }),
      update: (values) => {
        updates.push({ table, values });
        return chain;
      },
    };
    // For evidence_items the call is `.select().eq()` without `.single()`,
    // so the chain's await returns `{ data, error }` directly. Vitest doesn't
    // care if extra methods are unused — leaving the chain pluripotent.
    // The select chain for collections needs to be awaitable too.
    (chain as unknown as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) =>
      cb({ data: returningData, error: null });

    return chain;
  }

  return {
    from: fromTable,
    updates,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleBuildDefencePackage", () => {
  it("returns retriable=false when entity_id is missing", async () => {
    const result = await handleBuildDefencePackage({
      ...makeJob(null),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retriable).toBe(false);
    expect(result.reason).toMatch(/entity_id/);
  });

  it("returns retriable=false when defence_packages row is not found", async () => {
    const sb = mockSb({ pkg: null });
    mockGetServiceClient.mockReturnValue(sb as never);

    const result = await handleBuildDefencePackage(makeJob());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retriable).toBe(false);
    expect(result.reason).toMatch(/package not found/);
  });

  it("returns retriable=false when package status is not draft", async () => {
    const sb = mockSb({
      pkg: {
        id: "pkg-1",
        dispute_id: "disp-1",
        shop_id: "shop-1",
        source_pack_id: "pack-1",
        version: 1,
        status: "final",
        generated_by: "system",
        evidence_hash: "h",
        reason_code_module: "visa_10_4_fraud",
      },
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const result = await handleBuildDefencePackage(makeJob());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retriable).toBe(false);
    expect(result.reason).toMatch(/status=final/);
  });

  it("marks skipped when coverage gate is active", async () => {
    const sb = mockSb({
      pkg: {
        id: "pkg-1",
        dispute_id: "disp-1",
        shop_id: "shop-1",
        source_pack_id: "pack-1",
        version: 1,
        status: "draft",
        generated_by: "system",
        evidence_hash: "h",
        reason_code_module: "visa_10_4_fraud",
      },
      pack: {
        id: "pack-1",
        shop_id: "shop-1",
        dispute_id: "disp-1",
        pack_json: {
          coverage: { state: "covered_shopify" },
          fatal_loss: { triggered: false, reason: null },
          sections: [],
        },
        checklist_v2: [],
      },
      dispute: {
        id: "disp-1",
        dispute_gid: "gid://shopify/Dispute/1",
        reason: "FRAUDULENT",
        network_reason_code: "10.4",
        amount: "99.00",
        currency_code: "USD",
      },
      moduleOverride: null,
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const result = await handleBuildDefencePackage(makeJob());
    expect(result.ok).toBe(true);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "defence_package_skipped" }),
    );
    const skippedUpdate = sb.updates.find(
      (u) => u.table === "defence_packages" && u.values.status === "skipped",
    );
    expect(skippedUpdate?.values.failure_code).toBe("covered_shopify");
  });

  it("marks skipped when no bank-eligible facts after classification", async () => {
    const sb = mockSb({
      pkg: {
        id: "pkg-1",
        dispute_id: "disp-1",
        shop_id: "shop-1",
        source_pack_id: "pack-1",
        version: 1,
        status: "draft",
        generated_by: "system",
        evidence_hash: "h",
        reason_code_module: "visa_10_4_fraud",
      },
      pack: {
        id: "pack-1",
        shop_id: "shop-1",
        dispute_id: "disp-1",
        pack_json: {
          coverage: { state: "not_covered" },
          fatal_loss: { triggered: false, reason: null },
          // No sections → no facts → classifier returns eligible=false
          sections: [],
        },
        checklist_v2: [],
      },
      dispute: {
        id: "disp-1",
        dispute_gid: "gid://shopify/Dispute/1",
        reason: "FRAUDULENT",
        network_reason_code: "10.4",
        amount: "99.00",
        currency_code: "USD",
      },
      moduleOverride: null,
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const result = await handleBuildDefencePackage(makeJob());
    expect(result.ok).toBe(true);
    const skippedUpdate = sb.updates.find(
      (u) => u.table === "defence_packages" && u.values.status === "skipped",
    );
    expect(skippedUpdate?.values.failure_code).toBe("no_bank_eligible_facts");
  });
});
