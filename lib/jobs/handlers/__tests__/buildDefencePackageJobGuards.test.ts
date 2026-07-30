/**
 * Regression test for the auto-submit guard drift.
 *
 * `buildDefencePackageJob` used to hand-roll its own coverage / fatal-loss /
 * strength checks and treated **Moderate as BLOCKING**, while
 * `lib/automation/pipeline.ts` treated Moderate as a **PARK**. Both leave the
 * package a draft, so no merchant ever saw a difference — which is exactly
 * why the divergence survived. Both now call `evaluateAutoSubmitGuards`.
 *
 * These tests pin the two things that matter for this handler:
 *   1. every non-`proceed` verdict demotes to `targetStatus: "draft"`;
 *   2. the audit payload records the verdict, so a park and a block are
 *      distinguishable in the trail (they were not before).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/defence/narrativeWriter", () => ({
  generateNarrative: vi.fn().mockResolvedValue({
    narrative: { sections: [{ key: "s1", body: "Body." }] },
    modelUsed: "test-model",
    promptFamily: "test-family",
    promptVersion: "v1",
    tokens: { prompt: 1, completion: 1, cached: 0 },
    durationMs: 1,
  }),
}));
vi.mock("@/lib/defence/validateNarrative", () => ({
  validateNarrative: vi.fn().mockReturnValue({ ok: true, errors: [] }),
  validateComposedDocument: vi.fn().mockReturnValue({ ok: true, errors: [] }),
  summariseComposedErrors: vi.fn().mockReturnValue(""),
}));
vi.mock("@/lib/defence/pdf/composePdfBlocks", () => ({
  composePdfBlocks: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/defence/renderDefencePdf", () => ({
  renderDefencePdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));
vi.mock("@/lib/defence/storage", () => ({
  uploadDefencePdf: vi.fn().mockResolvedValue({ path: "shop-1/pkg-1.pdf" }),
}));
vi.mock("@/lib/defence/factClassifier", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyFacts: vi.fn().mockReturnValue({
      approved: [
        {
          key: "delivery_confirmed",
          label: "Delivery confirmed",
          value: "Delivered 2026-07-01",
          bankEligible: true,
        },
      ],
      internalOnly: [],
      submissionRisk: [],
      missing: [],
      manual: [],
      packageMode: "standard",
      eligible: true,
      ineligibilityReason: null,
      predicateEvaluations: {},
    }),
  };
});
vi.mock("@/lib/automation/finalizeAndEnqueueSave", () => ({
  finalizeAndEnqueueSave: vi.fn().mockResolvedValue({ ok: true }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { finalizeAndEnqueueSave } from "@/lib/automation/finalizeAndEnqueueSave";
import { handleBuildDefencePackage } from "../buildDefencePackageJob";
import type { ClaimedJob } from "../../claimJobs";

vi.mock("@/lib/rules/evaluateRules", () => ({
  evaluateRules: vi.fn(),
}));

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockEvaluateRules = vi.mocked(evaluateRules);

function makeJob(): ClaimedJob {
  return {
    id: "job-1",
    shopId: "shop-1",
    jobType: "build_defence_package",
    entityId: "pkg-1",
    attempts: 0,
    maxAttempts: 3,
  };
}

interface Captured {
  updates: Array<{ table: string; values: Record<string, unknown> }>;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
}

function mockSb(packJson: Record<string, unknown>, captured: Captured) {
  function fromTable(table: string) {
    let data: unknown = null;
    if (table === "defence_packages") {
      data = {
        id: "pkg-1",
        dispute_id: "disp-1",
        shop_id: "shop-1",
        source_pack_id: "pack-1",
        version: 1,
        status: "draft",
        generated_by: "system",
        evidence_hash: "h",
        reason_code_module: "visa_10_4_fraud",
      };
    }
    if (table === "evidence_packs") {
      data = {
        id: "pack-1",
        shop_id: "shop-1",
        dispute_id: "disp-1",
        pack_json: packJson,
        checklist_v2: [],
      };
    }
    if (table === "disputes") {
      data = {
        id: "disp-1",
        dispute_gid: "gid://shopify/Dispute/1",
        reason: (packJson.disputeReason as string) ?? "FRAUDULENT",
        network_reason_code: "10.4",
        amount: "99.00",
        currency_code: "USD",
        status: "NEEDS_RESPONSE",
        phase: "chargeback",
      };
    }
    if (table === "shops") data = { shop_domain: "test.myshopify.com" };
    if (table === "defence_manual_evidence") data = [];
    if (table === "evidence_items") data = [];
    if (table === "defence_prompt_modules") data = null;

    type Chain = Record<string, unknown>;
    const chain: Chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => ({ data, error: null }),
      maybeSingle: async () => ({ data, error: null }),
      update: (values: Record<string, unknown>) => {
        captured.updates.push({ table, values });
        return chain;
      },
      insert: (values: Record<string, unknown>) => {
        captured.inserts.push({ table, values });
        return chain;
      },
      then: (cb: (v: unknown) => unknown) => cb({ data, error: null }),
    };
    return chain;
  }
  return { from: fromTable };
}

function packJsonWith(overrides: Record<string, unknown>) {
  return {
    coverage: { state: "not_covered" },
    fatal_loss: { triggered: false, reason: null },
    disputeReason: "FRAUDULENT",
    sections: [
      {
        type: "delivery",
        label: "Delivery",
        source: "shopify",
        data: { delivered_at: "2026-07-01" },
        fieldsProvided: ["delivered_at"],
      },
    ],
    ...overrides,
  };
}

async function runWith(packJson: Record<string, unknown>) {
  const captured: Captured = { updates: [], inserts: [] };
  mockGetServiceClient.mockReturnValue(mockSb(packJson, captured) as never);
  const result = await handleBuildDefencePackage(makeJob());
  const pkgUpdate = captured.updates.find(
    (u) => u.table === "defence_packages" && u.values.status !== undefined,
  );
  const blockedAudit = captured.inserts.find(
    (i) => i.table === "audit_events" && i.values.event_type === "auto_save_blocked",
  );
  return { result, captured, pkgUpdate, blockedAudit };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Rules say AUTO for every case below — the guards are the only thing
  // that can demote it. That is precisely what we're testing.
  mockEvaluateRules.mockResolvedValue({
    matchedRule: { name: "__dd_setup__:fallback:default" },
    action: { mode: "auto", pack_template_id: null },
    packTemplateId: null,
  } as never);
});

describe("buildDefencePackageJob — auto-submit guards", () => {
  it("Moderate strength PARKS as a draft and records a park verdict (was a block)", async () => {
    const { pkgUpdate, blockedAudit } = await runWith(
      packJsonWith({ case_strength: { overall: "moderate" } }),
    );

    // The behaviour merchants see is unchanged: still a draft.
    expect(pkgUpdate?.values.status).toBe("draft");
    // The audit trail is what changed — park is now distinguishable.
    expect(blockedAudit?.values.event_payload).toMatchObject({
      decision: "park",
      verdict_reason: "moderate_strength",
      case_strength: "moderate",
    });
    expect(finalizeAndEnqueueSave).not.toHaveBeenCalled();
  });

  it("product-family Strong PROCEEDS — the park was removed 2026-07-30", async () => {
    // Was: parked as a draft. Shopify files its own scraped evidence when we
    // file none, so parking never withheld a rebuttal — it substituted a worse
    // one. See lib/automation/autoSubmitGuards.ts for the full reasoning.
    const { blockedAudit } = await runWith(
      packJsonWith({
        case_strength: { overall: "strong" },
        disputeReason: "PRODUCT_UNACCEPTABLE",
      }),
    );

    expect(blockedAudit).toBeUndefined();
    expect(finalizeAndEnqueueSave).toHaveBeenCalled();
  });

  it("Weak strength BLOCKS and records a block verdict", async () => {
    const { pkgUpdate, blockedAudit } = await runWith(
      packJsonWith({ case_strength: { overall: "weak" } }),
    );

    expect(pkgUpdate?.values.status).toBe("draft");
    expect(blockedAudit?.values.event_payload).toMatchObject({
      decision: "block",
      verdict_reason: "weak",
    });
    expect(finalizeAndEnqueueSave).not.toHaveBeenCalled();
  });

  it("fatal loss BLOCKS", async () => {
    const { pkgUpdate, blockedAudit } = await runWith(
      packJsonWith({
        case_strength: { overall: "strong" },
        fatal_loss: { triggered: true, reason: "refund_issued" },
      }),
    );

    expect(pkgUpdate?.values.status).toBe("draft");
    expect(blockedAudit?.values.event_payload).toMatchObject({
      decision: "block",
      verdict_reason: "fatal_loss",
    });
    expect(finalizeAndEnqueueSave).not.toHaveBeenCalled();
  });

  it("Strong non-product FINALIZES and enqueues the save", async () => {
    const { pkgUpdate, blockedAudit } = await runWith(
      packJsonWith({ case_strength: { overall: "strong" } }),
    );

    expect(pkgUpdate?.values.status).toBe("final");
    expect(blockedAudit).toBeUndefined();
    expect(finalizeAndEnqueueSave).toHaveBeenCalledTimes(1);
  });
});
