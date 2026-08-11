/**
 * ACTIVATION PARITY — behavioural, through the four real production entry
 * points.
 *
 * ── WHY THE SOURCE-LEVEL GUARDS ARE NOT ENOUGH ────────────────────────
 *
 * `branchBoundary.test.ts` proves each legacy module is reached only behind
 * `canonicalPipelineEnabled()`. That is a statement about the SHAPE of the
 * dispatch, and it would keep passing if the legacy module itself had drifted,
 * if a caller passed it different arguments, or if a side effect were added
 * outside the branch. None of those are hypothetical in a change that touches
 * five entry points.
 *
 * So this file does the other half: it RUNS each entry point, with the switch
 * off, on fixtures whose kickoff-baseline disposition is documented and
 * pinned — and then runs the same fixture with the switch on and asserts the
 * canonical route differs ONLY where the contract revisions say it must.
 *
 * ── WHAT "THE BASELINE" MEANS HERE ────────────────────────────────────
 *
 * The dispositions asserted on the OFF side are the ones `develop @58e15806`
 * produces, and they are the same ones `lib/automation/__tests__/
 * pipelineMatrix.test.ts` has pinned since before this epic — PRD §9's matrix.
 * They are restated rather than imported so that a change to the matrix suite
 * cannot silently move what "unchanged" means.
 *
 * ── THE TWO DIRECTIONS, AND WHY BOTH ARE ASSERTED ─────────────────────
 *
 * A parity suite that only checks OFF proves the dark period is safe and says
 * nothing about whether the canonical route is wired at all. Every case below
 * therefore asserts both sides, and where they agree that agreement is itself
 * the assertion — a switch that changed everything would be as wrong as one
 * that changed nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/automation/settings", () => ({ getShopSettings: vi.fn() }));
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
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/featureFlags", () => ({ isDefencePackageBuilderEnabled: () => true }));
vi.mock("@/lib/cron/envGate", () => ({ cronEnvGate: () => null }));
vi.mock("@/lib/email/sendDefenceDeadlineFallbackAlert", () => ({
  sendDefenceDeadlineFallbackAlert: vi.fn().mockResolvedValue({ ok: true }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { getShopSettings } from "@/lib/automation/settings";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { evaluateAndMaybeAutoSave } from "@/lib/automation/pipeline";
import { decideForPack } from "@/lib/automation/decision";
import { resolveHeldState } from "@/lib/disputes/heldState";
import { resolveHeldStateLegacy } from "@/lib/disputes/heldState.legacy";
import {
  CANONICAL_PIPELINE_ENV,
  CANONICAL_PIPELINE_ON,
} from "@/lib/pipeline/activation";
import {
  CLEAN_FACTS,
  CLEAN_NARRATIVE,
  healthyPackJson,
} from "@/tests/fixtures/defencePackageShapes";
import { derivePlanIdentityForPack } from "@/lib/defence/package";
import { GET as deadlineCron } from "@/app/api/cron/defence-package-deadline-submit/route";
import { NextRequest } from "next/server";
import { reconcileParkedAutoDisputes } from "@/lib/automation/reconcileParkedAutoDisputes";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockGetShopSettings = vi.mocked(getShopSettings);
const mockEvaluateRules = vi.mocked(evaluateRules);

/* ── Harness ─────────────────────────────────────────────────────────── */

const DISPUTE_ID = "d1";
const PACK_ID = "p1";

function packJsonFor(strength: string, over: Record<string, unknown> = {}) {
  return healthyPackJson({ case_strength: { overall: strength }, ...over });
}

/**
 * The canonical identity the fixture's package carries.
 *
 * Computed with the shipped derivation so the canonical side sees a CURRENT
 * package. A stale fixture would make every ON assertion pass for the wrong
 * reason — "nothing was filed" is not evidence of a gate when the package was
 * never fileable.
 */
function identityFor(packJson: Record<string, unknown>) {
  return derivePlanIdentityForPack({
    caseId: DISPUTE_ID,
    packId: PACK_ID,
    packJson,
    evidenceItems: [],
    checklist: [],
    disputeReason: "FRAUDULENT",
    networkReasonCode: null,
  });
}

