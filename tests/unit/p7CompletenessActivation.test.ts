/**
 * P-7 is ACTIVATED, not recommended.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * The calibration report has said "blume-box at 60" since P2. Nothing read
 * it. The threshold lived in a markdown table while the live gate went on
 * comparing the persisted `completeness_score` column against the merchant's
 * own `auto_save_min_score`, and the report described that gap as P-7 being
 * "deferred / unapproved" — which it had not been since 2026-08-09.
 *
 * A statement in a report changes no disposition. So the assertions here run
 * the REAL gate path, `evaluateAndMaybeAutoSave`, and check the thing that
 * matters: the same pack, on two shops, gets two different answers, and the
 * difference is exactly the activation.
 *
 * ── THE FIXTURE IS CHOSEN TO DISCRIMINATE ─────────────────────────────
 *
 * Canonical 72 / persisted 55, merchant setting 80, calibrated threshold 60.
 *
 *   activated   : reads 72 against 60 → passes
 *   not activated: reads 55 against 80 → blocks
 *
 * Both numbers and both thresholds have to move for the pair to differ, which
 * is what makes it a test of the activation rather than of one of them. A
 * fixture where the two agree would pass whatever the wiring did.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { getServiceClient } from "@/lib/supabase/server";
import { getShopSettings } from "@/lib/automation/settings";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { evaluateAndMaybeAutoSave } from "@/lib/automation/pipeline";
import {
  activatedShopDomains,
  canonicalScoreFromPackJson,
  completenessActivationFor,
  P7_EXCLUSIONS,
} from "@/lib/evidence/model/completenessActivation";
import { CLEAN_FACTS, narrativeJson } from "@/tests/fixtures/defencePackageShapes";

const mockSb = vi.mocked(getServiceClient);
const mockSettings = vi.mocked(getShopSettings);
const mockRules = vi.mocked(evaluateRules);

const PERSISTED_SCORE = 55;
const CANONICAL_SCORE = 72;
const MERCHANT_THRESHOLD = 80;

function packJson(opts: { withAssessment: boolean }) {
  return {
    case_strength: { overall: "strong" },
    coverage: { state: "not_covered" },
    fatal_loss: { triggered: false },
    ...(opts.withAssessment
      ? {
          case_assessment: {
            caseId: "d1",
            assessmentVersion: 1,
            strength: { overall: "strong" },
            completeness: {
              score: CANONICAL_SCORE,
              evidenceStrengthScore: CANONICAL_SCORE,
              readiness: "ready",
              blockers: [],
            },
            gateDecision: null,
            reviewRequiredCount: 0,
            modelVersion: 1,
            freshness: {
              inputHash: "hash",
              policyVersion: 1,
              computedAt: "2026-08-10T00:00:00.000Z",
            },
          },
        }
      : {}),
  };
}

function setup(opts: { shopDomain: string; withAssessment?: boolean }) {
  const pj = packJson({ withAssessment: opts.withAssessment ?? true });
  const packRow = {
    id: "p1",
    shop_id: "s1",
    dispute_id: "d1",
    completeness_score: PERSISTED_SCORE,
    blockers: [],
    submission_readiness: "ready",
    status: "ready",
    pack_json: pj,
  };
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });

  const from = vi.fn((table: string) => {
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
        single: vi.fn().mockResolvedValue({
          data: {
            reason: "FRAUDULENT",
            status: "needs_response",
            amount: 5000,
            phase: "chargeback",
          },
          error: null,
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      };
    }
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { shop_domain: opts.shopDomain }, error: null }),
        single: vi
          .fn()
          .mockResolvedValue({ data: { shop_domain: opts.shopDomain }, error: null }),
      };
    }
    if (table === "defence_packages") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "pkg-1",
            version: 1,
            status: "final",
            facts_json: CLEAN_FACTS,
            narrative_json: narrativeJson({
              executiveSummary: "The carrier confirmed delivery on 12 May 2026.",
            }),
          },
          error: null,
        }),
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
  });

  mockSb.mockReturnValue({ from } as never);
  mockRules.mockResolvedValue({
    matchedRule: null,
    action: { mode: "auto", pack_template_id: null },
    packTemplateId: null,
  } as never);
  mockSettings.mockResolvedValue({
    auto_build_enabled: true,
    auto_save_enabled: true,
    auto_save_min_score: MERCHANT_THRESHOLD,
    enforce_no_blockers: true,
    require_review_before_save: false,
  } as never);
  return { jobsInsert };
}

beforeEach(() => vi.clearAllMocks());

/* ── The decision, as data ───────────────────────────────────────────── */

