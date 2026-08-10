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
  ASSESSMENT_POLICY_VERSION,
  ASSESSMENT_VERSION,
} from "@/lib/evidence/model/assessmentSnapshot";
import {
  activatedShopDomains,
  canonicalScoreFromPackJson,
  completenessActivationFor,
  resolveEffectiveCompleteness,
  P7_EXCLUSIONS,
} from "@/lib/evidence/model/completenessActivation";
import { CLEAN_FACTS, narrativeJson } from "@/tests/fixtures/defencePackageShapes";

const mockSb = vi.mocked(getServiceClient);
const mockSettings = vi.mocked(getShopSettings);
const mockRules = vi.mocked(evaluateRules);

const PERSISTED_SCORE = 55;
const CANONICAL_SCORE = 72;
const MERCHANT_THRESHOLD = 80;

function packJson(opts: {
  withAssessment: boolean;
  policyVersion?: number;
  assessmentVersion?: number;
  canonicalScore?: number;
}) {
  return {
    case_strength: { overall: "strong" },
    coverage: { state: "not_covered" },
    fatal_loss: { triggered: false },
    ...(opts.withAssessment
      ? {
          case_assessment: {
            caseId: "d1",
            assessmentVersion: opts.assessmentVersion ?? ASSESSMENT_VERSION,
            strength: { overall: "strong" },
            completeness: {
              score: opts.canonicalScore ?? CANONICAL_SCORE,
              evidenceStrengthScore: opts.canonicalScore ?? CANONICAL_SCORE,
              readiness: "ready",
              blockers: [],
            },
            gateDecision: null,
            reviewRequiredCount: 0,
            modelVersion: 1,
            freshness: {
              inputHash: "hash",
              policyVersion: opts.policyVersion ?? ASSESSMENT_POLICY_VERSION,
              computedAt: "2026-08-10T00:00:00.000Z",
            },
          },
        }
      : {}),
  };
}

function setup(opts: {
  shopDomain: string;
  withAssessment?: boolean;
  persistedScore?: number;
  blockers?: string[];
  readiness?: string;
  merchantThreshold?: number;
  rebuildPending?: boolean;
  policyVersion?: number;
  canonicalScore?: number;
}) {
  const pj = packJson({
    withAssessment: opts.withAssessment ?? true,
    policyVersion: opts.policyVersion,
    canonicalScore: opts.canonicalScore,
  });
  const packRow = {
    id: "p1",
    shop_id: "s1",
    dispute_id: "d1",
    completeness_score: opts.persistedScore ?? PERSISTED_SCORE,
    blockers: opts.blockers ?? [],
    submission_readiness: opts.readiness ?? "ready",
    status: "ready",
    pack_json: pj,
    rebuild_pending: opts.rebuildPending ?? false,
  };
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const auditInsert = vi.fn().mockResolvedValue({ data: null, error: null });

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
      return { insert: auditInsert };
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
    auto_save_min_score: opts.merchantThreshold ?? MERCHANT_THRESHOLD,
    enforce_no_blockers: true,
    require_review_before_save: false,
  } as never);
  return { jobsInsert, auditInsert };
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

  it("an activated shop with a PRE-ACTIVATION pack falls back on BOTH values", async () => {
    /* The legacy pack has no `case_assessment`, so the whole legacy pair
     * applies: persisted 55 against the MERCHANT threshold 80.
     *
     * This assertion was previously the other way round — 55 against the
     * calibrated 60 — which is precisely the illegal pairing. A legacy score
     * judged on a threshold calibrated for the canonical scale silently lowers
     * the bar for every pack the rebuild has not reached yet. */
    setup({ shopDomain: "blume-box.myshopify.com", withAssessment: false });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    // The score compared is 55, not 0 — matched on the SCORE position, because
    // "60%" contains "0%" and a bare substring check would pass on a threshold.
    expect(r.details).toMatch(new RegExp(`score ${PERSISTED_SCORE}%`));
    expect(r.details).not.toMatch(/score 0%/);
    // …and against the MERCHANT threshold. 60 was never in force here.
    expect(r.details).toMatch(new RegExp(`threshold ${MERCHANT_THRESHOLD}%`));
    expect(r.details).not.toMatch(/threshold 60%/);
  });
});


/* ── The atomic pair ─────────────────────────────────────────────────── */

