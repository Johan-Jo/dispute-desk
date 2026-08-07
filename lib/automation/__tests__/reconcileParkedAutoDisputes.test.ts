import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/rules/evaluateRules", () => ({
  evaluateRules: vi.fn(),
}));
vi.mock("@/lib/argument/reasonFamily", () => ({
  resolveReasonFamily: vi.fn((reason: string | null) =>
    reason === "PRODUCT_NOT_AS_DESCRIBED" ? "product" : "fraud",
  ),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { reconcileParkedAutoDisputes } from "../reconcileParkedAutoDisputes";
import {
  CLEAN_FACTS,
  narrativeJson,
} from "@/tests/fixtures/defencePackageShapes";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockEvaluateRules = vi.mocked(evaluateRules);

interface Scenario {
  disputes: Array<Record<string, unknown>>;
  /** keyed by dispute_id */
  packByDispute: Record<string, Record<string, unknown> | null>;
  dpkgByDispute: Record<string, Record<string, unknown> | null>;
  /** pack ids that already have a pending save job */
  pendingSaveForPack?: Set<string>;
}

/**
 * A query-aware Supabase mock. It tracks which table each chain targets and
 * which dispute_id / entity_id was filtered on, then returns the matching
 * fixture. It records `insert` calls so the test can assert save enqueues,
 * and `update` calls so it can assert the finalize flip.
 */
function mockSb(s: Scenario) {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];

  function fromTable(table: string) {
    const filters: Record<string, unknown> = {};
    let didUpdate = false;

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      },
      in: () => chain,
      is: () => chain,
      neq: () => chain,
      order: () => chain,
      limit: () => chain,
      update: (values: Record<string, unknown>) => {
        didUpdate = true;
        updates.push({ table, values });
        return chain;
      },
      insert: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return chain;
      },
    };

    function resolveData(): unknown {
      if (table === "disputes") return s.disputes;
      if (table === "evidence_packs") {
        const did = filters["dispute_id"] as string;
        return s.packByDispute[did] ?? null;
      }
      if (table === "defence_packages") {
        // The finalize flip is `.update().eq('id').eq('status','draft').select('id')`
        // — an update chain filtered on status='draft' returns the flipped rows.
        if (didUpdate && filters["status"] === "draft") {
          return [{ id: filters["id"] }];
        }
        const did = filters["dispute_id"] as string;
        if (did) return s.dpkgByDispute[did] ?? null;
        // PR-C1: `preflightNamedCandidate` looks the row up by id. Resolve it
        // from the same fixture so the safety preflight sees real content.
        const byId = filters["id"] as string;
        if (byId) {
          const hit = Object.values(s.dpkgByDispute).find(
            (d) => d && (d as Record<string, unknown>).id === byId,
          );
          return hit ?? null;
        }
        return null;
      }
      if (table === "jobs") {
        const packId = filters["entity_id"] as string;
        return s.pendingSaveForPack?.has(packId) ? { id: "job-x" } : null;
      }
      return null;
    }

    (chain as { single: () => Promise<unknown> }).single = async () => ({
      data: resolveData(),
      error: null,
    });
    (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = async () => ({
      data: resolveData(),
      error: null,
    });
    (chain as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) =>
      cb({ data: resolveData(), error: null });

    return chain;
  }

  return { from: fromTable, inserts, updates };
}

const READY_STRONG_PACK = {
  id: "pack-1",
  status: "ready",
  shop_id: "shop-1",
  pack_json: {
    case_strength: { overall: "strong" },
    disputeReason: "FRAUDULENT",
    coverage: { state: "not_covered" },
    fatal_loss: { triggered: false },
  },
};

const FINALIZABLE_DRAFT = {
  id: "dpkg-1",
  version: 1,
  status: "draft",
  validation_status: "ok",
  pdf_path: "packs/shop-1/dpkg-1.pdf",
  // A real finalizable draft always carries both. PR-C1's preflight fails
  // closed on a candidate whose supporting JSON cannot be inspected, so a
  // fixture without them would be blocked — correctly, but it would no longer
  // represent the happy path these tests are about.
  facts_json: CLEAN_FACTS,
  narrative_json: narrativeJson({ fulfillmentArgument: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890)." }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEvaluateRules.mockResolvedValue({
    action: { mode: "auto", pack_template_id: null },
  } as never);
});