function candidateRow(packJson: Record<string, unknown>) {
  const identity = identityFor(packJson);
  return {
    id: "pkg-1",
    version: 1,
    status: "final",
    validation_status: "ok",
    pdf_path: "p.pdf",
    content_revision: "11111111-1111-4111-8111-111111111111",
    superseded_by_id: null,
    failure_code: null,
    facts_json: CLEAN_FACTS,
    narrative_json: CLEAN_NARRATIVE,
    plan_input_hash: identity.planInputHash,
    plan_policy_version: identity.policyVersion,
    plan_deadline_only: identity.plan.deadlineOnly,
    document_validation_passed: true,
    document_failure_codes: [],
  };
}

function buildSb(opts: {
  packJson: Record<string, unknown>;
  completeness?: number;
  readiness?: string | null;
  blockers?: string[];
}) {
  const packRow = {
    id: PACK_ID,
    shop_id: "s1",
    dispute_id: DISPUTE_ID,
    completeness_score: opts.completeness ?? 90,
    blockers: opts.blockers ?? [],
    submission_readiness: opts.readiness ?? "ready",
    status: "ready",
    pack_json: opts.packJson,
    checklist_v2: [],
  };
  const disputeRow = {
    reason: "FRAUDULENT",
    network_reason_code: null,
    status: "needs_response",
    amount: 5000,
    phase: "chargeback",
    due_at: new Date(Date.now() + 5 * 86400000).toISOString(),
  };
  const rows = [candidateRow(opts.packJson)];
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });

  const sb = {
    from: vi.fn((table: string) => {
      if (table === "evidence_packs") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: packRow, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
      }
      if (table === "disputes") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: disputeRow, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
      }
      if (table === "defence_packages") {
        // Serves BOTH shapes: the legacy path's `.limit(1).maybeSingle()` and
        // the canonical path's awaited `.order(...)` list. Serving both from
        // one mock is what makes an off/on comparison a comparison of the
        // ROUTE rather than of two differently-stubbed worlds.
        const q: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: rows[0], error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        };
        // `.order(...)` must be BOTH awaitable (the canonical list read) and
        // chainable into `.limit(1).maybeSingle()` (the legacy single read).
        // A thenable that also carries the chain methods serves both without
        // the two paths seeing different data.
        q.order = vi.fn(() => {
          const p = Promise.resolve({ data: rows, error: null }) as Promise<unknown> &
            Record<string, unknown>;
          p.limit = q.limit;
          p.maybeSingle = q.maybeSingle;
          p.eq = q.eq;
          return p;
        });
        return q;
      }
      if (table === "evidence_items") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === "audit_events") {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }
      if (table === "jobs") return { insert: jobsInsert };
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
    }),
  };
  return { sb, jobsInsert };
}

function setup(opts: Parameters<typeof buildSb>[0] & { ruleMode?: "auto" | "review" }) {
  const built = buildSb(opts);
  mockGetServiceClient.mockReturnValue(built.sb as never);
  mockEvaluateRules.mockResolvedValue({
    matchedRule: null,
    action: { mode: opts.ruleMode ?? "auto", pack_template_id: null },
    packTemplateId: null,
  } as never);
  mockGetShopSettings.mockResolvedValue({
    auto_build_enabled: true,
    auto_save_enabled: true,
    auto_save_min_score: 80,
    enforce_no_blockers: true,
    require_review_before_save: false,
  } as never);
  return built;
}

async function off<T>(fn: () => Promise<T>): Promise<T> {
  delete process.env[CANONICAL_PIPELINE_ENV];
  return fn();
}
async function on<T>(fn: () => Promise<T>): Promise<T> {
  process.env[CANONICAL_PIPELINE_ENV] = CANONICAL_PIPELINE_ON;
  try {
    return await fn();
  } finally {
    delete process.env[CANONICAL_PIPELINE_ENV];
  }
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => delete process.env[CANONICAL_PIPELINE_ENV]);

/* ── 1. The pack pipeline ────────────────────────────────────────────── */

/**
 * PRD §9's matrix, as `develop @58e15806` produces it. Restated here rather
 * than imported: if this list could move with the implementation it would stop
 * being a baseline.
 */
const BASELINE_PIPELINE: Array<{ strength: string; action: string }> = [
  { strength: "strong", action: "auto_save" },
  { strength: "moderate", action: "park_for_review" },
  { strength: "weak", action: "block" },
  { strength: "insufficient", action: "block" },
];

