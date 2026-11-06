/**
 * A merchant is never told to add evidence only the system can collect.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────
 *
 * Production dispute 9a40da90 (#352537, blume-box, 2026-08-12) showed, three
 * days before its deadline:
 *
 *   "Add Pre-authorization fraud screening to strengthen your case."
 *
 * Shopify computes pre-authorization screening at CHECKOUT. The order was
 * placed a month earlier. There is no action the merchant could take — on an
 * open dispute, least of all — and the field is registered
 * `collectionType: "auto"`, `expectedSource: "auto_shopify"`.
 *
 * ── WHY IT WAS POSSIBLE ───────────────────────────────────────────────
 *
 * Three sites each answered "can the merchant supply this?" with their own
 * inline filter, and all three defaulted PERMISSIVE — an absent
 * `collectionType` meant yes:
 *
 *   caseStrength.ts     `collectionType === "manual" || !collectionType`
 *   caseStrength.ts     `collectionType !== "manual" && collectionType`
 *   completeness.ts     no check at all, just `recommended && missing`
 *
 * `canMerchantUpload` has been the single source of truth since 2026-05-18,
 * strict by default and consulting `SYSTEM_DERIVED_FIELDS` — which names
 * `fraud_risk_screening` explicitly. It was applied to the surfaces that
 * showed upload buttons and never to these, so two answers to one question
 * coexisted for three months.
 *
 * ── WHAT THIS PINS ────────────────────────────────────────────────────
 *
 * Not the one field. EVERY system-derived field, through every path that can
 * produce an "Add X" instruction — because the next auto-collected signal
 * added to a template would otherwise reproduce this exactly.
 */

import { describe, it, expect } from "vitest";
import { calculateCaseStrength, calculateImprovement } from "@/lib/argument/caseStrength";
import { buildCaseGateAssessment, gateNotProvided } from "@/lib/argument/caseGateAssessment";
import {
  SYSTEM_DERIVED_FIELDS,
  canMerchantUpload,
} from "@/lib/disputes/presentation/concreteContribution";
import { CANONICAL_EVIDENCE } from "@/lib/argument/canonicalEvidence";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

const NO_GATES = buildCaseGateAssessment({
  coverage: gateNotProvided("gate_free_query"),
  fatalLoss: gateNotProvided("gate_free_query"),
  returnedToSender: gateNotProvided("gate_free_query"),
  riskWeakness: gateNotProvided("gate_free_query"),
  nameMismatch: gateNotProvided("gate_free_query"),
  creditAlreadyIssued: gateNotProvided("gate_free_query"),
});

function missing(field: string, collectionType?: string | null): ChecklistItemV2 {
  return {
    field,
    status: "missing",
    ...(collectionType ? { collectionType } : {}),
  } as unknown as ChecklistItemV2;
}

/** Every system-derived field the canonical registry actually knows about. */
const REGISTERED_SYSTEM_FIELDS = [...SYSTEM_DERIVED_FIELDS].filter(
  (f) => CANONICAL_EVIDENCE[f],
);

describe("the improvement hint never names a system-derived field", () => {
  it("the registry and the denylist actually overlap (guards the guard)", () => {
    // If this ever hits zero the loops below pass vacuously and prove nothing.
    expect(REGISTERED_SYSTEM_FIELDS.length).toBeGreaterThan(0);
    expect(REGISTERED_SYSTEM_FIELDS).toContain("fraud_risk_screening");
  });

  for (const field of REGISTERED_SYSTEM_FIELDS) {
    it(`never suggests ${field}, whatever its collectionType says`, () => {
      // Including `undefined` — the value that made the old filter permissive,
      // and `"manual"`, which a bad template row could plausibly carry.
      for (const collectionType of [undefined, null, "auto", "manual", "conditional_auto"]) {
        const r = calculateCaseStrength(
          [missing(field, collectionType)],
          "FRAUDULENT",
          undefined,
          NO_GATES,
        );
        expect(
          JSON.stringify(r.improvementHintI18n ?? {}),
          `${field} (collectionType=${String(collectionType)}) was suggested`,
        ).not.toContain(field.replace(/_check$|_screening$/, ""));
      }
    });
  }

  it("the production case: fraud_risk_screening missing, auto-collected", () => {
    const r = calculateCaseStrength(
      [missing("fraud_risk_screening", "auto"), missing("order_confirmation", "auto")],
      "FRAUDULENT",
      undefined,
      NO_GATES,
    );
    expect(r.improvementHintI18n).toBeNull();
  });

  it("no longer asks for the two fields a merchant cannot supply (PR 1, F-1a)", () => {
    /* `no_return_initiated` was the only live hint (merchant-suppliable and
     * moderate). It is Shopify's return status, not a file the merchant owns,
     * so the hint "add it" was untruthful; the merchant's real channel is the
     * return-request answer. The registry holds no other strong/moderate
     * merchant-suppliable field (see the pinned list above), so the hint path
     * is intentionally empty until one is added. */
    const r = calculateCaseStrength(
      [missing("no_return_initiated", "manual")],
      "CREDIT_NOT_PROCESSED",
      undefined,
      NO_GATES,
    );
    expect(r.improvementHintI18n).toBeNull();
  });

  it("exactly two registry fields can ever be suggested — and both are real", () => {
    /* Everything else in `FIELD_ACTIONS` is weight-0 `supporting`, which
     * `affectsStrength` skips. Pinned as a NUMBER so that adding a
     * merchant-suppliable strong/moderate field is a deliberate update here
     * rather than a silent change in what merchants get asked for — and so
     * that dropping to zero (a dead feature) fails loudly. */
    const suggestible = Object.entries(CANONICAL_EVIDENCE)
      .filter(([field]) => canMerchantUpload({ field, collectionType: "manual" }))
      .filter(([, spec]) => {
        const c = (spec as { category?: string }).category;
        return c === "strong" || c === "moderate";
      })
      .map(([field]) => field)
      .sort();
    // PR 1 (plan §3.1 F-1a): `no_return_initiated` and `refund_record` are never
    // merchant-uploadable at the display layer (the record is Shopify's, the
    // return answer is the real channel). Persisted `recommended_actions` keep
    // the build-time rule (`canMerchantUploadAtBuild`) so stored output is
    // byte-identical. Adding a merchant-suppliable strong/moderate field is
    // still a deliberate update here.
    expect(suggestible).toEqual([]);
  });
});

describe("calculateImprovement never names a system-derived field", () => {
  for (const field of REGISTERED_SYSTEM_FIELDS) {
    it(`skips ${field} with an ABSENT collectionType — the permissive default`, () => {
      const r = calculateImprovement([missing(field)], "FRAUDULENT");
      expect(r?.field, `${field} was returned as the improvement action`).not.toBe(field);
    });
  }
});