describe("reconcileParkedAutoDisputes", () => {
  // ── PR-C1 ──────────────────────────────────────────────────────────
  it("does NOT promote or count an unsafe candidate, and reports it as blocked", async () => {
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: { "disp-1": READY_STRONG_PACK },
      dpkgByDispute: {
        "disp-1": {
          ...FINALIZABLE_DRAFT,
          facts_json: CLEAN_FACTS,
          narrative_json: narrativeJson({ fulfillmentArgument: "The parcel was delivered to the cardholder's verified address." }),
        },
      },
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const res = await reconcileParkedAutoDisputes("shop-1");

    // Not reconciled — a blocked dispute has not been handled.
    expect(res.reconciled).toBe(0);
    expect(res.disputeIds).toEqual([]);
    expect(res.blocked).toBe(1);
    // Nothing promoted, nothing superseded, nothing enqueued.
    expect(sb.updates.some((u) => u.table === "defence_packages")).toBe(false);
    expect(sb.inserts.some((i) => i.table === "jobs")).toBe(false);
  });

  it("does NOT promote a candidate whose supporting JSON is unreadable", async () => {
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: { "disp-1": READY_STRONG_PACK },
      dpkgByDispute: {
        "disp-1": { ...FINALIZABLE_DRAFT, facts_json: null, narrative_json: null },
      },
    });
    mockGetServiceClient.mockReturnValue(sb as never);
    const res = await reconcileParkedAutoDisputes("shop-1");
    expect(res.reconciled).toBe(0);
    expect(res.blocked).toBe(1);
    expect(sb.inserts.some((i) => i.table === "jobs")).toBe(false);
  });

  it("finalizes + enqueues save for a parked Strong dispute now on auto", async () => {
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: { "disp-1": READY_STRONG_PACK },
      dpkgByDispute: { "disp-1": FINALIZABLE_DRAFT },
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const res = await reconcileParkedAutoDisputes("shop-1");

    expect(res.reconciled).toBe(1);
    expect(res.disputeIds).toEqual(["disp-1"]);
    // finalize flip happened
    expect(sb.updates.some((u) => u.table === "defence_packages" && u.values.status === "final")).toBe(true);
    // save enqueued against the source pack
    const saveJob = sb.inserts.find((i) => i.table === "jobs");
    expect(saveJob?.values).toMatchObject({ job_type: "save_to_shopify", entity_id: "pack-1" });
  });

  it("skips a Moderate dispute (never auto-saves weaker-than-Strong)", async () => {
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: {
        "disp-1": {
          ...READY_STRONG_PACK,
          pack_json: { ...READY_STRONG_PACK.pack_json, case_strength: { overall: "moderate" } },
        },
      },
      dpkgByDispute: { "disp-1": FINALIZABLE_DRAFT },
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const res = await reconcileParkedAutoDisputes("shop-1");
    expect(res.reconciled).toBe(0);
    expect(sb.inserts.some((i) => i.table === "jobs")).toBe(false);
  });

  it("skips when the current rule mode is still review", async () => {
    mockEvaluateRules.mockResolvedValue({
      action: { mode: "review", pack_template_id: null },
    } as never);
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: { "disp-1": READY_STRONG_PACK },
      dpkgByDispute: { "disp-1": FINALIZABLE_DRAFT },
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const res = await reconcileParkedAutoDisputes("shop-1");
    expect(res.reconciled).toBe(0);
  });

  it("skips a covered dispute even when Strong + auto", async () => {
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: {
        "disp-1": {
          ...READY_STRONG_PACK,
          pack_json: { ...READY_STRONG_PACK.pack_json, coverage: { state: "covered_shopify" } },
        },
      },
      dpkgByDispute: { "disp-1": FINALIZABLE_DRAFT },
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const res = await reconcileParkedAutoDisputes("shop-1");
    expect(res.reconciled).toBe(0);
  });

  it("skips a fatal-loss dispute even when Strong + auto", async () => {
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: {
        "disp-1": {
          ...READY_STRONG_PACK,
          pack_json: { ...READY_STRONG_PACK.pack_json, fatal_loss: { triggered: true } },
        },
      },
      dpkgByDispute: { "disp-1": FINALIZABLE_DRAFT },
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const res = await reconcileParkedAutoDisputes("shop-1");
    expect(res.reconciled).toBe(0);
  });

  it("reconciles a product-family Strong dispute — the park was removed 2026-07-30", async () => {
    // Was: skipped, because the guard parked "not as described" even at
    // Strong. See lib/automation/autoSubmitGuards.ts for why that went.
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "PRODUCT_UNACCEPTABLE", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: {
        "disp-1": {
          ...READY_STRONG_PACK,
          pack_json: { ...READY_STRONG_PACK.pack_json, disputeReason: "PRODUCT_UNACCEPTABLE" },
        },
      },
      dpkgByDispute: { "disp-1": FINALIZABLE_DRAFT },
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const res = await reconcileParkedAutoDisputes("shop-1");
    expect(res.reconciled).toBe(1);
  });

  it("skips when the latest defence package is not a finalize-able draft", async () => {
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: { "disp-1": READY_STRONG_PACK },
      dpkgByDispute: { "disp-1": { ...FINALIZABLE_DRAFT, pdf_path: null } },
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const res = await reconcileParkedAutoDisputes("shop-1");
    expect(res.reconciled).toBe(0);
  });

  it("skips when a save job is already pending for the pack (idempotent)", async () => {
    const sb = mockSb({
      disputes: [{ id: "disp-1", reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" }],
      packByDispute: { "disp-1": READY_STRONG_PACK },
      dpkgByDispute: { "disp-1": FINALIZABLE_DRAFT },
      pendingSaveForPack: new Set(["pack-1"]),
    });
    mockGetServiceClient.mockReturnValue(sb as never);

    const res = await reconcileParkedAutoDisputes("shop-1");
    expect(res.reconciled).toBe(0);
    expect(sb.inserts.some((i) => i.table === "jobs")).toBe(false);
  });
});