describe("activation OFF — the pack pipeline reproduces the kickoff baseline", () => {
  for (const { strength, action } of BASELINE_PIPELINE) {
    it(`${strength} → ${action}`, async () => {
      setup({ packJson: packJsonFor(strength) });
      const r = await off(() => evaluateAndMaybeAutoSave(PACK_ID));
      expect(r.action).toBe(action);
    });
  }

  it("a below-threshold completeness still blocks, on the gate's own reason", async () => {
    setup({ packJson: packJsonFor("strong"), completeness: 40 });
    const r = await off(() => evaluateAndMaybeAutoSave(PACK_ID));
    expect(r.action).toBe("block");
    expect(r.details).toContain("40%");
  });

  it("review mode parks regardless of strength", async () => {
    setup({ packJson: packJsonFor("strong"), ruleMode: "review" });
    const r = await off(() => evaluateAndMaybeAutoSave(PACK_ID));
    expect(r.action).toBe("park_for_review");
  });
});

describe("activation ON — the pipeline differs ONLY where revision 2 says", () => {
  it("strong still auto-files: the switch is not a global refusal", async () => {
    setup({ packJson: packJsonFor("strong") });
    const r = await on(() => evaluateAndMaybeAutoSave(PACK_ID));
    expect(r.action).toBe("auto_save");
  });

  it("moderate still parks", async () => {
    setup({ packJson: packJsonFor("moderate") });
    const r = await on(() => evaluateAndMaybeAutoSave(PACK_ID));
    expect(r.action).toBe("park_for_review");
  });

  for (const strength of ["weak", "insufficient"]) {
    it(`${strength} — the pipeline's OWN answer is unchanged, and that is correct`, async () => {
      /* A finding worth stating plainly rather than asserting around.
       *
       * Revision 2 does NOT change what this entry point returns for a weak
       * case. It still answers `block`, and it should: this function's `block`
       * means "auto-save did not happen at build time", which is as true after
       * the revision as before. The pack is still a validated draft, and the
       * deadline path still owns what happens to it.
       *
       * What revision 2 changed is the DECISION underneath — `block` with
       * `strength_insufficient` became `hold_for_deadline` with the same
       * reason code — and that is observable at the deadline cron and in the
       * decision object, not here. Asserting a difference here would have
       * forced a behaviour change nobody asked for, into the one entry point
       * where the old answer was already right. */
      setup({ packJson: packJsonFor(strength) });
      const offResult = await off(() => evaluateAndMaybeAutoSave(PACK_ID));
      setup({ packJson: packJsonFor(strength) });
      const onResult = await on(() => evaluateAndMaybeAutoSave(PACK_ID));
      expect(offResult.action).toBe("block");
      expect(onResult.action).toBe("block");
    });
  }

  for (const strength of ["weak", "insufficient"]) {
    it(`${strength} strength alone never produces a HARD BLOCK in the decision`, async () => {
      /* The property the pipeline's local `block` must not be mistaken for.
       *
       * `hard_block` is an HONESTY condition — coverage/concession,
       * fatal-loss, an unsafe claim — and the selector refuses it on BOTH
       * triggers. If the strength floor produced one, a weak case could never
       * be filed at the deadline either, and revision 2 would be a rename.
       *
       * So: the canonical decision for a weak case holds, names strength, and
       * names no hard block. Read from the decision the entry points share,
       * not from a re-derivation. */
      const decision = decideForPack({
        caseId: DISPUTE_ID,
        pack: {
          id: PACK_ID,
          dispute_id: DISPUTE_ID,
          completeness_score: 90,
          blockers: [],
          submission_readiness: "ready",
          pack_json: packJsonFor(strength),
        },
        settings: {
          auto_save_enabled: true,
          auto_save_min_score: 80,
          enforce_no_blockers: true,
        },
        automationMode: "auto",
        evidenceDueAt: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(decision.action).toBe("hold_for_deadline");
      expect(decision.reasonCodes).toContain("strength_insufficient");
      expect(decision.reasonCodes).not.toContain("hard_block");
      expect(decision.reasonCodes).not.toContain("fatal_loss");
      expect(decision.reasonCodes).not.toContain("coverage_active");
    });
  }

  it("guard the guard — a REAL hard block does produce one", () => {
    // Without this, the four `not.toContain` assertions above would pass on a
    // decision that never emits `hard_block` at all.
    const decision = decideForPack({
      caseId: DISPUTE_ID,
      pack: {
        id: PACK_ID,
        dispute_id: DISPUTE_ID,
        completeness_score: 90,
        blockers: ["missing_delivery_proof"],
        submission_readiness: "blocked",
        pack_json: packJsonFor("strong"),
      },
      settings: {
        auto_save_enabled: true,
        auto_save_min_score: 80,
        enforce_no_blockers: true,
      },
      automationMode: "auto",
      evidenceDueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(decision.action).toBe("block");
    expect(decision.reasonCodes).toContain("hard_block");
  });

  it("a hard block is still a hard block on BOTH sides", async () => {
    // Coverage is the honesty condition revision 2 explicitly did not touch.
    const covered = packJsonFor("strong", {
      coverage: { state: "covered_shopify" },
    });
    setup({ packJson: covered });
    const offResult = await off(() => evaluateAndMaybeAutoSave(PACK_ID));
    setup({ packJson: covered });
    const onResult = await on(() => evaluateAndMaybeAutoSave(PACK_ID));
    expect(offResult.action).toBe("skip_covered");
    expect(onResult.action).toBe("skip_covered");
  });
});

/* ── 2. The held-state resolver ──────────────────────────────────────── */

describe("activation OFF — resolveHeldState is byte-identical to the baseline", () => {
  /**
   * Exhaustive rather than sampled. The input space is small enough to
   * enumerate, and this is the resolver three merchant surfaces render from —
   * a single disagreeing combination is a merchant told the wrong thing about
   * their case.
   */
  const STRENGTHS = ["strong", "moderate", "weak", "insufficient", null, "bogus"];
  const COVERAGE = [undefined, "not_covered", "covered_shopify"];
  const FATAL = [null, { triggered: false }, { triggered: true, reason: "refund_issued" }];
  const MODES = ["auto", "review", null] as const;

  it("every combination agrees with the moved implementation", () => {
    let compared = 0;
    for (const caseStrength of STRENGTHS) {
      for (const coverageState of COVERAGE) {
        for (const fatalLoss of FATAL) {
          for (const automationMode of MODES) {
            const input = {
              caseStrength,
              coverageState,
              fatalLoss,
              creditAlreadyIssued: null,
              automationMode,
              acknowledgement: {
                merchantSuppliedAcknowledgement: false,
                submissionState: null,
                finalOutcome: null,
              },
            } as Parameters<typeof resolveHeldState>[0];
            const live = process.env[CANONICAL_PIPELINE_ENV];
            expect(live).toBeUndefined();
            expect(resolveHeldState(input), JSON.stringify(input)).toEqual(
              resolveHeldStateLegacy(input),
            );
            compared += 1;
          }
        }
      }
    }
    // Guard the guard: a loop that compared nothing would pass silently.
    expect(compared).toBe(
      STRENGTHS.length * COVERAGE.length * FATAL.length * MODES.length,
    );
  });
});

describe("activation ON — resolveHeldState carries revision 2's reason mapping", () => {
  const base = {
    coverageState: "not_covered",
    fatalLoss: null,
    creditAlreadyIssued: null,
    automationMode: "auto" as const,
    acknowledgement: {
      merchantSuppliedAcknowledgement: false,
      submissionState: null,
      finalOutcome: null,
    },
  };

  it("weak is held for the SAME reason on both sides, through different actions", async () => {
    const input = { ...base, caseStrength: "weak" } as Parameters<
      typeof resolveHeldState
    >[0];
    const legacy = resolveHeldStateLegacy(input);
    const canonical = await on(async () => resolveHeldState(input));
    // The merchant-visible answer is identical; what changed underneath is
    // that `weak` reaches it through `hold_for_deadline` rather than `block`.
    expect(legacy).toEqual({
      held: true,
      reason: "weak_strength",
      offer: "cardholder_acknowledgement",
      offerFlipsToStrong: false,
    });
    expect(canonical).toEqual(legacy);
  });

  it("a covered case is NOT held on either side", async () => {
    const input = {
      ...base,
      caseStrength: "moderate",
      coverageState: "covered_shopify",
    } as Parameters<typeof resolveHeldState>[0];
    const canonical = await on(async () => resolveHeldState(input));
    expect(resolveHeldStateLegacy(input).held).toBe(false);
    expect(canonical.held).toBe(false);
  });
});


/* ── 3. The deadline cron ────────────────────────────────────────────── */

/**
 * The cron needs a dispute LIST query the pipeline harness does not, so it
 * gets its own client. Everything else — the pack, the candidate, the plan
 * identity — is the same fixture, so an off/on difference is the route and not
 * two differently-stubbed worlds.
 */
function buildCronSb(packJson: Record<string, unknown>) {
  const rows = [candidateRow(packJson)];
  const rpc = vi.fn(async () => ({
    data: { outcome: "enqueued", job_id: "job-1" },
    error: null,
  }));
  const dispute = {
    id: DISPUTE_ID,
    shop_id: "s1",
    dispute_gid: "gid://shopify/ShopifyPaymentsDispute/1",
    reason: "FRAUDULENT",
    network_reason_code: null,
    amount: 100,
    currency_code: "USD",
    due_at: new Date().toISOString(),
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
            id: PACK_ID,
            status: "ready",
            completeness_score: 90,
            blockers: [],
            submission_readiness: "ready",
            pack_json: packJson,
            checklist_v2: [],
          },
          error: null,
        }),
      };
    }
    if (table === "defence_packages") {
      const q: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: rows[0], error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      };
      q.order = vi.fn(() => {
        const pr = Promise.resolve({ data: rows, error: null }) as Promise<unknown> &
          Record<string, unknown>;
        pr.limit = q.limit;
        pr.maybeSingle = q.maybeSingle;
        return pr;
      });
      return q;
    }
    if (table === "evidence_items") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    if (table === "jobs") {
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  mockGetServiceClient.mockReturnValue({ from, rpc } as never);
  mockGetShopSettings.mockResolvedValue({
    auto_build_enabled: true,
    auto_save_enabled: true,
    auto_save_min_score: 60,
    enforce_no_blockers: true,
  } as never);
  return { rpc };
}