describe("score and threshold are ONE decision", () => {
  it("canonical snapshot on an activated shop → canonical score + 60", () => {
    const e = resolveEffectiveCompleteness({
      shopDomain: "blume-box.myshopify.com",
      packJson: packJson({ withAssessment: true }),
      rebuildPending: false,
      persistedScore: PERSISTED_SCORE,
      merchantThreshold: MERCHANT_THRESHOLD,
    });
    expect(e).toEqual({ score: CANONICAL_SCORE, threshold: 60, source: "canonical" });
  });

  it("NO canonical snapshot on an activated shop → persisted score + MERCHANT threshold", () => {
    /* THE illegal pairing this object exists to prevent: a legacy score
     * against the calibrated 60. Resolving the two lookups separately makes it
     * representable, and it silently lowers the bar for every pack the rebuild
     * has not reached yet. */
    const e = resolveEffectiveCompleteness({
      shopDomain: "blume-box.myshopify.com",
      packJson: packJson({ withAssessment: false }),
      rebuildPending: false,
      persistedScore: 70,
      merchantThreshold: 80,
    });
    expect(e).toEqual({ score: 70, threshold: 80, source: "legacy" });
    expect(e.threshold).not.toBe(60);
  });

  it("a non-activated shop is legacy on both, even with a canonical snapshot", () => {
    const e = resolveEffectiveCompleteness({
      shopDomain: "someone-else.myshopify.com",
      packJson: packJson({ withAssessment: true }),
      rebuildPending: false,
      persistedScore: PERSISTED_SCORE,
      merchantThreshold: MERCHANT_THRESHOLD,
    });
    expect(e).toEqual({
      score: PERSISTED_SCORE,
      threshold: MERCHANT_THRESHOLD,
      source: "legacy",
    });
  });

  it("no combination yields a legacy score against the calibrated threshold", () => {
    /* Exhaustive over the two axes that produce the pairing: activated or not,
     * canonical snapshot present or not. Four cases, and the illegal pair must
     * appear in none. */
    for (const shopDomain of ["blume-box.myshopify.com", "someone-else.myshopify.com"]) {
      for (const withAssessment of [true, false]) {
        const e = resolveEffectiveCompleteness({
          shopDomain,
          packJson: packJson({ withAssessment }),
          rebuildPending: false,
          persistedScore: 70,
          merchantThreshold: 80,
        });
        const illegal = e.source === "legacy" && e.threshold === 60;
        expect(illegal, `${shopDomain} withAssessment=${withAssessment}`).toBe(false);
      }
    }
  });
});

/* ── The discriminating legacy pack, through the live gate ───────────── */

