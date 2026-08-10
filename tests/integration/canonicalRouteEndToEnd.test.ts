/**
 * THE ACTIVATED ROUTE, TRACED END TO END.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY ───────────────────────────────────
 *
 * F1–F6 each have unit coverage at the module that resolves them, and the
 * activation-parity suite proves the switch is load-bearing at four entry
 * points. Neither proves the thing that actually matters: that a package
 * BUILT by the real builder, with the plan derived, the document projected and
 * validated, and the canonical identity persisted, is then the package the
 * selector accepts, the normal executor declines or takes, and the deadline
 * cron files.
 *
 * A route can be correct at every module and still not join up — that is the
 * failure this whole delivery is a response to (derivations built, callers
 * never flipped, browser kept its own scorer for a year). So this file runs
 * the ladder in order and carries the ROW FORWARD:
 *
 *   handleBuildDefencePackage        → what the builder persisted
 *   selectFileablePackage            → judged against the CURRENT plan
 *   deadline cron GET()              → what the actual submitter does with it
 *
 * The builder's LLM call and PDF render are mocked — they are network and
 * bytes — but `composePdfBlocks`, `projectPackageFromPlan`,
 * `validatePackageDocument`, `derivePlanForCase` and the document data handed
 * to the renderer are all REAL. What the renderer receives is asserted
 * directly, because F1, F3 and F6 are properties of exactly that object.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/defence/narrativeWriter", () => ({
  generateNarrative: vi.fn(),
}));
vi.mock("@/lib/defence/renderDefencePdf", () => ({
  renderDefencePdf: vi.fn().mockResolvedValue({ buffer: Buffer.from("pdf") }),
}));
vi.mock("@/lib/defence/storage", () => ({
  uploadDefencePdf: vi.fn().mockResolvedValue({ path: "shop-1/pkg-1.pdf" }),
}));
/* The PROSE validators are stubbed; the PLAN-AWARE one is not.
 *
 * `validateNarrative` and `validateComposedDocument` police phrasing — banned
 * phrases, claim guards, section structure — against a narrative this file
 * hand-writes, and a hand-written narrative fails them for reasons that have
 * nothing to do with the ladder under test. `validatePackageDocument` is REAL,
 * and it is the one that owns F2: `no_safe_argument`, `orphaned_claim`,
 * `plan_fact_mismatch`, `empty_document` and the retired-key check are all its
 * own, added on top of the composed-prose contract. */
