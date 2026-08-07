/**
 * PR-C1 — the REAL build → preflight → finalize ordering, end to end.
 *
 * THE BUG THIS PINS. `buildDefencePackageJob` wrote the freshly generated
 * package straight to `status: "final"` in auto mode, logged
 * `defence_package_finalized`, and only THEN called `finalizeAndEnqueueSave`,
 * whose entire job is to refuse a candidate that is unsafe, non-current, or
 * unverifiable. By the time the preflight ran, the package was already final
 * and the successful-finalization audit already existed — so a refusal left a
 * dispute whose newest candidate was final-but-unfileable, whose previous good
 * final had potentially been superseded, and whose audit trail said it had
 * been approved. The helper's return value was discarded, and the job returned
 * `{ ok: true }` in every case.
 *
 * `buildDefencePackageJobGuards.test.ts` MOCKS `finalizeAndEnqueueSave`, so it
 * can prove which branch was taken but not what order things happened in.
 * These tests run the real helper against a stateful Supabase mock, so the
 * finalize can only happen after — and because of — a passing preflight.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/rules/evaluateRules", () => ({ evaluateRules: vi.fn() }));
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
vi.mock("@/lib/defence/narrativeWriter", () => ({
  generateNarrative: vi.fn(),
}));
vi.mock("@/lib/defence/factClassifier", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, classifyFacts: vi.fn() };
});

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { generateNarrative } from "@/lib/defence/narrativeWriter";
import { classifyFacts } from "@/lib/defence/factClassifier";
import { handleBuildDefencePackage } from "../buildDefencePackageJob";
import type { ClaimedJob } from "../../claimJobs";
import {
  CLEAN_FACTS,
  CLEAN_NARRATIVE,
  UNSAFE_NARRATIVE,
} from "@/tests/fixtures/defencePackageShapes";

const mockClient = vi.mocked(getServiceClient);
const mockAudit = vi.mocked(logAuditEvent);
const mockRules = vi.mocked(evaluateRules);
const mockNarrative = vi.mocked(generateNarrative);
const mockClassify = vi.mocked(classifyFacts);

const PKG_ID = "pkg-1";
const DISPUTE_ID = "disp-1";

const job = (): ClaimedJob => ({
  id: "job-1",
  shopId: "shop-1",
  jobType: "build_defence_package",
  entityId: PKG_ID,
  attempts: 0,
  maxAttempts: 3,
});

const PACK_JSON = {
  coverage: { state: "not_covered" },
  fatal_loss: { triggered: false, reason: null },
  case_strength: { overall: "strong" },
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
};

interface Scenario {
  /** Inject a failure into the preflight's latest-version probe. */
  latestError?: { message: string } | null;
  /** Id of the newest version for the dispute. Defaults to the built package. */
  latestId?: string;
  /**
   * Simulate a CONCURRENT lifecycle change landing between the preflight and
   * the guarded draft-to-final UPDATE: the row's status is flipped to this
   * value just before the guard is evaluated, so the update matches zero rows
   * exactly as Postgres would.
   */
  concurrentStatusAtTransition?: string;
  /** Force the transactional RPC's reply. */
  rpcResult?: Record<string, unknown>;
  /** Make the RPC call itself fail. */
  rpcError?: { message: string } | null;
  /**
   * Simulate a LOST RESPONSE: the transaction commits (row promoted, job
   * inserted, marker written) and only then does the reply fail to arrive.
   * Applies to the first RPC call only.
   */
  loseResponseOnce?: boolean;
}

/**
 * A STATEFUL mock: the `defence_packages` row reflects whatever the handler
 * last wrote to it, so the preflight reads the package that was actually
 * persisted rather than a fixture. That is the only way the ordering claim can
 * be tested at all.
 */