describe("a LEGACY pack on Blume Box is judged on 70/80, never 70/60", () => {
  /* The fixture is chosen so the two pairings disagree about the outcome:
   *
   *   70 against 80 (legacy, correct)     → BLOCKED
   *   70 against 60 (the illegal pairing) → auto-saved
   *
   * Anything that reads `blocked` here is reading the legacy pair. */
  it("blocks, and the message quotes 70 and 80", async () => {
    setup({
      shopDomain: "blume-box.myshopify.com",
      withAssessment: false,
      persistedScore: 70,
      merchantThreshold: 80,
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toMatch(/score 70%/);
    expect(r.details).toMatch(/threshold 80%/);
    // The calibrated threshold must not appear: it was never in force.
    expect(r.details).not.toMatch(/threshold 60%/);
  });

  it("is NEVER auto-saved — the illegal pairing would have let it through", async () => {
    setup({
      shopDomain: "blume-box.myshopify.com",
      withAssessment: false,
      persistedScore: 70,
      merchantThreshold: 80,
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).not.toBe("auto_save");
  });

  it("the audit row records 70, 80 and source=legacy", async () => {
    const { auditInsert } = setup({
      shopDomain: "blume-box.myshopify.com",
      withAssessment: false,
      persistedScore: 70,
      merchantThreshold: 80,
    });
    await evaluateAndMaybeAutoSave("p1");
    const blocked = auditInsert.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((row) => row.event_type === "auto_save_blocked");
    expect(blocked, "no auto_save_blocked audit row").toBeTruthy();
    const payload = blocked!.event_payload as Record<string, unknown>;
    expect(payload.completeness_score).toBe(70);
    expect(payload.completeness_threshold).toBe(80);
    expect(payload.completeness_source).toBe("legacy");
  });
});

/* ── The canonical decision leaves the canonical numbers behind ──────── */

describe("a CANONICAL 72/60 decision records 72 and 60", () => {
  /* The persisted column still says 55 on this pack. If the audit row recorded
   * 55, the trail would claim the gate compared a number it never saw — and
   * during the rollout the two scales differ by -7...+17, so that is not a
   * cosmetic difference.
   *
   * The case is made to BLOCK on blockers rather than on completeness, so the
   * canonical pair is resolved, used, and still has an audit row to be read
   * from. */
  it("records the canonical score and the calibrated threshold, not the persisted score", async () => {
    const { auditInsert } = setup({
      shopDomain: "blume-box.myshopify.com",
      withAssessment: true,
      blockers: ["missing_delivery_proof"],
      readiness: "blocked",
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");

    const blocked = auditInsert.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((row) => row.event_type === "auto_save_blocked");
    expect(blocked, "no auto_save_blocked audit row").toBeTruthy();
    const payload = blocked!.event_payload as Record<string, unknown>;
    expect(payload.completeness_source).toBe("canonical");
    expect(payload.completeness_score).toBe(CANONICAL_SCORE);
    expect(payload.completeness_threshold).toBe(60);
    // The persisted score is NOT what decided, and must not be recorded as if
    // it were.
    expect(payload.completeness_score).not.toBe(PERSISTED_SCORE);
  });

  it("the passing canonical path writes no blocked row at all", async () => {
    const { auditInsert } = setup({
      shopDomain: "blume-box.myshopify.com",
      withAssessment: true,
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("auto_save");
    const blocked = auditInsert.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((row) => row.event_type === "auto_save_blocked");
    expect(blocked).toBeUndefined();
  });
});


/* ── An UNUSABLE canonical snapshot falls back atomically ────────────── */

describe("a stale canonical score is never judged against 60", () => {
  /* The fixture is chosen so the two answers disagree:
   *
   *   canonical 95 against 60  → auto-saves
   *   persisted 70 against 80  → blocks
   *
   * Anything that auto-saves here used a stale canonical score at the
   * calibrated threshold — the illegal pairing, reached through a door
   * `resolveEffectiveCompleteness` did not previously close: it checked only
   * that a canonical number EXISTED, not whether it was usable. */
  const STALE_CANONICAL = 95;

  it("SUPERSEDED POLICY: blocks on 70/80/legacy, not 95/60", async () => {
    const { auditInsert } = setup({
      shopDomain: "blume-box.myshopify.com",
      canonicalScore: STALE_CANONICAL,
      policyVersion: ASSESSMENT_POLICY_VERSION - 1,
      persistedScore: 70,
      merchantThreshold: 80,
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toMatch(/score 70%/);
    expect(r.details).toMatch(/threshold 80%/);
    expect(r.details).not.toMatch(/threshold 60%/);
    expect(r.details).not.toMatch(new RegExp(`score ${STALE_CANONICAL}%`));

    const blocked = auditInsert.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((row) => row.event_type === "auto_save_blocked");
    const payload = blocked!.event_payload as Record<string, unknown>;
    expect(payload.completeness_source).toBe("legacy");
    expect(payload.completeness_score).toBe(70);
    expect(payload.completeness_threshold).toBe(80);
  });

  it("REBUILD PENDING: blocks on 70/80/legacy, not 95/60", async () => {
    const { auditInsert } = setup({
      shopDomain: "blume-box.myshopify.com",
      canonicalScore: STALE_CANONICAL,
      rebuildPending: true,
      persistedScore: 70,
      merchantThreshold: 80,
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("block");
    expect(r.details).toMatch(/score 70%/);
    expect(r.details).toMatch(/threshold 80%/);

    const blocked = auditInsert.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((row) => row.event_type === "auto_save_blocked");
    const payload = blocked!.event_payload as Record<string, unknown>;
    expect(payload.completeness_source).toBe("legacy");
    expect(payload.completeness_score).toBe(70);
  });

  it("guard the guard — the SAME canonical 95 auto-saves once it is usable", async () => {
    /* Without this the two cases above would be satisfiable by a resolver
     * that had simply stopped reading canonical scores at all. The only
     * difference here is that the snapshot is current. */
    setup({
      shopDomain: "blume-box.myshopify.com",
      canonicalScore: STALE_CANONICAL,
      persistedScore: 70,
      merchantThreshold: 80,
    });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.action).toBe("auto_save");
  });

  it("a CURRENT canonical snapshot still resolves 72/60/canonical", async () => {
    const e = resolveEffectiveCompleteness({
      shopDomain: "blume-box.myshopify.com",
      packJson: packJson({ withAssessment: true }),
      rebuildPending: false,
      persistedScore: PERSISTED_SCORE,
      merchantThreshold: MERCHANT_THRESHOLD,
    });
    expect(e).toEqual({ score: CANONICAL_SCORE, threshold: 60, source: "canonical" });
  });

  it("neither unusable form yields the calibrated threshold", () => {
    for (const over of [
      { policyVersion: ASSESSMENT_POLICY_VERSION - 1 },
      { assessmentVersion: ASSESSMENT_VERSION + 1 },
    ]) {
      const e = resolveEffectiveCompleteness({
        shopDomain: "blume-box.myshopify.com",
        packJson: packJson({ withAssessment: true, ...over }),
        rebuildPending: false,
        persistedScore: 70,
        merchantThreshold: 80,
      });
      expect(e).toEqual({ score: 70, threshold: 80, source: "legacy" });
    }
    const pending = resolveEffectiveCompleteness({
      shopDomain: "blume-box.myshopify.com",
      packJson: packJson({ withAssessment: true }),
      rebuildPending: true,
      persistedScore: 70,
      merchantThreshold: 80,
    });
    expect(pending).toEqual({ score: 70, threshold: 80, source: "legacy" });
  });
});