const cronReq = () =>
  new NextRequest("https://x.test/api/cron/defence-package-deadline-submit");

describe("activation OFF/ON — the deadline cron, and the R3 gap it closes", () => {
  it("OFF: a COVERED case is still filed — the gap, reproduced", async () => {
    /* R3, stated as behaviour rather than as prose. The shipped route consults
     * no coverage, no strength, no completeness and no guards: it takes the
     * latest candidate and files it. A Shopify-Protect case — one the pipeline
     * refuses to auto-save all day — is filed at 08:00 UTC.
     *
     * This is the baseline. Asserting it is what makes "the canonical route
     * refuses it" below a measured change rather than a claim. */
    buildCronSb(packJsonFor("strong", { coverage: { state: "covered_shopify" } }));
    const body = await (await off(async () => deadlineCron(cronReq()))).json();
    expect(body.enqueuedSubmit).toBe(1);
    expect(body.enqueuedFallback).toBe(0);
  });

  it("ON: the same COVERED case is not filed, and the merchant is told", async () => {
    buildCronSb(packJsonFor("strong", { coverage: { state: "covered_shopify" } }));
    const body = await (await on(async () => deadlineCron(cronReq()))).json();
    expect(body.enqueuedSubmit).toBe(0);
    expect(body.enqueuedFallback).toBe(1);
  });

  it("ON: a WEAK case IS filed — revision 2, at the actual submitter", async () => {
    /* The other direction, and the one that matters most: the canonical route
     * is not simply stricter. Strength is an odds judgement and odds never
     * withhold a filing, so a weak-but-safe case still goes at the deadline. A
     * route that refused it would hand the issuer Shopify own scrape instead
     * of our letter and call that caution. */
    buildCronSb(packJsonFor("weak"));
    const body = await (await on(async () => deadlineCron(cronReq()))).json();
    expect(body.enqueuedSubmit).toBe(1);
    expect(body.enqueuedFallback).toBe(0);
  });

  it("OFF: a weak case is filed too — so weak alone proves nothing here", async () => {
    // Stated explicitly: at the cron, weak is where off and on AGREE, for
    // different reasons. The coverage case above is the discriminator.
    buildCronSb(packJsonFor("weak"));
    const body = await (await off(async () => deadlineCron(cronReq()))).json();
    expect(body.enqueuedSubmit).toBe(1);
  });
});