function mockSb(scenario: Scenario = {}) {
  const row: Record<string, unknown> = {
    id: PKG_ID,
    dispute_id: DISPUTE_ID,
    shop_id: "shop-1",
    source_pack_id: "pack-1",
    version: 1,
    status: "draft",
    validation_status: null,
    pdf_path: null,
    content_revision: "11111111-1111-4111-8111-111111111111",
    facts_json: null,
    narrative_json: null,
    generated_by: "system",
    evidence_hash: "h",
    reason_code_module: "visa_10_4_fraud",
  };

  const packageUpdates: Array<Record<string, unknown>> = [];
  const jobsInserted: Array<Record<string, unknown>> = [];
  const disputeUpdates: Array<Record<string, unknown>> = [];
  let responseLost = false;

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let ordered = false;
    let pendingUpdate: Record<string, unknown> | null = null;

    let data: unknown = null;
    if (table === "evidence_packs") {
      data = {
        id: "pack-1",
        shop_id: "shop-1",
        dispute_id: DISPUTE_ID,
        pack_json: PACK_JSON,
        checklist_v2: [],
      };
    }
    if (table === "disputes") {
      data = {
        id: DISPUTE_ID,
        dispute_gid: "gid://shopify/Dispute/1",
        reason: "FRAUDULENT",
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

    const resolveDefencePackages = () => {
      // The latest-version probe orders by version and filters on dispute_id.
      if (ordered && filters.dispute_id !== undefined) {
        if (scenario.latestError) return { data: null, error: scenario.latestError };
        // The prior-final lookup (step 2 of the helper) also orders and
        // filters on dispute_id, but selects only id+version AND filters on
        // status='final'. There is no prior final in these scenarios.
        if (filters.status === "final") return { data: null, error: null };
        return { data: { id: scenario.latestId ?? PKG_ID, version: row.version }, error: null };
      }
      return { data: { ...row }, error: null };
    };

    type Chain = Record<string, unknown>;
    const chain: Chain = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      },
      neq: () => chain,
      not: () => chain,
      in: () => chain,
      is: () => chain,
      order: () => {
        ordered = true;
        return chain;
      },
      limit: () => chain,
      update: (values: Record<string, unknown>) => {
        if (table === "defence_packages") {
          pendingUpdate = values;
          packageUpdates.push(values);
        }
        if (table === "disputes") disputeUpdates.push(values);
        return chain;
      },
      insert: (values: Record<string, unknown>) => {
        if (table === "jobs") jobsInserted.push(values);
        return chain;
      },
      single: async () =>
        table === "defence_packages" ? resolveDefencePackages() : { data, error: null },
      maybeSingle: async () => {
        if (table === "defence_packages") return resolveDefencePackages();
        if (table === "jobs" && typeof filters.dedupe_key === "string") {
          // The durable commit marker the auto transaction leaves behind.
          const hit = jobsInserted.find((j) => j.dedupe_key === filters.dedupe_key);
          return { data: hit ? { id: "job-1" } : null, error: null };
        }
        return { data, error: null };
      },
      then: (cb: (v: unknown) => unknown) => {
        if (table !== "defence_packages") return cb({ data, error: null });
        if (!pendingUpdate) return cb({ data: [], error: null });
        // Evaluate the guard the way Postgres would: the UPDATE applies only
        // when every predicate still matches the CURRENT row. Filters are
        // known by now because `.eq(...)` runs before the await.
        if (scenario.concurrentStatusAtTransition !== undefined) {
          row.status = scenario.concurrentStatusAtTransition;
        }
        const guardsMatch = Object.entries(filters).every(([k, v]) =>
          k === "id" ? row.id === v : row[k] === v,
        );
        if (!guardsMatch) return cb({ data: [], error: null });
        Object.assign(row, pendingUpdate);
        pendingUpdate = null;
        return cb({ data: [{ id: PKG_ID }], error: null });
      },
    };
    return chain;
  };

  // The transactional promotion. The RPC's own behaviour (locking, currency,
  // rollback) is proven against a real database in
  // `scripts/db/finalizeDefencePackage.analysis.ts`; here it stands in so the
  // BUILD JOB's ordering and outcome handling can be tested in isolation.
  const rpc = vi.fn(async () => {
    if (scenario.rpcError) return { data: null, error: scenario.rpcError };
    if (scenario.rpcResult) return { data: scenario.rpcResult, error: null };
    if (scenario.concurrentStatusAtTransition !== undefined) {
      row.status = scenario.concurrentStatusAtTransition;
      return { data: { outcome: "conflict", reason: "not_draft" }, error: null };
    }
    if (scenario.latestId && scenario.latestId !== PKG_ID) {
      return { data: { outcome: "conflict", reason: "not_current" }, error: null };
    }
    // The transaction COMMITS first — promotion, job and marker — exactly as
    // Postgres would. Only then may the reply be lost.
    row.status = "final";
    jobsInserted.push({
      job_type: "save_to_shopify",
      entity_id: "pack-1",
      dedupe_key: `dpkg-finalize:${PKG_ID}`,
    });
    if (scenario.loseResponseOnce && !responseLost) {
      responseLost = true;
      return { data: null, error: { message: "socket hang up" } };
    }
    return { data: { outcome: "promoted", package_id: PKG_ID, job_id: "job-1" }, error: null };
  });

  mockClient.mockReturnValue({ from, rpc } as never);
  return { row, packageUpdates, jobsInserted, disputeUpdates, rpc };
}

const auditsOfType = (type: string) =>
  mockAudit.mock.calls.filter((c) => (c[0] as { eventType?: string })?.eventType === type);

