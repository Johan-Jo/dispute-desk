/**
 * The demo fixtures must speak the CURRENT workspace contract.
 *
 * ── WHY THIS TEST EXISTS ──────────────────────────────────────────────
 *
 * `/demo` renders the REAL embedded components against canned JSON from
 * `lib/demo/fetchShim.ts`. When a contract changes, nothing in the demo
 * fails loudly: the shim's catch-all returns `{}` with a `console.warn`,
 * `useDisputeWorkspace` treats a missing `workspaceAssessment` as
 * `needsRecalculation`, and the status cells fall back to the legacy
 * normalized-status Badge. All three are correct behaviours for real
 * missing data — and all three are silent.
 *
 * That is exactly how the demo shipped to a live URL with a blank
 * Review & Submit tab and pre-redesign status pills: CP-A
 * (`16fec827`/`0f394a42`) and the presentation model (PR#410) both landed
 * without the fixtures, and no test or type error said so.
 *
 * These assertions are the alarm that was missing. They do not test the
 * product — they test that the DEMO still speaks the product's language.
 */

import { describe, it, expect } from "vitest";
import { buildWorkspaceData } from "@/lib/demo/fixtures/workspaceData";
import { buildDemoPresentation } from "@/lib/demo/fixtures/presentation";
import { DEMO_DISPUTES } from "@/lib/demo/fixtures/disputes";
import { resolveAssessmentGate } from "@/lib/disputes/assessmentPresence";
import { LIFECYCLE_CHIP } from "@/lib/disputes/presentation/uiTokens";
import { classifyEvidenceRow } from "@/lib/argument/categoryBadge";

const gateFor = (wa: any) =>
  resolveAssessmentGate({
    needsRecalculation: wa.assessment.needsRecalculation,
    recalculationReason: wa.assessment.recalculationReason,
  });

describe("demo workspace assessment", () => {
  it("assessed fixtures render a verdict, a recommendation and a filing action", () => {
    for (const id of ["dp-2401", "dp-2402", "dp-2403", "dp-2406"]) {
      // dp-2406 is the deliberately WEAK fixture (WEAK_PAYLOADS: no AVS code,
      // no proof type) so it correctly contributes no strong/moderate signals.
      const expectsContributions = id !== "dp-2406";
      const wa: any = (buildWorkspaceData(id) as any).workspaceAssessment;
      const gate = gateFor(wa);
      expect(gate.mayRenderVerdict, id).toBe(true);
      expect(gate.mayRenderRecommendation, id).toBe(true);
      expect(gate.mayOfferFilingAction, id).toBe(true);
      const contribs = wa.contributions.strong.length + wa.contributions.moderate.length;
      if (expectsContributions) {
        expect(contribs, `${id} contributions`).toBeGreaterThan(0);
      } else {
        expect(contribs, `${id} contributions`).toBe(0);
      }
      console.log(id, "band:", wa.caseStrength.overall, "| hero:", wa.caseStrength.heroVariant,
        "| readiness:", wa.readiness, "| contribs:", contribs);
    }
  });

  it("covered + fatal-loss are NOT reported as assessed", () => {
    for (const id of ["dp-2404", "dp-2405"]) {
      const wa: any = (buildWorkspaceData(id) as any).workspaceAssessment;
      expect(wa.assessment.needsRecalculation, id).toBe(true);
      const gate = gateFor(wa);
      expect(gate.mayRenderVerdict, id).toBe(false);
      expect(gate.mayOfferFilingAction, id).toBe(false);
      console.log(id, "→ not_assessed, presence:", gate.presence);
    }
  });
});

describe("demo presentation", () => {
  it("every fixture resolves a lifecycle chip that has render tokens", () => {
    for (const d of DEMO_DISPUTES) {
      const p = buildDemoPresentation(d);
      expect(LIFECYCLE_CHIP[p.lifecycle], `${d.id} chip`).toBeTruthy();
      console.log(d.id, "→", p.lifecycle, "| attention:", p.attention,
        "| strength:", p.strength, "| mode:", p.automationMode);
    }
  });
});

describe("demo evidence badges are plausible", () => {
  /**
   * The "Evidence collected" pill comes from `classifyEvidenceRow`, driven by
   * the fixture payloads. An earlier payload table set every promotable flag
   * at once to force a Strong headline, and the rubric duly rendered SIX
   * Strong rows on dp-2401 -- including two policy documents, which no real
   * fraud case produces.
   *
   * Strong must mean DECISIVE. These assertions pin that: a published policy
   * is not proof the customer accepted it, and account context on a shipped
   * physical order is corroboration rather than proof.
   */
  it("a published policy is not Strong without acceptance at checkout", () => {
    const d: any = buildWorkspaceData("dp-2401");
    for (const field of ["refund_policy", "shipping_policy"]) {
      const cls = classifyEvidenceRow({
        fieldKey: field,
        status: "available",
        payload: d.pack.evidenceItemsByField[field]?.payload ?? null,
      });
      expect(cls.category, `${field} on dp-2401`).not.toBe("strong");
    }
  });

  it("account context on a shipped physical order is not Strong", () => {
    const d: any = buildWorkspaceData("dp-2401");
    const cls = classifyEvidenceRow({
      fieldKey: "activity_log",
      status: "available",
      payload: d.pack.evidenceItemsByField.activity_log?.payload ?? null,
    });
    expect(cls.category).not.toBe("strong");
  });

  it("every fixture's declared band is derivable from its own evidence", () => {
    // buildWorkspaceData throws when a fixture's label and evidence disagree.
    for (const d of DEMO_DISPUTES) {
      expect(() => buildWorkspaceData(d.id), d.id).not.toThrow();
    }
  });
});
