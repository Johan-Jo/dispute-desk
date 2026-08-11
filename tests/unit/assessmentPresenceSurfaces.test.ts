/**
 * An absent or stale assessment may not render as a verdict, and may not
 * offer to file.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────
 *
 * `needsRecalculation` was introduced as a first-class state and rendered by
 * nobody. Every surface read past it into the payload — and the payload's
 * empty form is not neutral. `emptyWorkspaceAssessment()` returns
 *
 *     overall: "insufficient"  ·  heroVariant: "hard_to_win"
 *     readiness: "blocked"     ·  completenessScore: null
 *
 * chosen so the tabs would type-check. So a dispute nothing had assessed
 * rendered as one we HAD assessed and judged unwinnable, with a blocked
 * completeness bar — and `useReviewView` turned `readiness: "blocked"` into
 * `requiresOverride: true`, relabelling the primary action **"Save anyway"**.
 * That is an invitation to accept a risk the product has not measured, on a
 * case it has not judged.
 *
 * ── WHAT IS PINNED ────────────────────────────────────────────────────
 *
 * The three things the sentinel must never become:
 *
 *   1. a strength verdict (band, chip, or the "Weak" the display coercion
 *      manufactures from `insufficient`);
 *   2. `hard_to_win`, or any hero/status treatment derived from it;
 *   3. a submission action of any kind, and above all an override.
 *
 * Asserted through the real view-model derivations the tabs render from —
 * `useReviewView` and `useEvidenceSections`' summary shape — plus the gate
 * they both read. A test against `resolveAssessmentGate` alone would prove
 * the predicate and nothing about whether anyone consults it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { resolveAssessmentGate } from "@/lib/disputes/assessmentPresence";
import { emptyWorkspaceAssessment } from "@/lib/disputes/workspaceAssessmentTypes";

const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "de", "es", "fr", "pt", "sv"] as const;

function catalog(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, `messages/${locale}.json`), "utf8"));
}

function lookup(cat: Record<string, unknown>, dotted: string): unknown {
  let node: unknown = cat;
  for (const part of dotted.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/* ── 1. The sentinel is a trap, and it is still a trap ────────────────── */

describe("the empty assessment payload carries a verdict-shaped sentinel", () => {
  it("guard the guard — the values that made this dangerous are still there", () => {
    /* If the sentinel were ever made genuinely neutral this test would go
     * green for the wrong reason, and every assertion below would be
     * asserting nothing. So the trap is pinned: it exists, it looks like a
     * verdict, and that is precisely why the gate has to hold. */
    const empty = emptyWorkspaceAssessment("dispute-1");
    expect(empty.caseStrength.overall).toBe("insufficient");
    expect(empty.caseStrength.heroVariant).toBe("hard_to_win");
    expect(empty.readiness).toBe("blocked");
    expect(empty.assessment.needsRecalculation).toBe(true);
    expect(empty.assessment.strengthBand).toBeNull();
    expect(empty.assessment.completenessScore).toBeNull();
  });
});

/* ── 2. The gate ─────────────────────────────────────────────────────── */

