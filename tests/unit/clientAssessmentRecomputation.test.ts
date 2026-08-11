/**
 * CP-A CI INVARIANT — the browser has no scorer, and the scorer has one caller.
 *
 * ── WHY THIS TEST IS THE DEFINITION OF DONE ───────────────────────────
 *
 * The previous attempt at this migration built the derivations and never
 * flipped the callers. Scoring was proven zero-change on all 76 live packs and
 * the caller was still never switched
 * (`status-and-way-forward-2026-08-04.md` §7.5). A derivation that exists
 * while the old caller survives is not a migration; it is a second
 * implementation, and second implementations diverge — the browser rendered
 * Strong on a fraud case the server had capped at Moderate, on one screen, on
 * one request.
 *
 * So "the projection exists" is not the acceptance criterion. "The old call
 * site is gone, and cannot come back without CI going red" is.
 *
 * ── MODELLED ON `evidenceDivergenceManifest.test.ts` ──────────────────
 *
 * Including the property that makes that test worth having: an empty result
 * and a broken detector look identical, so the detector is re-run against the
 * PRE-FIX SHAPE and must still find it. Without that, deleting the detector
 * would "close" the migration.
 *
 * ── THE ALLOW-LIST IS PART OF THE INVARIANT, NOT AN ESCAPE HATCH ──────
 *
 * `calculateCaseStrength` had four production call sites passing four
 * different gate sets. CP-A removes the client one and routes the workspace
 * one through the single derivation. The remaining server-side sites belong
 * to CP-C / CP-D by the CP-0 ownership map, so they are enumerated by name
 * with an owner rather than silently tolerated. The list may only ever
 * shrink; a new entry is a test failure with a message saying so.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

/**
 * The three merchant surfaces plus everything they render through.
 *
 * The hook is in the list because the deleted scorer call lived THERE, not in
 * a tab — scoping the scan to `tabs/` would have made the invariant pass on
 * day one while the defect sat one import away.
 */
const CLIENT_SURFACES = [
  "app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace.ts",
  "app/(embedded)/app/disputes/[id]/tabs/OverviewTab.tsx",
  "app/(embedded)/app/disputes/[id]/tabs/EvidenceTab.tsx",
  "app/(embedded)/app/disputes/[id]/tabs/ReviewSubmitTab.tsx",
  "app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections.ts",
  "app/(embedded)/app/disputes/[id]/tabs/useReviewView.ts",
] as const;

/**
 * Modules whose exports DERIVE a score, a band or a readiness.
 *
 * A `import type` is fine and is stripped before scanning: types are erased
 * at compile time, cannot be called, and the payload shape has to be nameable
 * on the client for the tabs to render it at all.
 */
const SCORING_MODULES = [
  "@/lib/argument/caseStrength",
  "@/lib/argument/caseGateAssessment",
  "@/lib/automation/completeness",
] as const;

/** Functions that compute rather than render. */
const SCORING_SYMBOLS = [
  "calculateCaseStrength",
  "calculateImprovement",
  "computeContributions",
  "deriveCompletenessMetrics",
  "evaluateCompletenessV2",
  "buildCaseGateAssessment",
  "gateProvided",
  "gateNotProvided",
] as const;

/**
 * THE ALLOW-LIST IS GONE.
 *
 * It listed five call sites, four of them production, each with a named epic
 * that would "eventually" close it — and it could only shrink. That is a
 * ratchet, not an invariant: it stayed green with four divergent sites in
 * place for the whole of Slice 1, because "four tolerated sites" is exactly
 * what it was written to tolerate.
 *
 * The exact global inventory now lives in
 * `tests/unit/caseGateAssessmentCallSites.test.ts`, which asserts EQUALITY
 * against two production entries (the single derivation, and the scorer's own
 * self-call inside `calculateImprovement`). Keeping a second, more permissive
 * list here would have meant two tests disagreeing about the same fact, with
 * the laxer one deciding whether CI went green.
 *
 * What stays in this file is the thing it uniquely owns: the CLIENT must not
 * score, and that deletion is permanent.
 */