/* ── 4. The parked-auto reconcile pass ───────────────────────────────── */

/**
 * The reconcile pass runs when a merchant flips a rule to auto, and promotes
 * cases the pipeline previously parked. Its off/on difference is not a
 * disposition but a POPULATION: the shipped pass hard-filters
 * `strength === "strong"` BEFORE it counts `scanned`, so a moderate case is
 * invisible to it; the canonical pass resolves the mode first and lets one
 * decision answer, so the same case is scanned and then declined.
 *
 * That difference is returned to the caller and shown in ops tooling, which is
 * exactly why it cannot be allowed to land silently.
 */
function buildReconcileSb(strength: string, completeness = 90) {
  const rows = [candidateRow(packJsonFor(strength))];
  const from = vi.fn((table: string) => {
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({
          data: [
            {
              id: DISPUTE_ID,
              reason: "FRAUDULENT",
              status: "needs_response",
              amount: 100,
              phase: "chargeback",
              due_at: new Date(Date.now() + 86400000).toISOString(),
            },
          ],
          error: null,
        }),
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
            id: PACK_ID,
            status: "ready",
            shop_id: "s1",
            completeness_score: completeness,
            blockers: [],
            submission_readiness: "ready",
            pack_json: packJsonFor(strength),
          },
          error: null,
        }),
      };
    }
    if (table === "defence_packages") {
      const q: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: rows[0], error: null }),
      };
      q.order = vi.fn(() => {
        const pr = Promise.resolve({ data: rows, error: null }) as Promise<unknown> &
          Record<string, unknown>;
        pr.limit = q.limit;
        pr.maybeSingle = q.maybeSingle;
        return pr;
      });
      return q;
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
  mockGetServiceClient.mockReturnValue({ from } as never);
  mockGetShopSettings.mockResolvedValue({
    auto_build_enabled: true,
    auto_save_enabled: true,
    auto_save_min_score: 60,
    enforce_no_blockers: true,
  } as never);
  mockEvaluateRules.mockResolvedValue({
    matchedRule: null,
    action: { mode: "auto", pack_template_id: null },
    packTemplateId: null,
  } as never);
}