describe("resolveAssessmentGate", () => {
  it("withholds verdict, recommendation AND filing together", () => {
    // All three, never a subset. There is no state in which it is correct to
    // hide the band but keep the submit button — each is downstream of the
    // same missing assessment.
    const gate = resolveAssessmentGate({ needsRecalculation: true });
    expect(gate.presence).toBe("not_assessed");
    expect(gate.mayRenderVerdict).toBe(false);
    expect(gate.mayRenderRecommendation).toBe(false);
    expect(gate.mayOfferFilingAction).toBe(false);
  });

  it("permits all three when the assessment is current", () => {
    const gate = resolveAssessmentGate({ needsRecalculation: false });
    expect(gate.presence).toBe("current");
    expect(gate.mayRenderVerdict).toBe(true);
    expect(gate.mayRenderRecommendation).toBe(true);
    expect(gate.mayOfferFilingAction).toBe(true);
  });

  it("tells 'not assessed yet' apart from 'the evidence moved'", () => {
    /* Two different situations that read the same as silence. `snapshot_absent`
     * means wait; `input_hash_mismatch` means the number would describe
     * evidence that is no longer there. Collapsing them would throw away the
     * reason `evaluateFreshness` returns instead of a boolean. */
    const absent = resolveAssessmentGate({
      needsRecalculation: true,
      recalculationReason: "snapshot_absent",
    });
    const stale = resolveAssessmentGate({
      needsRecalculation: true,
      recalculationReason: "input_hash_mismatch",
    });
    const superseded = resolveAssessmentGate({
      needsRecalculation: true,
      recalculationReason: "policy_version_superseded",
    });
    expect(absent.bodyToken.key).not.toBe(stale.bodyToken.key);
    expect(superseded.bodyToken.key).toBe(stale.bodyToken.key);
    // A caller with no reason to hand gets "not yet", never "it changed" —
    // telling a merchant their evidence moved when it never did is worse than
    // saying nothing.
    expect(resolveAssessmentGate({ needsRecalculation: true }).bodyToken.key).toBe(
      absent.bodyToken.key,
    );
  });
});

/* ── 3. The surfaces consult it ──────────────────────────────────────── */

/**
 * Source-level, and deliberately so.
 *
 * These are React hooks and TSX components whose behaviour needs a rendered
 * tree; what must be true is narrower and structural — each surface reads the
 * gate and branches on it before the values it protects. A missing branch is
 * the whole defect, and it is visible here.
 */
