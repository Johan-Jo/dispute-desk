/**
 * P-7 survives the switch.
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────
 *
 * CP-A activated P-7 at the live gate. CP-B/CP-C replaced that gate, on the
 * canonical route, with `decideForPack` — and `decideForPack` read
 * `completeness_score` and `auto_save_min_score` for itself, through
 * `automationPolicyFromSettings`, whose `DEFAULT_COMPLETENESS_THRESHOLD`
 * carried a comment claiming to BE P-7.
 *
 * It was not. It applied 60 to every shop carrying no `auto_save_min_score`,
 * none of which was calibrated, and it gave blume-box their own setting rather
 * than 60 whenever the setting was present — the activation, inverted. And it
 * paired that 60 with the persisted legacy column, which is the single pairing
 * `resolveEffectiveCompleteness` exists to make unrepresentable.
 *
 * Nothing failed. Both routes ran, both produced a defensible-looking number,
 * and the two disagreed only for the shops the rollout is about. Turning the
 * switch on in PR 3 would have silently reverted an activation that shipped in
 * PR 1 — and the revert would have read as "the flag is on", which it is not
 * about.
 *
 * ── WHY THE FIXTURE IS INVERTED HERE ──────────────────────────────────
 *
 * `p7CompletenessActivation.test.ts` uses canonical 72 / persisted 55, where
 * activation is what lets a pack through. This file uses the OPPOSITE pack —
 * canonical 45 / persisted 95, merchant threshold 80 — so activation is what
 * STOPS one:
 *
 *   activated     : 45 against 60 → blocks
 *   not activated : 95 against 80 → does not block on completeness
 *
 * Both numbers and both thresholds differ, and the two answers are opposite, so
 * no single half of the pair can produce the observed dispositions on its own.
 * A resolver that read the right score against the wrong threshold, or the
 * wrong score against the right threshold, fails here.
 *
 * Run through `evaluateAndMaybeAutoSave` with `CANONICAL_PIPELINE=on` — the
 * real production entry point on the real route, not the policy helper.
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

import { getServiceClient } from "@/lib/supabase/server";
import { getShopSettings } from "@/lib/automation/settings";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import { evaluateAndMaybeAutoSave } from "@/lib/automation/pipeline";
import { buildCaseAutomationDecisionInput } from "@/lib/automation/decision";
import {
  ASSESSMENT_POLICY_VERSION,
  ASSESSMENT_VERSION,
} from "@/lib/evidence/model/assessmentSnapshot";
import { CLEAN_FACTS, narrativeJson } from "@/tests/fixtures/defencePackageShapes";

const mockSb = vi.mocked(getServiceClient);
const mockSettings = vi.mocked(getShopSettings);
const mockRules = vi.mocked(evaluateRules);

const ACTIVATED_SHOP = "blume-box.myshopify.com";
const OTHER_SHOP = "cay-collective.myshopify.com";

/** Canonical says stop; legacy says go. The whole point of the fixture. */
const CANONICAL_SCORE = 45;
const PERSISTED_SCORE = 95;
const MERCHANT_THRESHOLD = 80;
const CALIBRATED_THRESHOLD = 60;

function packJson(canonicalScore = CANONICAL_SCORE) {
  return {
    case_strength: { overall: "strong" },
    coverage: { state: "not_covered" },
    fatal_loss: { triggered: false },
    case_assessment: {
      caseId: "d1",
      assessmentVersion: ASSESSMENT_VERSION,
      strength: { overall: "strong" },
      completeness: {
        score: canonicalScore,
        evidenceStrengthScore: canonicalScore,
        readiness: "ready",
        blockers: [],
      },
      gateDecision: null,
      reviewRequiredCount: 0,
      modelVersion: 1,
      freshness: {
        inputHash: "hash",
        policyVersion: ASSESSMENT_POLICY_VERSION,
        computedAt: "2026-08-10T00:00:00.000Z",
      },
    },
  };
}

function setup(opts: { shopDomain: string; canonicalScore?: number }) {
  const packRow = {
    id: "p1",
    shop_id: "s1",
    dispute_id: "d1",
    completeness_score: PERSISTED_SCORE,
    blockers: [],
    submission_readiness: "ready",
    status: "ready",
    pack_json: packJson(opts.canonicalScore),
    rebuild_pending: false,
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
            network_reason_code: null,
            status: "needs_response",
            amount: 5000,
            phase: "chargeback",
            due_at: "2026-09-01T00:00:00.000Z",
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
    if (table === "audit_events") return { insert: auditInsert };
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
  } as never);

  return { auditInsert };
}

const PRIOR = process.env.CANONICAL_PIPELINE;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CANONICAL_PIPELINE = "on";
});

afterEach(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PIPELINE;
  else process.env.CANONICAL_PIPELINE = PRIOR;
});

/* ── 0. The fixture really does discriminate ─────────────────────────── */

