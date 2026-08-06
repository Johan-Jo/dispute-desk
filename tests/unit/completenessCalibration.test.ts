/**
 * Slice 2 / PR 2.0 — deterministic proofs for the read-only calibration
 * contract (`scripts/evidence-model/calibration/completenessCalibration.ts`).
 *
 * WHY THESE RUN IN CI AND THE HARNESS DOES NOT. The harness reads production
 * and lives under `vitest.analysis.config.ts`, which CI never invokes — a
 * prod-reading job must not be able to turn CI red, and CI has no prod
 * credentials. But the calibration REPORT's conclusions rest on claims about
 * the contract ("an unavailable record leaves the denominator", "a waived
 * record is satisfied and never available", "completeness cannot move when
 * strength moves"). A claim that can only be checked by running against prod
 * is a claim nobody re-checks. So the contract is proved here, offline, and
 * the harness is a thin driver over the same functions.
 *
 * Every model below is built through the REAL `deriveCaseEvidenceModel` from
 * real section shapes, not hand-authored `FieldEvidenceSummary` literals.
 * Hand-authored summaries would let a test assert whatever it liked about
 * validity and applicability; going through the derivation means the fixtures
 * are constrained by the same classifier production uses.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CANDIDATE_SEMANTICS,
  CURRENT_SEMANTICS,
  SEMANTIC_FLAGS,
  classifyTransition,
  completenessGateEligibility,
  completenessRowsFromModel,
  completenessUnderSemantics,
  dispositionPreservingThreshold,
  divergentFlags,
  gateOutcome,
  resolveShopGateSettings,
  structurallyUnusableFields,
  thresholdTradeOffs,
  withFlag,
  type BlockerReason,
  type CompletenessSemantics,
  type GateOutcome,
  type SemanticFlag,
  type TransitionClass,
} from "@/scripts/evidence-model/calibration/completenessCalibration";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import { deriveCaseAssessment } from "@/lib/evidence/model/assessment";
import type { OrderContext } from "@/lib/automation/completeness";
import type { WaivedItemRecord } from "@/lib/types/evidenceItem";
import { NO_GATES } from "@/tests/helpers/caseStrengthGates";

/* ── fixtures ─────────────────────────────────────────────────────────── */

const ORDER_CONFIRMATION = {
  source: "shopify_order",
  fieldsProvided: ["order_confirmation"],
  data: { orderName: "#1001", createdAt: "2026-07-01T10:00:00Z" },
};

/**
 * `proofType` is the quality lever. Per `categorizeEvidenceField`:
 *   signature_confirmed              → strong    (valid, decisive)
 *   delivered_confirmed + verified   → strong    (valid, decisive)
 *   delivered_confirmed              → moderate  (valid, corroborating)
 *   delivered_unverified             → supporting(valid, contextual)
 *   label_created                    → invalid   (NOT valid)
 * The first four are all VALID and differ only in quality — exactly the axis
 * completeness must be blind to.
 */
function delivery(proofType: string, deliveredToVerifiedAddress = false) {
  return {
    source: "shopify_fulfillments",
    fieldsProvided: ["delivery_proof", "shipping_tracking"],
    data: {
      proofType,
      deliveredToVerifiedAddress,
      deliveredAt: "2026-07-10T19:28:00Z",
      fulfillments: [
        { fulfillmentId: "gid://shopify/Fulfillment/1", tracking: [] },
      ],
    },
  };
}

const FULFILLED: OrderContext = {
  isFulfilled: true,
  hasCardPayment: true,
  avsCvvAvailable: true,
  hasShippingEvidence: true,
  hasRefund: true,
};

const UNFULFILLED_NO_REFUND: OrderContext = {
  isFulfilled: false,
  hasCardPayment: false,
  avsCvvAvailable: false,
  hasShippingEvidence: false,
  hasRefund: false,
};