/* ── the detectors ─────────────────────────────────────────────────── */

function stripCommentsAndTypeImports(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    // `import type { … } from "…"` — erased at compile time.
    .replace(/import\s+type\s+[\s\S]*?from\s+["'][^"']+["'];?/g, "")
    // `import { type A, type B } from "…"` when EVERY specifier is a type.
    .replace(
      /import\s*\{\s*((?:type\s+[A-Za-z0-9_]+\s*,?\s*)+)\}\s*from\s*["'][^"']+["'];?/g,
      "",
    );
}

/** Value imports from a scoring module. */
function scoringModuleImports(source: string): string[] {
  const code = stripCommentsAndTypeImports(source);
  const hits: string[] = [];
  for (const mod of SCORING_MODULES) {
    if (new RegExp(`from\\s+["']${mod.replace(/[/]/g, "\\/")}["']`).test(code)) {
      hits.push(mod);
    }
  }
  return hits;
}

/** Calls to a computing symbol. */
function scoringSymbolCalls(source: string): string[] {
  const code = stripCommentsAndTypeImports(source);
  return SCORING_SYMBOLS.filter((sym) => new RegExp(`\\b${sym}\\s*\\(`).test(code));
}

/**
 * Readiness reconstructed from a checklist.
 *
 * The deleted shape assigned one of the three `SubmissionReadiness` members
 * from `.filter(...)` counts over `blocking` / `priority === "critical"`.
 * READING a readiness (`readiness === "blocked"` → render a banner) is not
 * reconstruction and must not trip: the surfaces branch on readiness all over
 * the place and always will.
 */