describe("activation OFF/ON — the reconcile pass counts a different population", () => {
  /* A STRONG case below the completeness threshold is the discriminator.
   *
   * The shipped pass counts it — `scanned` is incremented right after the
   * strong-only pre-filter, before any gate runs — and then declines it. The
   * canonical pass asks the decision first, gets `block`
   * (`below_completeness_threshold`), and never counts it. Same outcome, and
   * `scanned` means two different things.
   *
   * A moderate case would NOT show this: both sides answer 0, for different
   * reasons. Choosing the fixture that discriminates is the whole exercise. */
  it("OFF: a below-threshold STRONG case is counted as scanned, then declined", async () => {
    buildReconcileSb("strong", 40);
    const r = await off(() => reconcileParkedAutoDisputes("s1"));
    expect(r.scanned).toBe(1);
    expect(r.reconciled).toBe(0);
  });

  it("ON: the same case is never counted — the decision declines before the count", async () => {
    buildReconcileSb("strong", 40);
    const r = await on(() => reconcileParkedAutoDisputes("s1"));
    expect(r.scanned).toBe(0);
    expect(r.reconciled).toBe(0);
  });

  it("the count moved; the OUTCOME did not — nothing is promoted on either side", async () => {
    buildReconcileSb("strong", 40);
    const offResult = await off(() => reconcileParkedAutoDisputes("s1"));
    buildReconcileSb("strong", 40);
    const onResult = await on(() => reconcileParkedAutoDisputes("s1"));
    expect(offResult.reconciled).toBe(onResult.reconciled);
    expect(offResult.disputeIds).toEqual(onResult.disputeIds);
    // Guard the guard: if neither side scanned anything the pair would agree
    // vacuously and prove nothing.
    expect(offResult.scanned).not.toBe(onResult.scanned);
  });

  it("a MODERATE case answers 0 on both sides — stated so the fixture choice is visible", async () => {
    buildReconcileSb("moderate");
    const offResult = await off(() => reconcileParkedAutoDisputes("s1"));
    buildReconcileSb("moderate");
    const onResult = await on(() => reconcileParkedAutoDisputes("s1"));
    expect(offResult.scanned).toBe(0);
    expect(onResult.scanned).toBe(0);
  });
});