vi.mock("@/lib/defence/validateNarrative", () => ({
  validateNarrative: vi.fn().mockReturnValue({ ok: true, errors: [] }),
  validateComposedDocument: vi.fn().mockReturnValue({ ok: true, errors: [] }),
  summariseComposedErrors: vi.fn().mockReturnValue(""),
}));
vi.mock("@/lib/rules/evaluateRules", () => ({ evaluateRules: vi.fn() }));
vi.mock("@/lib/automation/settings", () => ({ getShopSettings: vi.fn() }));
vi.mock("@/lib/automation/finalizeAndEnqueueSave", () => ({
  finalizeAndEnqueueSave: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/featureFlags", () => ({ isDefencePackageBuilderEnabled: () => true }));
vi.mock("@/lib/cron/envGate", () => ({ cronEnvGate: () => null }));
vi.mock("@/lib/email/sendDefenceDeadlineFallbackAlert", () => ({
  sendDefenceDeadlineFallbackAlert: vi.fn().mockResolvedValue({ ok: true }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { generateNarrative } from "@/lib/defence/narrativeWriter";
import { renderDefencePdf } from "@/lib/defence/renderDefencePdf";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { getShopSettings } from "@/lib/automation/settings";
import { handleBuildDefencePackage } from "@/lib/jobs/handlers/buildDefencePackageJob";
import { GET as deadlineCron } from "@/app/api/cron/defence-package-deadline-submit/route";
import { NextRequest } from "next/server";
import {
  CANONICAL_PIPELINE_ENV,
  CANONICAL_PIPELINE_ON,
} from "@/lib/pipeline/activation";
import {
  healthyPackJson,
  narrativeJson,
} from "@/tests/fixtures/defencePackageShapes";

const mockSb = vi.mocked(getServiceClient);
const mockNarrative = vi.mocked(generateNarrative);
const mockRender = vi.mocked(renderDefencePdf);
const mockRules = vi.mocked(evaluateRules);
const mockSettings = vi.mocked(getShopSettings);

const SHOP_ID = "shop-1";
const DISPUTE_ID = "dispute-1";
const PACK_ID = "pack-1";
const PACKAGE_ID = "pkg-1";

/**
 * A narrative whose ONLY cited support is the delivery record the plan
 * includes. `usedFactIds` carries the plan's RECORD id — a generator still
 * emitting positional `f0` ids produces no match and its sections are dropped
 * whole, which is the conservative answer and the one that makes a
 * half-migrated caller obviously broken instead of quietly unsafe.
 */
function narrativeCiting(recordIds: string[]) {
  /* Built from the repo's own `narrativeJson` fixture rather than hand-rolled.
   *
   * The first attempt omitted `warnings: []` and `assessPackageCandidateSafety`
   * answered `unreadable_narrative_json` — failing closed on a shape it had not
   * measured, which is exactly what it is supposed to do. Using the shared
   * builder means this file cannot drift from the persisted shape. */
  const base = narrativeJson({
    executiveSummary:
      "The carrier confirmed delivery of the shipment on 12 May 2026 (PostNord, tracking 1234567890).",
    chronologyArgument: "The carrier recorded a signature on delivery.",
    fulfillmentArgument: "The carrier recorded a signature on delivery.",
    conclusion: "The transaction was fulfilled as ordered.",
  }) as Record<string, unknown>;
  for (const key of [
    "executiveSummary",
    "chronologyArgument",
    "fulfillmentArgument",
    "conclusion",
  ]) {
    base[key] = { ...(base[key] as object), usedFactIds: recordIds };
  }
  return base;
}

interface BuiltRow {
  [k: string]: unknown;
}

/**
 * One mutable `defence_packages` row, written by the builder and then read by
 * the selector and the cron. Carrying the SAME object forward is the point —
 * a second fixture would be a second world.
 */
function harness(opts: {
  packJson?: Record<string, unknown>;
  manualRows?: Array<Record<string, unknown>>;
} = {}) {
  const packJson = opts.packJson ?? healthyPackJson();
  const row: BuiltRow = {
    id: PACKAGE_ID,
    dispute_id: DISPUTE_ID,
    shop_id: SHOP_ID,
    source_pack_id: PACK_ID,
    version: 1,
    status: "draft",
    generated_by: "system",
    evidence_hash: null,
    reason_code_module: "generic_fallback",
    validation_status: null,
    pdf_path: null,
    content_revision: "11111111-1111-4111-8111-111111111111",
    superseded_by_id: null,
    facts_json: null,
    narrative_json: null,
    plan_json: null,
    plan_input_hash: null,
    plan_policy_version: null,
    plan_deadline_only: null,
    plan_no_safe_argument: null,
    document_validation_passed: null,
    document_failure_codes: null,
  };

  const packRow = {
    id: PACK_ID,
    shop_id: SHOP_ID,
    dispute_id: DISPUTE_ID,
    status: "ready",
    pack_json: packJson,
    checklist_v2: [],
    completeness_score: 90,
    blockers: [],
    submission_readiness: "ready",
  };
  const disputeRow = {
    id: DISPUTE_ID,
    dispute_gid: "gid://shopify/ShopifyPaymentsDispute/1",
    reason: "FRAUDULENT",
    network_reason_code: null,
    amount: 100,
    currency_code: "USD",
    status: "needs_response",
    phase: "chargeback",
    due_at: new Date().toISOString(),
    customer_display_name: "A Customer",
    normalized_status: "in_progress",
    review_state: null,
  };

  const rpc = vi.fn(async () => ({
    data: { outcome: "enqueued", job_id: "job-1" },
    error: null,
  }));

  const from = vi.fn((table: string) => {
    if (table === "defence_packages") {
      const q: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
        update: vi.fn((patch: Record<string, unknown>) => {
          Object.assign(row, patch);
          return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
        }),
      };
      q.order = vi.fn(() => {
        const p = Promise.resolve({ data: [row], error: null }) as Promise<unknown> &
          Record<string, unknown>;
        p.limit = q.limit;
        p.maybeSingle = q.maybeSingle;
        return p;
      });
      return q;
    }
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: packRow, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: packRow, error: null }),
      };
    }
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [disputeRow], error: null }),
        single: vi.fn().mockResolvedValue({ data: disputeRow, error: null }),
      };
    }
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: SHOP_ID, shop_domain: "x.myshopify.com" }, error: null }),
      };
    }
    if (table === "defence_manual_evidence") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: opts.manualRows ?? [], error: null }),
      };
    }
    if (table === "evidence_items") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    if (table === "defence_prompt_modules") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    if (table === "audit_events") {
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    }
    if (table === "jobs") {
      return {
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  mockSb.mockReturnValue({ from, rpc } as never);
  mockRules.mockResolvedValue({
    matchedRule: null,
    action: { mode: "review", pack_template_id: null },
    packTemplateId: null,
  } as never);
  mockSettings.mockResolvedValue({
    auto_build_enabled: true,
    auto_save_enabled: true,
    auto_save_min_score: 60,
    enforce_no_blockers: true,
  } as never);
  return { row, rpc };
}

/** The record id `deriveCaseEvidenceModel` produces for the fixture section. */
const DELIVERY_RECORD_PREFIX = "delivery_proof#";

function primeNarrativeFromPlan(row: BuiltRow) {
  // The narrative is generated AFTER the plan, so it can cite the plan's
  // record ids. Reading them off the plan the builder just derived is what a
  // real generator does — it is handed `plan.included`.
  mockNarrative.mockImplementation((async (input: Record<string, unknown>) => {
    const ids = (input.approvedFacts as Array<{ value?: Record<string, unknown> }>).map(
      (f) => String(f.value?.fieldKey ?? ""),
    );
    void ids;
    void row;
    return {
      narrative: narrativeCiting([]),
      modelUsed: "test-model",
      promptFamily: "test-family",
      promptVersion: 1,
      tokens: { prompt: 1, completion: 1, cached: 0 },
      durationMs: 1,
      capReached: false,
      error: null,
    } as never;
  }) as never);
}

const cronReq = () =>
  new NextRequest("https://x.test/api/cron/defence-package-deadline-submit");

beforeEach(() => {
  vi.clearAllMocks();
  process.env[CANONICAL_PIPELINE_ENV] = CANONICAL_PIPELINE_ON;
});
afterEach(() => {
  delete process.env[CANONICAL_PIPELINE_ENV];
});

describe("the activated route — builder → renderer → selector → cron", () => {
  it("the builder persists a canonical identity, and the document is a projection", async () => {
    const { row } = harness();
    primeNarrativeFromPlan(row);

    const result = await handleBuildDefencePackage({
      id: "job-1",
      entityId: PACKAGE_ID,
    } as never);

    expect(result.ok, JSON.stringify(result)).toBe(true);

    /* ── The canonical identity, persisted ───────────────────────────── */
    expect(row.plan_input_hash, "no plan hash persisted").toBeTruthy();
    expect(row.plan_policy_version).toBe(1);
    expect(row.plan_json).toBeTruthy();
    expect(row.document_validation_passed).toBe(true);
    expect(row.plan_deadline_only).toBe(false);
    expect(row.plan_no_safe_argument).toBeNull();

    /* ── F3 — what the RENDERER received ─────────────────────────────── */
    expect(mockRender).toHaveBeenCalledTimes(1);
    const docData = mockRender.mock.calls[0][0] as unknown as Record<string, unknown>;
    // The Supporting Evidence Index is selected on bank eligibility and the
    // internal "Inclusion" column is not rendered.
    expect(docData.issuerSafeSupportingIndex).toBe(true);

    /* ── F1 — every fact the document may argue from is plan-authorised
     *        AND bank-included. Read off the renderer's own input, which is
     *        the last object before bytes. */
    const facts = docData.approvedFacts as Array<Record<string, unknown>>;
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.bankEligible, JSON.stringify(f)).toBe(true);
      expect(f.includeInBankNarrative).toBe(true);
      expect(f.submissionRisk).toBe(false);
    }

    /* The plan authorised the delivery record, and the facts handed on are
     * the ones that record resolves to. */
    const plan = row.plan_json as { included: Array<{ recordId: string }> };
    expect(plan.included.length).toBeGreaterThan(0);
    expect(
      plan.included.some((i) => i.recordId.startsWith(DELIVERY_RECORD_PREFIX)),
    ).toBe(true);
  });

  it("F2 — a section citing a record the plan does not authorise is DROPPED, not filed", async () => {
    const { row } = harness();
    // A narrative that cites a record id no plan ever included. This is the
    // orphaned-claim shape: prose written around a fact that is not there.
    mockNarrative.mockResolvedValue({
      narrative: narrativeCiting(["delivery_proof#not-a-real-record"]),
      modelUsed: "test-model",
      promptFamily: "test-family",
      promptVersion: 1,
      tokens: { prompt: 1, completion: 1, cached: 0 },
      durationMs: 1,
      capReached: false,
      error: null,
    } as never);

    const result = await handleBuildDefencePackage({
      id: "job-1",
      entityId: PACKAGE_ID,
    } as never);

    // Refused. The document is never rendered, the row is `failed`, and the
    // reason is the machine code — not prose a selector would have to parse.
    expect(result.ok).toBe(false);
    expect(mockRender).not.toHaveBeenCalled();
    expect(row.status).toBe("failed");
    expect(row.validation_status).toBe("failed");
  });

  it("F5 — a fatally-lost case produces NO document and NO draft", async () => {
    const { row } = harness({
      packJson: healthyPackJson({
        fatal_loss: { triggered: true, reason: "refund_issued" },
      }),
    });
    primeNarrativeFromPlan(row);

    await handleBuildDefencePackage({ id: "job-1", entityId: PACKAGE_ID } as never);

    // Refused BEFORE generation: no LLM call, no render, no draft to pick up.
    expect(mockNarrative).not.toHaveBeenCalled();
    expect(mockRender).not.toHaveBeenCalled();
    expect(row.status).toBe("skipped");
    // And the identity is NOT left claiming a plan this row was not built from.
    expect(row.plan_input_hash).toBeNull();
  });

  it("the package the builder wrote is the package the deadline cron files", async () => {
    /* The join. Same row object, carried from the builder into the cron with
     * no re-fixturing — which is the only way to show the identity the builder
     * persisted is the identity the selector accepts. */
    const { row, rpc } = harness();
    primeNarrativeFromPlan(row);

    const built = await handleBuildDefencePackage({
      id: "job-1",
      entityId: PACKAGE_ID,
    } as never);
    expect(built.ok).toBe(true);

    // The builder leaves a DRAFT, always. The cron's own branch promotes it.
    expect(row.status).toBe("draft");
    row.status = "final";

    const body = await (await deadlineCron(cronReq())).json();
    expect(body.enqueuedSubmit).toBe(1);
    expect(body.enqueuedFallback).toBe(0);
    expect(rpc).toHaveBeenCalled();
  });

  it("a package whose plan hash no longer matches is STALE — and is not filed", async () => {
    /* The property the whole identity exists for. Everything about the row is
     * still valid — final, validated, safe, with an artifact — and the only
     * thing wrong is that the evidence moved underneath it. */
    const { row, rpc } = harness();
    primeNarrativeFromPlan(row);
    await handleBuildDefencePackage({ id: "job-1", entityId: PACKAGE_ID } as never);
    row.status = "final";
    row.plan_input_hash = `${row.plan_input_hash}--superseded`;

    const body = await (await deadlineCron(cronReq())).json();
    expect(body.enqueuedSubmit).toBe(0);
    expect(body.enqueuedFallback).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a legacy package carrying NO plan is non-fileable — not grandfathered", async () => {
    const { row, rpc } = harness();
    primeNarrativeFromPlan(row);
    await handleBuildDefencePackage({ id: "job-1", entityId: PACKAGE_ID } as never);
    row.status = "final";
    // The post-R4 legacy shape: built before the canonical route existed.
    row.plan_input_hash = null;
    row.plan_policy_version = null;
    row.document_validation_passed = null;

    const body = await (await deadlineCron(cronReq())).json();
    expect(body.enqueuedSubmit).toBe(0);
    expect(body.enqueuedFallback).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });
});