const SURFACES: Array<{ file: string; mustRead: RegExp[] }> = [
  {
    file: "app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace.ts",
    mustRead: [/resolveAssessmentGate\(/, /assessment: resolveAssessmentGate\(/],
  },
  {
    file: "app/(embedded)/app/disputes/[id]/tabs/useReviewView.ts",
    mustRead: [/derived\.assessment\.mayOfferFilingAction/, /"not_assessed"/],
  },
  {
    file: "app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections.ts",
    mustRead: [/derived\.assessment\.mayRenderVerdict/, /kind: "not_assessed"/],
  },
  {
    file: "app/(embedded)/app/disputes/[id]/tabs/OverviewTab.tsx",
    mustRead: [
      /derived\.assessment\.mayRenderVerdict/,
      /derived\.assessment\.mayRenderRecommendation/,
    ],
  },
  {
    file: "app/(embedded)/app/disputes/[id]/tabs/ReviewSubmitTab.tsx",
    mustRead: [/view\.state === "not_assessed"/],
  },
];

describe("every surface branches on the gate", () => {
  for (const { file, mustRead } of SURFACES) {
    it(`${file.split("/").pop()} reads it`, () => {
      const src = readFileSync(resolve(ROOT, file), "utf8");
      for (const pattern of mustRead) {
        expect(pattern.test(src), `${file} is missing ${pattern}`).toBe(true);
      }
    });
  }

  it("the Evidence summary strength is NULLABLE, so a renderer must handle absence", () => {
    /* The type is the enforcement. While `strength` was
     * `CaseStrengthLevel` (non-null) the sentinel's `insufficient` flowed
     * into `toDisplayStrength`, which coerces it to "weak" — an unassessed
     * case rendered a WEAK VERDICT BADGE. Making it nullable turns that into
     * a compile error at every renderer. */
    const src = readFileSync(
      resolve(ROOT, "app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections.ts"),
      "utf8",
    );
    expect(src).toMatch(/strength: CaseStrengthLevel \| null;/);
  });

  it("the summary card renders no strength pill without a band", () => {
    const src = readFileSync(
      resolve(
        ROOT,
        "app/(embedded)/app/disputes/[id]/tabs/sections/CaseSummaryCard.tsx",
      ),
      "utf8",
    );
    // The coercion is guarded, and the pill is conditional on a real band.
    expect(src).toMatch(/props\.strength \? toDisplayStrength\(props\.strength\) : null/);
    expect(src).toMatch(/display && strengthColors \? \(/);
  });

  it("the Overview strength chip reads `not_assessed` from the GATE, not from the band", () => {
    /* The old expression reached `not_assessed` only via
     * `overall === "insufficient"` — which is also a real verdict, so a
     * genuinely insufficient case and an unassessed one were
     * indistinguishable, and a stale assessment carrying any other band
     * rendered that band as current. */
    const src = readFileSync(
      resolve(ROOT, "app/(embedded)/app/disputes/[id]/tabs/OverviewTab.tsx"),
      "utf8",
    );
    expect(src).toMatch(/!assessed\s*\n?\s*\?\s*"not_assessed"/);
  });
});

/* ── 4. No override, ever ────────────────────────────────────────────── */

describe("an unassessed case is never offered a submission action", () => {
  it("useReviewView withholds the CTA before it can read readiness", () => {
    /* ORDER is the assertion. `requiresOverride` is computed from
     * `derived.readiness`, which is `"blocked"` on the sentinel; the gate has
     * to return first or the "Save anyway" relabel happens anyway. */
    const src = readFileSync(
      resolve(ROOT, "app/(embedded)/app/disputes/[id]/tabs/useReviewView.ts"),
      "utf8",
    );
    const gateAt = src.indexOf("mayOfferFilingAction");
    const overrideAt = src.indexOf("const requiresOverride");
    expect(gateAt).toBeGreaterThan(-1);
    expect(overrideAt).toBeGreaterThan(-1);
    expect(gateAt, "the gate must precede the override computation").toBeLessThan(
      overrideAt,
    );
    // And the gated branch returns a null CTA rather than a disabled one: a
    // disabled "Save anyway" still tells the merchant an override exists.
    const gatedBranch = src.slice(gateAt, overrideAt);
    expect(gatedBranch).toContain("cta: null");
  });
});

/* ── 5. Six locales ──────────────────────────────────────────────────── */

describe("the explicit state is localized in all six locales", () => {
  const KEYS = [
    "disputes.assessmentState.current.title",
    "disputes.assessmentState.current.body",
    "disputes.assessmentState.notAssessed.title",
    "disputes.assessmentState.notAssessed.bodyAbsent",
    "disputes.assessmentState.notAssessed.bodyStale",
    "disputes.assessmentState.notAssessed.actionsHidden",
  ];

  for (const locale of LOCALES) {
    it(`${locale}: every key resolves to a non-empty string`, () => {
      const cat = catalog(locale);
      for (const key of KEYS) {
        const value = lookup(cat, key);
        expect(typeof value, `${locale} missing ${key}`).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    });

    it(`${locale}: the two bodies say different things`, () => {
      // "Not assessed yet" and "the evidence changed" collapsing into one
      // string would undo the reason distinction at the last step.
      const cat = catalog(locale);
      expect(lookup(cat, "disputes.assessmentState.notAssessed.bodyAbsent")).not.toBe(
        lookup(cat, "disputes.assessmentState.notAssessed.bodyStale"),
      );
    });
  }

  it("the tokens the gate emits are exactly the keys that exist", () => {
    // The gate is the only emitter; a typo'd key would render as a raw path.
    const cat = catalog("en");
    for (const gate of [
      resolveAssessmentGate({ needsRecalculation: false }),
      resolveAssessmentGate({ needsRecalculation: true, recalculationReason: "snapshot_absent" }),
      resolveAssessmentGate({ needsRecalculation: true, recalculationReason: "input_hash_mismatch" }),
    ]) {
      expect(typeof lookup(cat, gate.titleToken.key)).toBe("string");
      expect(typeof lookup(cat, gate.bodyToken.key)).toBe("string");
    }
  });
});