beforeEach(() => {
  vi.clearAllMocks();
  mockRules.mockResolvedValue({
    matchedRule: { name: "__dd_setup__:fallback:default" },
    action: { mode: "auto", pack_template_id: null },
    packTemplateId: null,
  } as never);
  mockClassify.mockReturnValue({
    approved: CLEAN_FACTS,
    internalOnly: [],
    submissionRisk: [],
    missing: [],
    manual: [],
    packageMode: "full",
    eligible: true,
    ineligibilityReason: null,
    predicateEvaluations: {},
  } as never);
  mockNarrative.mockResolvedValue({
    narrative: CLEAN_NARRATIVE,
    modelUsed: "test-model",
    promptFamily: "test-family",
    promptVersion: 10,
    tokens: { prompt: 1, completion: 1, cached: 0 },
    durationMs: 1,
  } as never);
});

describe("buildDefencePackageJob — nothing is finalized before the preflight passes", () => {
  it("a SAFE auto build persists a draft first, then finalizes exactly once", async () => {
    const { packageUpdates, jobsInserted, row } = mockSb();

    const result = await handleBuildDefencePackage(job());

    expect(result).toEqual({ ok: true });

    // The content write is a DRAFT. The `final` flip is a separate, later
    // update — which is what makes the preflight able to sit between them.
    const contentWrite = packageUpdates.find((u) => u.narrative_json !== undefined);
    expect(contentWrite?.status).toBe("draft");

    // The handler itself never writes `final`: promotion happens inside the
    // transaction, after the preflight.
    expect(packageUpdates.some((u) => u.status === "final")).toBe(false);
    expect(row.status).toBe("final");

    // Exactly one finalization audit, and it comes from the helper.
    expect(auditsOfType("defence_package_draft_generated")).toHaveLength(1);
    expect(auditsOfType("defence_package_finalized")).toHaveLength(1);
    expect(auditsOfType("defence_package_finalized")[0]?.[0]).toMatchObject({
      eventPayload: expect.objectContaining({ source: "finalize_and_enqueue_save" }),
    });

    expect(jobsInserted).toHaveLength(1);
    expect(jobsInserted[0]).toMatchObject({ job_type: "save_to_shopify", entity_id: "pack-1" });
  });

  it("an injected preflight ERROR leaves no final status, no finalization audit, no enqueue — and retries", async () => {
    const { packageUpdates, jobsInserted, row } = mockSb({
      latestError: { message: "connection reset" },
    });

    const result = await handleBuildDefencePackage(job());

    // Retriable failure, not a silent success.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retriable).toBe(true);
    expect(result.reason).toContain("defence_package_finalize_deferred");

    // The package is still the validated draft it was written as.
    expect(row.status).toBe("draft");
    expect(packageUpdates.some((u) => u.status === "final")).toBe(false);
    expect(packageUpdates.some((u) => u.status === "superseded")).toBe(false);

    expect(auditsOfType("defence_package_finalized")).toHaveLength(0);
    expect(auditsOfType("defence_package_superseded")).toHaveLength(0);
    expect(jobsInserted).toHaveLength(0);
  });

  it("a transient preflight error raises NO merchant review banner", async () => {
    const { disputeUpdates } = mockSb({ latestError: { message: "timeout" } });
    await handleBuildDefencePackage(job());
    expect(disputeUpdates.some((u) => u.attention_reason !== undefined)).toBe(false);
  });

  it("an UNSAFE narrative leaves a review-required draft and does not fail the build", async () => {
    mockNarrative.mockResolvedValue({
      narrative: UNSAFE_NARRATIVE,
      modelUsed: "test-model",
      promptFamily: "test-family",
      promptVersion: 10,
      tokens: { prompt: 1, completion: 1, cached: 0 },
      durationMs: 1,
    } as never);
    const { packageUpdates, jobsInserted, disputeUpdates, row } = mockSb();

    const result = await handleBuildDefencePackage(job());

    // The BUILD succeeded; the filing was deliberately withheld. Retrying the
    // build would produce the same package, so this is not a job failure.
    expect(result).toEqual({ ok: true });
    expect(row.status).toBe("draft");
    expect(packageUpdates.some((u) => u.status === "final")).toBe(false);
    expect(auditsOfType("defence_package_finalized")).toHaveLength(0);
    expect(jobsInserted).toHaveLength(0);

    // …and the merchant is told, because a content block IS their problem.
    expect(
      disputeUpdates.some((u) => u.attention_reason === "package_review_required"),
    ).toBe(true);
    expect(auditsOfType("defence_package_blocked_unsafe_claim")).toHaveLength(1);
    expect(auditsOfType("defence_package_blocked_unsafe_claim")[0][0]).toMatchObject({
      eventPayload: expect.objectContaining({ contentBlock: true }),
    });
  });

  it("a NON-CURRENT candidate is reported as such, not as a successful build-and-save", async () => {
    const { packageUpdates, jobsInserted, disputeUpdates } = mockSb({ latestId: "pkg-9" });

    const result = await handleBuildDefencePackage(job());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retriable).toBe(false);
    expect(result.reason).toContain("superseded_before_save");
    expect(packageUpdates.some((u) => u.status === "final")).toBe(false);
    expect(jobsInserted).toHaveLength(0);
    // Not the merchant's problem: a newer version owns the decision.
    expect(disputeUpdates.some((u) => u.attention_reason !== undefined)).toBe(false);
  });

  it("a ZERO-ROW guarded transition is propagated, not swallowed", async () => {
    // Someone else flips the row to `stale` between the preflight and the
    // promotion. The guarded UPDATE matches nothing, so this build finalized
    // nothing and must not enqueue — whoever won the transition owns that.
    const { packageUpdates, jobsInserted, disputeUpdates } = mockSb({
      concurrentStatusAtTransition: "stale",
    });

    const result = await handleBuildDefencePackage(job());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retriable).toBe(false);
    expect(result.reason).toContain("transition_conflict");

    // The UPDATE was attempted; nothing after it ran.
    expect(packageUpdates.some((u) => u.status === "superseded")).toBe(false);
    expect(auditsOfType("defence_package_finalized")).toHaveLength(0);
    expect(auditsOfType("defence_package_superseded")).toHaveLength(0);
    expect(jobsInserted).toHaveLength(0);
    // A lost race is not a merchant content problem.
    expect(disputeUpdates.some((u) => u.attention_reason !== undefined)).toBe(false);
  });

  it("review mode persists a draft and never reaches the finalize path at all", async () => {
    mockRules.mockResolvedValue({
      matchedRule: { name: "r" },
      action: { mode: "review", pack_template_id: null },
      packTemplateId: null,
    } as never);
    const { packageUpdates, jobsInserted, row } = mockSb();

    const result = await handleBuildDefencePackage(job());

    expect(result).toEqual({ ok: true });
    expect(row.status).toBe("draft");
    expect(packageUpdates.some((u) => u.status === "final")).toBe(false);
    expect(auditsOfType("defence_package_finalized")).toHaveLength(0);
    expect(jobsInserted).toHaveLength(0);
  });
});