describe("P-7 resolves to one activated shop and one stated exclusion", () => {
  it("blume-box is activated at 60", () => {
    const a = completenessActivationFor("blume-box.myshopify.com");
    expect(a.useCanonicalScore).toBe(true);
    expect(a.threshold).toBe(60);
  });

  it("surasvenne is EXCLUDED, with the reason recorded in code", () => {
    const a = completenessActivationFor("surasvenne.myshopify.com");
    expect(a.useCanonicalScore).toBe(false);
    expect(a.threshold).toBeNull();
    // Not "pending". Recording it as deferred is what let the report claim
    // P-7 was unapproved months after it was decided.
    const why = P7_EXCLUSIONS.get("surasvenne.myshopify.com");
    expect(why).toBeTruthy();
    expect(why).toMatch(/reorder/i);
  });

  it("the activated set is exactly one shop", () => {
    // A list that may only grow silently is how a measurement decision
    // becomes a fleet rollout nobody reviewed.
    expect(activatedShopDomains()).toEqual(["blume-box.myshopify.com"]);
  });

  it("is case- and whitespace-insensitive on the domain", () => {
    expect(completenessActivationFor("  Blume-Box.myshopify.com ").threshold).toBe(60);
  });

  it("an unknown or absent shop is never activated", () => {
    expect(completenessActivationFor(null).useCanonicalScore).toBe(false);
    expect(completenessActivationFor("someone-else.myshopify.com").useCanonicalScore).toBe(
      false,
    );
  });
});

describe("canonicalScoreFromPackJson", () => {
  it("reads the persisted snapshot's completeness score", () => {
    expect(canonicalScoreFromPackJson(packJson({ withAssessment: true }))).toBe(
      CANONICAL_SCORE,
    );
  });

  it("returns null — never 0 — when the pack predates the writer", () => {
    /* The distinction is load-bearing: 0 would park every pre-activation pack
     * against a threshold it was never measured on, which is a fleet-wide
     * disposition change disguised as a default. */
    expect(canonicalScoreFromPackJson(packJson({ withAssessment: false }))).toBeNull();
    expect(canonicalScoreFromPackJson(null)).toBeNull();
    expect(canonicalScoreFromPackJson({ case_assessment: {} })).toBeNull();
  });
});

/* ── The live gate ───────────────────────────────────────────────────── */

describe("P-7 through the ACTIVE gate path", () => {
  it("guard the guard — the fixture discriminates", () => {
    /* If canonical and persisted agreed, or if either cleared both
     * thresholds, the pair below would pass no matter how the gate was
     * wired. Stated as an assertion so a later fixture edit cannot quietly
     * make this suite vacuous. */
    expect(CANONICAL_SCORE).toBeGreaterThanOrEqual(60);
    expect(CANONICAL_SCORE).toBeLessThan(MERCHANT_THRESHOLD);
    expect(PERSISTED_SCORE).toBeLessThan(60);
  });

  it("blume-box AUTO-SAVES on canonical 72 against the calibrated 60", async () => {
    setup({ shopDomain: "blume-box.myshopify.com" });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("auto_save");
  });

  it("the SAME pack on any other shop blocks on persisted 55 against 80", async () => {
    setup({ shopDomain: "someone-else.myshopify.com" });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    // The message quotes the number the gate actually compared — the
    // persisted one — so the audit trail says which scale was in force.
    expect(r.details).toContain(String(PERSISTED_SCORE));
    expect(r.details).toContain(String(MERCHANT_THRESHOLD));
  });

  it("surasvenne is on the existing path — same answer as any other shop", async () => {
    setup({ shopDomain: "surasvenne.myshopify.com" });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toContain(String(PERSISTED_SCORE));
  });

  it("an activated shop with a PRE-ACTIVATION pack falls back, it does not park on 0", async () => {
    /* The legacy pack has no `case_assessment`. Persisted 55 against the
     * calibrated 60 still blocks — but on 55, not on 0, and that is the
     * assertion: the fallback is to the real number. */
    setup({ shopDomain: "blume-box.myshopify.com", withAssessment: false });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toContain(`${PERSISTED_SCORE}%`);
    // The score it compared is 55, not 0 — asserted on the SCORE position in
    // the message, because "60%" contains "0%" and a substring check here
    // would pass on the threshold instead.
    expect(r.details).toMatch(new RegExp(`score ${PERSISTED_SCORE}%`));
    expect(r.details).not.toMatch(/score 0%/);
    // …and against the CALIBRATED threshold, not the merchant setting.
    expect(r.details).toContain("60%");
  });
});