describe("the fixture", () => {
  it("gives the two scales OPPOSITE answers", () => {
    expect(CANONICAL_SCORE).toBeLessThan(CALIBRATED_THRESHOLD);
    expect(PERSISTED_SCORE).toBeGreaterThanOrEqual(MERCHANT_THRESHOLD);
  });
});

/* ── 1. The canonical route applies the activation ───────────────────── */

describe("with the canonical switch ON", () => {
  it("an ACTIVATED shop blocks on 45/60, quoting the canonical scale", async () => {
    /* The legacy pair would have auto-filed this pack (95 ≥ 80). Anything that
     * files here read the persisted column — which is the pre-integration
     * behaviour of `automationPolicyFromSettings`. */
    const { auditInsert } = setup({ shopDomain: ACTIVATED_SHOP });
    const r = await evaluateAndMaybeAutoSave("p1");

    expect(r.action).toBe("block");
    expect(r.details).toMatch(/score 45%/);
    expect(r.details).toMatch(/threshold 60%/);
    // Never the merchant's own number: they were not judged against it.
    expect(r.details).not.toMatch(/threshold 80%/);
    expect(r.details).not.toMatch(/score 95%/);

    const blocked = auditInsert.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((row) => row.event_type === "auto_save_blocked");
    const payload = blocked!.event_payload as Record<string, unknown>;
    expect(payload.completeness_source).toBe("canonical");
    expect(payload.completeness_score).toBe(CANONICAL_SCORE);
    expect(payload.completeness_threshold).toBe(CALIBRATED_THRESHOLD);
  });

  it("a NON-activated shop is not blocked on completeness by the same pack", async () => {
    /* Same row, same canonical 45. The only difference is the domain. If the
     * canonical route read the snapshot unconditionally, this would block
     * too — and every unactivated shop would be moved onto a scale nobody
     * calibrated for them. */
    setup({ shopDomain: OTHER_SHOP });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.details).not.toMatch(/Completeness score/);
  });

  it("the SAME activated shop passes once the canonical score clears 60", async () => {
    /* Guard the guard. Without this, the block above would be satisfiable by a
     * route that had simply started refusing blume-box. */
    setup({ shopDomain: ACTIVATED_SHOP, canonicalScore: 72 });
    const r = await evaluateAndMaybeAutoSave("p1");
    expect(r.details).not.toMatch(/Completeness score/);
  });
});

/* ── 2. The pair cannot be split at the seam ─────────────────────────── */

describe("decideForPack refuses a split pair", () => {
  const PACK = {
    id: "p1",
    dispute_id: "d1",
    completeness_score: PERSISTED_SCORE,
    blockers: [],
    submission_readiness: "ready",
    pack_json: packJson(),
  };
  const SETTINGS = {
    auto_save_enabled: true,
    auto_save_min_score: MERCHANT_THRESHOLD,
    enforce_no_blockers: true,
  };
  const EFFECTIVE = {
    score: CANONICAL_SCORE,
    threshold: CALIBRATED_THRESHOLD,
    source: "canonical" as const,
  };

  it("throws when `policy` is passed alongside `completeness`", () => {
    expect(() =>
      buildCaseAutomationDecisionInput({
        caseId: "d1",
        pack: PACK as never,
        settings: SETTINGS,
        automationMode: "auto",
        evidenceDueAt: null,
        completeness: EFFECTIVE,
        policy: {
          version: 1,
          autoSaveEnabled: true,
          completenessThreshold: MERCHANT_THRESHOLD,
          enforceNoBlockers: true,
        },
      }),
    ).toThrow(/split the pair/);
  });

  it("the effective score lands on the ASSESSMENT, so it enters the input hash", () => {
    /* Not cosmetic. A decision taken on the legacy scale and one taken on the
     * canonical scale are different decisions; if the hash could not tell them
     * apart, a persisted decision would survive the shop's activation while
     * still claiming to be current. */
    const withCanonical = buildCaseAutomationDecisionInput({
      caseId: "d1",
      pack: PACK as never,
      settings: SETTINGS,
      automationMode: "auto",
      evidenceDueAt: null,
      completeness: EFFECTIVE,
    });
    const withLegacy = buildCaseAutomationDecisionInput({
      caseId: "d1",
      pack: PACK as never,
      settings: SETTINGS,
      automationMode: "auto",
      evidenceDueAt: null,
    });

    expect(withCanonical.assessment.completeness.score).toBe(CANONICAL_SCORE);
    expect(withLegacy.assessment.completeness.score).toBe(PERSISTED_SCORE);
    expect(withCanonical.policy.completenessThreshold).toBe(CALIBRATED_THRESHOLD);
    expect(withLegacy.policy.completenessThreshold).toBe(MERCHANT_THRESHOLD);
    expect(withCanonical.assessment.freshness.inputHash).not.toBe(
      withLegacy.assessment.freshness.inputHash,
    );
  });
});