/* ── Lost-response replay, through the WHOLE handler ──────────────────────
 *
 * A direct second call to the SQL function proves the RPC is idempotent. It
 * does NOT prove the application can reach that idempotency — and it could
 * not: `requireFinalizable` rejected an already-final candidate before the
 * RPC, and this handler returned a non-retriable failure for any non-draft
 * package. So a committed auto-finalization whose reply was lost was recorded
 * as permanently failed.
 * --------------------------------------------------------------------- */

describe("buildDefencePackageJob — a lost response is replayed, not lost", () => {
  it("commits, loses the reply, and the retried HANDLER converges on success", async () => {
    const { jobsInserted, row, packageUpdates } = mockSb({ loseResponseOnce: true });

    // 1–2. The transaction commits — one job — and the reply never arrives.
    const first = await handleBuildDefencePackage(job());
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("unreachable");
    expect(first.retriable).toBe(true);
    expect(row.status).toBe("final");
    expect(jobsInserted).toHaveLength(1);

    const auditsAfterFirst = mockAudit.mock.calls.length;

    // 3–4. The worker retries the whole handler.
    const second = await handleBuildDefencePackage(job());
    expect(second).toEqual({ ok: true });

    // 5. Exactly one save job — no duplicate.
    expect(jobsInserted).toHaveLength(1);

    // 6. No second finalization or supersession audit. (None at all here: the
    //    first attempt's reply was lost before it could write one, which is
    //    the accepted cost of a lost response — the database state is correct
    //    and the job exists; only the audit row is missing.)
    expect(mockAudit.mock.calls.length).toBe(auditsAfterFirst);
    expect(auditsOfType("defence_package_finalized")).toHaveLength(0);
    expect(auditsOfType("defence_package_superseded")).toHaveLength(0);

    // The retry did NOT rebuild: the content write happened once, on the
    // first attempt only.
    expect(packageUpdates.filter((u) => u.narrative_json !== undefined)).toHaveLength(1);
  }, 60_000);

  it("a final package with NO commit marker is still a hard refusal", async () => {
    // Not every `final` package came from a committed auto transaction — a
    // merchant may have approved it by hand. Adopting one would report work
    // this handler never did.
    const m = mockSb();
    m.row.status = "final";
    const result = await handleBuildDefencePackage(job());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retriable).toBe(false);
    expect(result.reason).toContain("is not draft");
  }, 60_000);
});