function readinessReconstruction(source: string): string[] {
  const code = stripCommentsAndTypeImports(source);
  const hits: string[] = [];
  // A filter over the blocking flag combined with a missing status — the
  // blocker-count half of the three-way branch.
  if (/\.filter\(\s*\([^)]*\)\s*=>[^;]{0,200}?\bblocking\b[^;]{0,200}?status\s*===\s*["']missing["']/.test(code)) {
    hits.push("blocker-count filter over checklist");
  }
  // The critical-gap half.
  if (/\.filter\(\s*\([^)]*\)\s*=>[^;]{0,200}?priority\s*===\s*["']critical["'][^;]{0,200}?status\s*===\s*["']missing["']/.test(code)) {
    hits.push("critical-gap filter over checklist");
  }
  // The assignment itself: a readiness variable produced by a ternary chain.
  if (/=\s*[^;\n]{0,120}\?\s*["']blocked["']\s*:[^;\n]{0,160}\?\s*["']ready_with_warnings["']/.test(code)) {
    hits.push("three-way readiness ternary");
  }
  return hits;
}

/* ── the pre-fix shape, kept verbatim so the detector can be falsified ─ */

/**
 * A faithful excerpt of what `useDisputeWorkspace` contained before CP-A.
 *
 * Kept as a fixture rather than read from git: a test that shells out to
 * history breaks on a rebase, a shallow clone, or a squash, and then the
 * falsification guard silently stops guarding. This string is the thing the
 * detector must catch, and it is checked in next to the detector so the two
 * cannot drift apart unnoticed.
 */
const PRE_FIX_HOOK_EXCERPT = `
"use client";
import {
  calculateCaseStrength,
  calculateImprovement,
  computeContributions,
} from "@/lib/argument/caseStrength";
import {
  buildCaseGateAssessment,
  gateNotProvided,
  gateProvided,
} from "@/lib/argument/caseGateAssessment";

function derive(effectiveChecklist, data, pack, isSaved) {
  let readiness;
  if (isSaved) {
    readiness = "submitted";
  } else {
    const missingBlockers = effectiveChecklist.filter((c) => c.blocking && c.status === "missing");
    const missingCritical = effectiveChecklist.filter((c) => c.priority === "critical" && !c.blocking && c.status === "missing");
    readiness = missingBlockers.length > 0 ? "blocked" : missingCritical.length > 0 ? "ready_with_warnings" : "ready";
  }
  const caseStrength = calculateCaseStrength(
    effectiveChecklist,
    data.dispute.reason,
    payloadSource,
    buildCaseGateAssessment({
      coverage: gateProvided(coverageInput ?? null),
      fatalLoss: gateNotProvided("not_shipped_to_client"),
      riskWeakness: gateNotProvided("not_shipped_to_client"),
      nameMismatch: gateNotProvided("not_shipped_to_client"),
      creditAlreadyIssued: gateProvided(data.pack?.creditAlreadyIssued ?? null),
    }),
  );
  const contributions = computeContributions({ checklist: effectiveChecklist, payloadSource, reason: data.dispute.reason });
  const improvement = calculateImprovement(effectiveChecklist, data.dispute.reason, payloadSource);
  return { readiness, caseStrength, contributions, improvement };
}
`;

/* ── the suite ─────────────────────────────────────────────────────── */

describe("CP-A invariant — no client-side assessment recomputation", () => {
  const sources = new Map<string, string>(
    CLIENT_SURFACES.map((rel) => [rel, readFileSync(join(ROOT, rel), "utf-8")]),
  );

  it("guard the guard — every scanned surface exists and is non-trivial", () => {
    // A renamed or moved file would make every assertion below vacuous: the
    // scan would find nothing because it read nothing.
    expect(sources.size).toBe(CLIENT_SURFACES.length);
    for (const [rel, src] of sources) {
      expect(src.length, `${rel} is empty — did the file move?`).toBeGreaterThan(500);
    }
  });

  it("the detector still WORKS — it finds the pre-fix hook", () => {
    // An empty result and a broken detector are indistinguishable. This runs
    // all three detectors against the shape CP-A deleted; if any stops
    // firing, the clean scan below proves nothing.
    expect(scoringModuleImports(PRE_FIX_HOOK_EXCERPT).sort()).toEqual([
      "@/lib/argument/caseGateAssessment",
      "@/lib/argument/caseStrength",
    ]);
    expect(scoringSymbolCalls(PRE_FIX_HOOK_EXCERPT)).toContain("calculateCaseStrength");
    expect(scoringSymbolCalls(PRE_FIX_HOOK_EXCERPT)).toContain("computeContributions");
    expect(scoringSymbolCalls(PRE_FIX_HOOK_EXCERPT)).toContain("calculateImprovement");
    expect(readinessReconstruction(PRE_FIX_HOOK_EXCERPT).length).toBeGreaterThanOrEqual(3);
  });

  it("the detector does NOT fire on a surface that merely READS a readiness", () => {
    // Branching on readiness to pick a banner is not reconstruction, and a
    // detector that cannot tell the difference would be turned off within a
    // week — which is the same as not having one.
    const reader = `
      const tone = derived.readiness === "blocked" ? "critical" : "info";
      if (derived.readiness === "ready_with_warnings") return warnBanner();
      const band = derived.caseStrength.overall;
    `;
    expect(readinessReconstruction(reader)).toEqual([]);
    expect(scoringSymbolCalls(reader)).toEqual([]);
  });

  it("no client surface IMPORTS a scoring module as a value", () => {
    const offenders: string[] = [];
    for (const [rel, src] of sources) {
      for (const mod of scoringModuleImports(src)) offenders.push(`${rel} → ${mod}`);
    }
    expect(
      offenders,
      "A merchant surface can reach a scoring engine. Even unused, the import " +
        "is one call away from a second answer to a question the server has " +
        "already answered — which is exactly how the browser came to render " +
        "Strong on a case the server capped at Moderate.",
    ).toEqual([]);
  });

  it("no client surface CALLS a scoring or completeness function", () => {
    const offenders: string[] = [];
    for (const [rel, src] of sources) {
      for (const sym of scoringSymbolCalls(src)) offenders.push(`${rel} → ${sym}()`);
    }
    expect(offenders).toEqual([]);
  });

  it("no client surface RECONSTRUCTS submission readiness", () => {
    const offenders: string[] = [];
    for (const [rel, src] of sources) {
      for (const hit of readinessReconstruction(src)) offenders.push(`${rel} → ${hit}`);
    }
    expect(
      offenders,
      "Readiness is derived once, server-side, by `buildWorkspaceAssessment`. " +
        "A second three-way branch here means a change to the rule has to be " +
        "made twice or the page disagrees with the gate that filed the evidence.",
    ).toEqual([]);
  });
});

describe("CP-A invariant — calculateCaseStrength call sites", () => {
  /**
   * Every production file that CALLS the scorer.
   *
   * Tests, type-check fixtures and the read-only analysis harnesses are out
   * of scope by construction: their whole purpose is to call the scorer under
   * controlled inputs, and forbidding that would delete the measurements this
   * migration depends on.
   */
  function productionCallSites(): string[] {
    const candidates = [
      "lib/evidence/model/assessment.ts",
      "lib/argument/caseStrength.ts",
      "lib/packs/buildPack.ts",
      "lib/disputes/workspaceAssessment.ts",
      "app/api/disputes/route.ts",
      "app/api/disputes/[id]/workspace/route.ts",
      ...CLIENT_SURFACES,
    ];
    const hits: string[] = [];
    for (const rel of candidates) {
      let src: string;
      try {
        src = readFileSync(join(ROOT, rel), "utf-8");
      } catch {
        continue;
      }
      if (/\bcalculateCaseStrength\s*\(/.test(stripCommentsAndTypeImports(src))) {
        hits.push(rel);
      }
    }
    return hits.sort();
  }

  it("guard the guard — the scan finds the canonical derivation", () => {
    // If the scan found nothing at all, "zero unexpected call sites" would be
    // a statement about a broken reader.
    expect(productionCallSites()).toContain("lib/evidence/model/assessment.ts");
  });

  it("no production call site outside the ONE derivation and the scorer itself", () => {
    /* EQUALITY, not a ceiling. The predecessor allow-list permitted four
     * production sites and asked each to be closed "eventually"; it went green
     * every day they were not. */
    expect(productionCallSites()).toEqual([
      "lib/argument/caseStrength.ts",
      "lib/evidence/model/assessment.ts",
    ]);
  });

  it("the client is not among them — CP-A's deletion is permanent", () => {
    const sites = productionCallSites();
    for (const rel of CLIENT_SURFACES) {
      expect(
        sites,
        `${rel} scores again. A browser scorer is not a call site to be ` +
          "tolerated; it is the one this epic removed.",
      ).not.toContain(rel);
    }
  });

  it("the workspace builder PROJECTS a snapshot — it derives no band", () => {
    /* It used to reach the scorer through `deriveAssessmentFromChecklists`,
     * with the workspace route's gates — a set in which three of five are
     * unavailable because the route holds no order. That was a second
     * derivation with worse inputs, which is a second answer.
     *
     * It now renders what `buildPack` persisted. Both halves are asserted: no
     * scorer call, and the projection actually used. */
    const src = readFileSync(join(ROOT, "lib/disputes/workspaceAssessment.ts"), "utf-8");
    const code = stripCommentsAndTypeImports(src);
    expect(/\bcalculateCaseStrength\s*\(/.test(code)).toBe(false);
    expect(/\bderiveAssessmentFromChecklists\s*\(/.test(code)).toBe(false);
    expect(code).toMatch(/projectMerchantAssessment\s*\(/);
  });

  it("neither production route builds a gate assessment of its own", () => {
    /* The gate builder is how a route acquires an opinion. Both of these used
     * to call it — the workspace route with two of five gates answerable, the
     * list route with three `order_not_loaded` — and both are now readers. */
    for (const rel of [
      "app/api/disputes/[id]/workspace/route.ts",
      "app/api/disputes/route.ts",
    ]) {
      const code = stripCommentsAndTypeImports(readFileSync(join(ROOT, rel), "utf-8"));
      expect(/\bbuildCaseGateAssessment\s*\(/.test(code), rel).toBe(false);
      expect(/\bgateNotProvided\s*\(/.test(code), rel).toBe(false);
    }
  });
});