function modelFor(args: {
  sections: unknown[];
  reason: string | null;
  orderContext?: OrderContext;
  waivedItems?: WaivedItemRecord[];
}) {
  return deriveCaseEvidenceModel({
    disputeId: "d-fixture",
    reason: args.reason,
    packId: "p-fixture",
    sections: args.sections as never,
    orderContext: args.orderContext ?? FULFILLED,
    waivedItems: args.waivedItems ?? [],
  }).model;
}

function waiver(field: string): WaivedItemRecord {
  return {
    field,
    label: "",
    reason: "evidence_unavailable",
    waivedAt: "2026-08-06T00:00:00Z",
    waivedBy: "merchant",
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 *  1. Unavailable records do not enter the denominator
 * ═══════════════════════════════════════════════════════════════════════ */

describe("candidate contract — unavailable records leave the denominator", () => {
  it("does not penalise an unfulfilled order for having no delivery proof", () => {
    // PRODUCT_NOT_RECEIVED asks for shipping_tracking + delivery_proof, both
    // `required_if_fulfilled`. On an UNFULFILLED order the order cannot
    // produce either, so neither may be counted as a gap.
    const model = modelFor({
      sections: [ORDER_CONFIRMATION],
      reason: "PRODUCT_NOT_RECEIVED",
      orderContext: UNFULFILLED_NO_REFUND,
    });

    const result = completenessUnderSemantics(model, CANDIDATE_SEMANTICS);

    expect(result.excludedUnavailable).toEqual(
      expect.arrayContaining(["shipping_tracking", "delivery_proof"]),
    );

    // The proof that they left the DENOMINATOR and not merely the display:
    // scoring the same rows with the exclusion switched off must give a
    // strictly lower score, because the two critical rows re-enter as gaps.
    const withoutExclusion = completenessUnderSemantics(model, {
      ...CANDIDATE_SEMANTICS,
      excludeUnavailableFromDenominator: false,
    });
    expect(withoutExclusion.score).toBeLessThan(result.score);
    expect(withoutExclusion.excludedUnavailable).toEqual([]);
  });

  it("an unavailable row is neither satisfied nor a gap", () => {
    const model = modelFor({
      sections: [ORDER_CONFIRMATION],
      reason: "PRODUCT_NOT_RECEIVED",
      orderContext: UNFULFILLED_NO_REFUND,
    });
    const rows = completenessRowsFromModel(model, CANDIDATE_SEMANTICS);
    const delivery = rows.find((r) => r.field === "delivery_proof");

    expect(delivery?.status).toBe("unavailable");
    // Not "available" (would inflate the numerator) and not "missing" (would
    // inflate the denominator AND nag the merchant for evidence they cannot
    // obtain). Both errors were measured at ~30 points against prod.
    expect(delivery?.status).not.toBe("available");
    expect(delivery?.status).not.toBe("missing");
  });

  it("an order that CAN produce the field still counts it as a gap", () => {
    const model = modelFor({
      sections: [ORDER_CONFIRMATION],
      reason: "PRODUCT_NOT_RECEIVED",
      orderContext: FULFILLED,
    });
    const rows = completenessRowsFromModel(model, CANDIDATE_SEMANTICS);
    expect(rows.find((r) => r.field === "delivery_proof")?.status).toBe(
      "missing",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  2. Waived counts as satisfied, never as available
 * ═══════════════════════════════════════════════════════════════════════ */

describe("candidate contract — waived is satisfied, never available", () => {
  const base = () =>
    modelFor({
      sections: [ORDER_CONFIRMATION],
      reason: "PRODUCT_NOT_RECEIVED",
      orderContext: FULFILLED,
    });

  const waived = () =>
    modelFor({
      sections: [ORDER_CONFIRMATION],
      reason: "PRODUCT_NOT_RECEIVED",
      orderContext: FULFILLED,
      waivedItems: [waiver("delivery_proof")],
    });

  it("raises the completeness score exactly as satisfying the row would", () => {
    const before = completenessUnderSemantics(base(), CANDIDATE_SEMANTICS);
    const after = completenessUnderSemantics(waived(), CANDIDATE_SEMANTICS);
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.satisfiedByWaiver).toContain("delivery_proof");
  });

  it("never reports the waived field as available", () => {
    const rows = completenessRowsFromModel(waived(), CANDIDATE_SEMANTICS);
    const row = rows.find((r) => r.field === "delivery_proof");
    expect(row?.status).toBe("waived");
    expect(row?.status).not.toBe("available");
  });

  it("does not raise evidenceStrengthScore — waiving conjures no evidence", () => {
    // The load-bearing distinction. `evidenceStrengthScore` counts `available`
    // rows only, so a merchant who dismissed a request must not see the
    // surface say the evidence exists. Folding the two together is how a UI
    // ends up claiming "Delivery evidence available" about a dispute where
    // nothing was ever collected.
    const before = completenessUnderSemantics(base(), CANDIDATE_SEMANTICS);
    const after = completenessUnderSemantics(waived(), CANDIDATE_SEMANTICS);
    expect(after.evidenceStrengthScore).toBe(before.evidenceStrengthScore);
  });

  it("the model itself never marks a waived-only field available", () => {
    const model = waived();
    expect(model.fields.delivery_proof.status.waived).not.toBeNull();
    expect(model.fields.delivery_proof.status.available).toBe(false);
    expect(model.fields.delivery_proof.status.satisfied).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  3. Completeness is independent of case strength
 * ═══════════════════════════════════════════════════════════════════════ */

describe("candidate contract — completeness is independent of strength", () => {
  // All four are VALID and differ only in quality (decisive / corroborating /
  // contextual). Completeness must be identical across the set.
  const VALID_QUALITY_VARIANTS: [string, boolean][] = [
    ["signature_confirmed", false],
    ["delivered_confirmed", true],
    ["delivered_confirmed", false],
    ["delivered_unverified", false],
  ];

  it("is unchanged across the full valid-quality cross-product", () => {
    const scores = VALID_QUALITY_VARIANTS.map(([proofType, verified]) => {
      const model = modelFor({
        sections: [ORDER_CONFIRMATION, delivery(proofType, verified)],
        reason: "PRODUCT_NOT_RECEIVED",
        orderContext: FULFILLED,
      });
      return completenessUnderSemantics(model, CANDIDATE_SEMANTICS).score;
    });
    expect(new Set(scores).size).toBe(1);
  });

  it("the same variants DO move case strength — so the fixture has real range", () => {
    // Without this, the test above would pass vacuously if the fixtures all
    // happened to grade the same. This is the control, and it asserts on the
    // weighted `score` rather than `overall`: the band is a coarse bucket, and
    // a fixture set that moves the underlying evidence weight without crossing
    // a band boundary is still a genuine strength difference that completeness
    // must ignore.
    const strengths = VALID_QUALITY_VARIANTS.map(([proofType, verified]) => {
      const sections = [ORDER_CONFIRMATION, delivery(proofType, verified)];
      const model = modelFor({
        sections,
        reason: "PRODUCT_NOT_RECEIVED",
        orderContext: FULFILLED,
      });
      const quality = model.fields.delivery_proof.quality;
      const { strength } = deriveCaseAssessment({
        model,
        gates: NO_GATES,
        // The scorer re-derives a conditional field's category from its
        // payload; with `undefined` it collapses every delivery proof to the
        // registry's best case and the control would measure nothing.
        payloadSource: {
          kind: "list",
          items: sections.map((s) => ({
            payload: { fieldsProvided: s.fieldsProvided, ...s.data },
          })),
        },
      });
      return { quality, score: strength.score };
    });

    // The quality axis has range...
    expect(new Set(strengths.map((s) => s.quality)).size).toBeGreaterThan(1);
    // ...and it reaches the scorer.
    expect(new Set(strengths.map((s) => s.score)).size).toBeGreaterThan(1);
  });

  it("VALIDITY, not quality, is the boundary completeness does see", () => {
    // `label_created` is `invalid` — a parsed payload carrying no assertion.
    // The candidate contract says such a record does not satisfy its row. This
    // is not a strength judgement: an `invalid` record proves nothing at any
    // band, whereas a `contextual` record is weak and perfectly real.
    const valid = modelFor({
      sections: [ORDER_CONFIRMATION, delivery("delivered_unverified")],
      reason: "PRODUCT_NOT_RECEIVED",
      orderContext: FULFILLED,
    });
    const invalid = modelFor({
      sections: [ORDER_CONFIRMATION, delivery("label_created")],
      reason: "PRODUCT_NOT_RECEIVED",
      orderContext: FULFILLED,
    });

    expect(
      completenessUnderSemantics(invalid, CANDIDATE_SEMANTICS).score,
    ).toBeLessThan(completenessUnderSemantics(valid, CANDIDATE_SEMANTICS).score);

    // ...and under TODAY's semantics the two are indistinguishable, which is
    // precisely the defect the candidate corrects: a label with no delivery
    // counts exactly like a confirmed one.
    expect(completenessUnderSemantics(invalid, CURRENT_SEMANTICS).score).toBe(
      completenessUnderSemantics(valid, CURRENT_SEMANTICS).score,
    );
  });

  it("the projection source reads no strength or quality symbol", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "scripts/evidence-model/calibration/completenessCalibration.ts",
      ),
      "utf-8",
    );
    // Structural, not aspirational: the function body may not mention the
    // quality axis at all. `.quality`, the strength scorer, and the assessment
    // layer are all absent by construction.
    const body = src.slice(
      src.indexOf("export function completenessRowsFromModel"),
      src.indexOf("export interface CompletenessUnderSemantics"),
    );
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/\.quality/);
    expect(body).not.toMatch(/calculateCaseStrength/);
    expect(src).not.toMatch(/from "@\/lib\/argument\/caseStrength"/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  4. Per-shop thresholds are read, never invented
 * ═══════════════════════════════════════════════════════════════════════ */

describe("per-shop thresholds are read from the shop's own settings", () => {
  it("reads each shop's actual auto_save_min_score", () => {
    expect(
      resolveShopGateSettings({
        auto_save_enabled: true,
        auto_save_min_score: 60,
        enforce_no_blockers: true,
      }),
    ).toEqual({
      autoSaveEnabled: true,
      autoSaveMinScore: 60,
      enforceNoBlockers: true,
    });

    expect(
      resolveShopGateSettings({
        auto_save_enabled: true,
        auto_save_min_score: 50,
        enforce_no_blockers: false,
      })?.autoSaveMinScore,
    ).toBe(50);
  });

  it("returns null rather than defaulting when the row is absent or null", () => {
    // A quiet default is the worst available failure mode here: 0 clears every
    // pack, so the report would show a clean fleet and conclude the change is
    // safe. Null forces the caller into `missing_shop_settings`.
    expect(resolveShopGateSettings(null)).toBeNull();
    expect(resolveShopGateSettings(undefined)).toBeNull();
    expect(
      resolveShopGateSettings({ auto_save_enabled: true, auto_save_min_score: null }),
    ).toBeNull();
    expect(resolveShopGateSettings({})).toBeNull();
  });

  it("the gate uses the shop's threshold, not a shared constant", () => {
    const args = {
      score: 55,
      readiness: "ready" as const,
      blockers: [] as string[],
    };
    expect(
      gateOutcome({
        ...args,
        settings: {
          autoSaveEnabled: true,
          autoSaveMinScore: 50,
          enforceNoBlockers: true,
        },
      }),
    ).toBe("auto_save");
    expect(
      gateOutcome({
        ...args,
        settings: {
          autoSaveEnabled: true,
          autoSaveMinScore: 60,
          enforceNoBlockers: true,
        },
      }),
    ).toBe("block");
  });

  it("a shop with auto-save disabled never opens the gate at any score", () => {
    expect(
      gateOutcome({
        score: 100,
        readiness: "ready",
        blockers: [],
        settings: {
          autoSaveEnabled: false,
          autoSaveMinScore: 0,
          enforceNoBlockers: true,
        },
      }),
    ).toBe("block");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  5. Eligible and ineligible populations are separated
 * ═══════════════════════════════════════════════════════════════════════ */

describe("completeness-gate eligibility", () => {
  const NO_GUARDS = {
    coverageState: null,
    fatalLoss: null,
    caseStrength: "strong",
    creditAlreadyIssued: null,
  };

  it("Strong in auto mode reaches the gate", () => {
    expect(
      completenessGateEligibility({ ruleMode: "auto", guards: NO_GUARDS }),
    ).toEqual({ eligible: true, reason: null, path: "strong" });
  });

  it("a fully-covering prior credit reaches the gate on its own branch", () => {
    const result = completenessGateEligibility({
      ruleMode: "auto",
      guards: {
        ...NO_GUARDS,
        caseStrength: "weak",
        creditAlreadyIssued: { triggered: true, coversDisputedAmount: true },
      },
    });
    // Named branch, not inherited from the Strength floor — the whole point of
    // `creditAlreadyIssued` being its own required guard input.
    expect(result.eligible).toBe(true);
    expect(result.path).toBe("credit");
  });

  it("separates a legacy pack with no recorded strength from a Strong one", () => {
    // `evaluateAutoSubmitGuards` returns `proceed` for BOTH. Counting them
    // together would report a fleet of Strong packs where in fact one shop's
    // entire eligible population predates `pack_json.case_strength` — a
    // materially weaker basis for a threshold recommendation, and exactly what
    // the first run of the prod harness mislabelled.
    const legacy = completenessGateEligibility({
      ruleMode: "auto",
      guards: { ...NO_GUARDS, caseStrength: null },
    });
    expect(legacy.eligible).toBe(true);
    expect(legacy.path).toBe("legacy_no_strength");
    expect(legacy.path).not.toBe("strong");
  });

  it("review mode never reaches the gate", () => {
    expect(
      completenessGateEligibility({ ruleMode: "review", guards: NO_GUARDS }),
    ).toEqual({ eligible: false, reason: "rule_mode_review", path: null });
  });

  it.each([
    ["covered_shopify", { ...NO_GUARDS, coverageState: "covered_shopify" }],
    ["fatal_loss", { ...NO_GUARDS, fatalLoss: { triggered: true } }],
    ["moderate_strength", { ...NO_GUARDS, caseStrength: "moderate" }],
    ["weak", { ...NO_GUARDS, caseStrength: "weak" }],
    ["insufficient", { ...NO_GUARDS, caseStrength: "insufficient" }],
  ])("%s never reaches the gate", (reason, guards) => {
    const result = completenessGateEligibility({ ruleMode: "auto", guards });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it("a partial credit does NOT open the credited branch", () => {
    const result = completenessGateEligibility({
      ruleMode: "auto",
      guards: {
        ...NO_GUARDS,
        caseStrength: "weak",
        creditAlreadyIssued: { triggered: true, coversDisputedAmount: false },
      },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("weak");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  6. Transition classification is exhaustive
 * ═══════════════════════════════════════════════════════════════════════ */

describe("transition classification", () => {
  const CLASSES: TransitionClass[] = [
    "current_wrong_corrected",
    "current_correct_preserved",
    "intended_policy_change_requires_approval",
    "unresolved_blocker",
  ];

  const OUTCOMES: (GateOutcome | null)[] = ["auto_save", "block", null];
  const BLOCKERS: BlockerReason[][] = [
    [],
    ["missing_shop_settings"],
    ["missing_pack_sections"],
    ["unparseable_checklist"],
  ];

  it("a flip leaning on a structurally-unusable field is a blocker, not a finding", () => {
    // The live case: `orderSource.ts:113` encodes "billing address matches" by
    // PUSHING the field into `fieldsProvided`, while `categorizeEvidenceField`
    // asks for `p.match === true` — a key no collector writes. The field is
    // therefore `invalid` on every pack that has it (measured 2026-08-06: 95
    // collected, 0 valid). Reporting that as "the usable-evidence rule
    // corrected a wrong decision" would sell a collector bug as a completeness
    // finding, and a maintainer could lower a threshold to compensate for it.
    const verdict = classifyTransition({
      currentOutcome: "auto_save",
      reconstructedOutcome: "auto_save",
      candidateOutcome: "block",
      singleFlagOutcomes: { requireUsableEvidence: "block" },
      missingInputs: [],
      usableEvidenceAttributionContaminated: true,
    });
    expect(verdict.classification).toBe("unresolved_blocker");
    expect(verdict.blockerReason).toBe("suspected_collector_contract_defect");

    // Same input, uncontaminated → the correction it would otherwise be.
    expect(
      classifyTransition({
        currentOutcome: "auto_save",
        reconstructedOutcome: "auto_save",
        candidateOutcome: "block",
        singleFlagOutcomes: { requireUsableEvidence: "block" },
        missingInputs: [],
        usableEvidenceAttributionContaminated: false,
      }).classification,
    ).toBe("current_wrong_corrected");
  });

  it("contamination does not hijack a flip that field never caused", () => {
    // Only a flip ATTRIBUTED to usable-evidence is contaminated by it.
    expect(
      classifyTransition({
        currentOutcome: "auto_save",
        reconstructedOutcome: "auto_save",
        candidateOutcome: "block",
        singleFlagOutcomes: {
          requireUsableEvidence: "auto_save",
          excludeNotApplicable: "block",
        },
        missingInputs: [],
        usableEvidenceAttributionContaminated: true,
      }).classification,
    ).toBe("intended_policy_change_requires_approval");
  });

  it("classifies the entire input cross-product — nothing is left unclassified", () => {
    // The instruction's hard requirement: no transition may remain
    // unclassified. Proven by enumeration rather than asserted, over every
    // combination of the three outcomes, the missing-input set, and every
    // subset of single-flag attributions.
    const flagSubsets: Partial<Record<SemanticFlag, GateOutcome>>[] = [];
    for (let mask = 0; mask < 1 << SEMANTIC_FLAGS.length; mask += 1) {
      for (const outcome of ["auto_save", "block"] as GateOutcome[]) {
        const entry: Partial<Record<SemanticFlag, GateOutcome>> = {};
        SEMANTIC_FLAGS.forEach((flag, i) => {
          if (mask & (1 << i)) entry[flag] = outcome;
        });
        flagSubsets.push(entry);
      }
    }

    let checked = 0;
    for (const currentOutcome of OUTCOMES) {
      for (const reconstructedOutcome of OUTCOMES) {
        for (const candidateOutcome of OUTCOMES) {
          for (const missingInputs of BLOCKERS) {
            for (const singleFlagOutcomes of flagSubsets) {
              for (const contaminated of [true, false, undefined]) {
                const verdict = classifyTransition({
                  currentOutcome,
                  reconstructedOutcome,
                  candidateOutcome,
                  singleFlagOutcomes,
                  missingInputs,
                  usableEvidenceAttributionContaminated: contaminated,
                });
                expect(CLASSES).toContain(verdict.classification);
                expect(Array.isArray(verdict.causes)).toBe(true);
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(
      OUTCOMES.length ** 3 * BLOCKERS.length * flagSubsets.length * 3,
    );
  });

  it("an unchanged outcome is current_correct_preserved", () => {
    expect(
      classifyTransition({
        currentOutcome: "auto_save",
        reconstructedOutcome: "auto_save",
        candidateOutcome: "auto_save",
        singleFlagOutcomes: {},
        missingInputs: [],
      }).classification,
    ).toBe("current_correct_preserved");
  });

  it("a flip attributable to usable-evidence ALONE is current_wrong_corrected", () => {
    const verdict = classifyTransition({
      currentOutcome: "auto_save",
      reconstructedOutcome: "auto_save",
      candidateOutcome: "block",
      singleFlagOutcomes: {
        requireUsableEvidence: "block",
        excludeNotApplicable: "auto_save",
      },
      missingInputs: [],
    });
    expect(verdict.classification).toBe("current_wrong_corrected");
    expect(verdict.causes).toEqual(["requireUsableEvidence"]);
  });

  it("a flip involving any other flag requires approval", () => {
    expect(
      classifyTransition({
        currentOutcome: "auto_save",
        reconstructedOutcome: "auto_save",
        candidateOutcome: "block",
        singleFlagOutcomes: {
          requireUsableEvidence: "auto_save",
          excludeNotApplicable: "block",
        },
        missingInputs: [],
      }).classification,
    ).toBe("intended_policy_change_requires_approval");
  });

  it("a flip no single flag explains requires approval, never a guess", () => {
    // Flag interaction. The conservative bucket wins: the harness does not
    // invent an attribution it cannot demonstrate, and it does not call an
    // unexplained flip a correction.
    const verdict = classifyTransition({
      currentOutcome: "auto_save",
      reconstructedOutcome: "auto_save",
      candidateOutcome: "block",
      singleFlagOutcomes: {
        requireUsableEvidence: "auto_save",
        excludeNotApplicable: "auto_save",
      },
      missingInputs: [],
    });
    expect(verdict.classification).toBe(
      "intended_policy_change_requires_approval",
    );
    expect(verdict.causes).toEqual([]);
  });

  it("a harness that cannot reproduce today's outcome reports a blocker", () => {
    const verdict = classifyTransition({
      currentOutcome: "auto_save",
      reconstructedOutcome: "block",
      candidateOutcome: "block",
      singleFlagOutcomes: {},
      missingInputs: [],
    });
    expect(verdict.classification).toBe("unresolved_blocker");
    expect(verdict.blockerReason).toBe(
      "harness_cannot_reproduce_current_engine",
    );
  });

  it("a missing input is a blocker and never a silent classification", () => {
    const verdict = classifyTransition({
      currentOutcome: "auto_save",
      reconstructedOutcome: "auto_save",
      candidateOutcome: "auto_save",
      singleFlagOutcomes: {},
      missingInputs: ["missing_shop_settings"],
    });
    // Note the outcomes all AGREE here — without the missing-input check this
    // would have been reported as a clean `current_correct_preserved`, hiding
    // the fact that the threshold used was fabricated.
    expect(verdict.classification).toBe("unresolved_blocker");
    expect(verdict.blockerReason).toBe("missing_shop_settings");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  7. Read-only and deterministic
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the harness is read-only and deterministic", () => {
  const CALIBRATION = "scripts/evidence-model/calibration/completenessCalibration.ts";
  const HARNESS = "scripts/evidence-model/completenessThreshold.analysis.ts";

  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

  it("neither file performs a write, an enqueue, or a mutation", () => {
    // The prohibition is structural, not a promise in a docstring. PostgREST
    // writes go through these verbs and nothing else; a job enqueue is an
    // insert into `jobs`.
    const forbidden = [
      /\.insert\s*\(/,
      /\.update\s*\(/,
      /\.upsert\s*\(/,
      /\.delete\s*\(/,
      /\.rpc\s*\(/,
      /method\s*:\s*["'](POST|PATCH|PUT|DELETE)["']/i,
      /getServiceClient/,
      /createClient/,
    ];
    for (const file of [CALIBRATION, HARNESS]) {
      const src = read(file);
      for (const pattern of forbidden) {
        expect(
          pattern.test(src),
          `${file} must not match ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it("the calibration contract does no I/O at all", () => {
    const src = read(CALIBRATION);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/from "fs"/);
    expect(src).not.toMatch(/process\.env/);
  });

  it("the same model scores identically on repeated evaluation", () => {
    const model = modelFor({
      sections: [ORDER_CONFIRMATION, delivery("delivered_confirmed", true)],
      reason: "PRODUCT_NOT_RECEIVED",
      orderContext: FULFILLED,
    });
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(completenessUnderSemantics(model, CANDIDATE_SEMANTICS)),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("row order is stable, so a diff of two runs is meaningful", () => {
    const model = modelFor({
      sections: [ORDER_CONFIRMATION, delivery("delivered_confirmed", true)],
      reason: "PRODUCT_NOT_RECEIVED",
      orderContext: FULFILLED,
    });
    const a = completenessRowsFromModel(model, CANDIDATE_SEMANTICS).map(
      (r) => r.field,
    );
    const b = completenessRowsFromModel(model, CANDIDATE_SEMANTICS).map(
      (r) => r.field,
    );
    expect(a).toEqual(b);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 *  8. Semantics bookkeeping and threshold arithmetic
 * ═══════════════════════════════════════════════════════════════════════ */

describe("structural collector/categorizer defect detection", () => {
  it("flags a field collected often and never valid", () => {
    const stats = new Map([
      // The measured shape of `billing_address_match` on 2026-08-06.
      ["billing_address_match", { collected: 95, valid: 0 }],
      // Low but non-zero — payload-dependent, so genuinely weak evidence and
      // NOT a contract defect. Must not be flagged.
      ["fraud_risk_screening", { collected: 85, valid: 7 }],
      ["order_confirmation", { collected: 112, valid: 112 }],
    ]);
    const flagged = structurallyUnusableFields(stats);
    expect([...flagged]).toEqual(["billing_address_match"]);
  });

  it("ignores a field seen too rarely to tell a defect from a bad payload", () => {
    const stats = new Map([["tds_authentication", { collected: 2, valid: 0 }]]);
    expect(structurallyUnusableFields(stats).size).toBe(0);
    // ...but honours an explicit lower bar when the caller wants one.
    expect(structurallyUnusableFields(stats, 1).size).toBe(1);
  });

  it("never flags a field that is sometimes valid, however rarely", () => {
    const stats = new Map([["x", { collected: 1000, valid: 1 }]]);
    expect(structurallyUnusableFields(stats).size).toBe(0);
  });
});

describe("semantics bookkeeping", () => {
  it("current and candidate differ on exactly the two documented flags", () => {
    // If a future edit adds a third difference, this fails — and the report's
    // attribution section, which enumerates two causes, becomes incomplete.
    expect(divergentFlags(CURRENT_SEMANTICS, CANDIDATE_SEMANTICS).sort()).toEqual(
      ["excludeNotApplicable", "requireUsableEvidence"],
    );
  });

  it("withFlag changes exactly one flag", () => {
    const result: CompletenessSemantics = withFlag(
      CURRENT_SEMANTICS,
      "requireUsableEvidence",
      CANDIDATE_SEMANTICS,
    );
    expect(result.requireUsableEvidence).toBe(true);
    expect(result.excludeNotApplicable).toBe(
      CURRENT_SEMANTICS.excludeNotApplicable,
    );
  });
});

describe("threshold arithmetic", () => {
  it("finds the highest disposition-preserving threshold when one exists", () => {
    const packs = [
      { currentScore: 90, candidateScore: 70 }, // files today
      { currentScore: 80, candidateScore: 65 }, // files today
      { currentScore: 40, candidateScore: 30 }, // blocked today
    ];
    // Weakest passer scores 65; strongest blocked scores 30 → 65 is safe.
    expect(dispositionPreservingThreshold(packs, 60)).toBe(65);
  });

  it("returns null when the candidate REORDERS rather than rescales", () => {
    const packs = [
      { currentScore: 90, candidateScore: 47 }, // files today, scores low
      { currentScore: 40, candidateScore: 48 }, // blocked today, scores higher
    ];
    // No threshold can keep both. The harness reports the conflict; it does
    // not silently pick a side.
    expect(dispositionPreservingThreshold(packs, 60)).toBeNull();
  });

  it("enumerates the trade-off at every real decision boundary", () => {
    const packs = [
      { currentScore: 90, candidateScore: 47 },
      { currentScore: 40, candidateScore: 48 },
    ];
    const rows = thresholdTradeOffs(packs, 60);
    expect(rows.map((r) => r.threshold)).toEqual([47, 48, 60]);
    for (const row of rows) {
      expect(row.newlyAutoFiles + row.newlyBlocks + row.preserved).toBe(
        packs.length,
      );
    }
    // At 47 both packs clear it: the one that files today keeps filing, and
    // the one blocked today newly files.
    expect(rows[0]).toEqual({
      threshold: 47,
      newlyAutoFiles: 1,
      newlyBlocks: 0,
      preserved: 1,
    });
  });
});
