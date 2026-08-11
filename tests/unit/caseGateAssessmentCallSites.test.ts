/**
 * INVARIANT: every scoring entry point obtains its gates from the canonical
 * `buildCaseGateAssessment`, and the inventory of those entry points is
 * itself pinned.
 *
 * WHY THIS FILE EXISTS. The type system stops a gate from being *omitted*
 * (`tests/types/caseStrengthGates.typecheck.ts`) and the brand on
 * `CaseGateAssessment` stops a hand-rolled literal from reaching the scorer.
 * Neither answers the question the 2026-08-05 audit actually asked: *which*
 * places score a case, and did all of them move? Four call sites existed;
 * three of them wrote `null` for gates they could not see, using the same
 * spelling as "this case has no such gate", and the browser scored a fraud
 * case Strong while the server capped it Moderate on one screen
 * (`docs/evidence-model/p4/legacy-removal-inventory.md`).
 *
 * So this enumerates the call sites from source rather than trusting a
 * comment. A NEW scoring entry point fails here until it is listed, which is
 * the moment to ask which gates it can actually see.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCANNED_DIRS = ["app", "lib", "scripts"];
const SKIP_DIR_SEGMENTS = ["node_modules", "__tests__", ".next"];

/**
 * The complete production + tooling inventory of `calculateCaseStrength`
 * calls, with the gates each site can actually derive. Paths use forward
 * slashes. Update this ONLY together with the call site.
 */
/**
 * The EXACT inventory of `calculateCaseStrength` call sites.
 *
 * ── WHAT CHANGED, AND WHY IT IS SMALLER ───────────────────────────────
 *
 * This was a shrinking ALLOW-LIST: each entry described the gates that site
 * could see, and three of the four production entries described a partial set
 * — `not_shipped_to_client`, `order_not_loaded` — as though a documented gap
 * were a resolved one. Documenting a divergence is not closing it. The
 * browser scored a fraud case Strong while the server capped it Moderate, on
 * one screen, and both entries said so in prose.
 *
 * There are now TWO production entries and neither is a gap:
 *
 *   `lib/evidence/model/assessment.ts`  — the ONE derivation. Every server
 *      surface reaches the scorer through it, with the caller's own
 *      `CaseGateAssessment` passed straight through.
 *   `lib/argument/caseStrength.ts`      — the scorer's INTERNAL self-call
 *      inside `calculateImprovement`, which asks a counting question with no
 *      gates by construction. Deliberate, and the only one exempt.
 *
 * `lib/packs/buildPack.ts` left when it moved to
 * `buildCaseAssessmentSnapshot`; `app/api/disputes/route.ts` left when its
 * live partial-gate recompute was deleted rather than re-described.
 *
 * The analysis scripts stay: they REPLAY gates `buildPack` persisted, over
 * historical rows, and a harness that measured the new derivation would
 * answer a different question than "what did production do".
 */
const EXPECTED_CALL_SITES: Record<string, string> = {
  "lib/argument/caseStrength.ts":
    "the scorer's intentional internal self-call (calculateImprovement) — a counting question, gate-free by construction",
  "lib/evidence/model/assessment.ts":
    "THE derivation — deriveAssessmentFromChecklists; passes its caller's CaseGateAssessment straight through and derives no gate of its own",
  "scripts/evidence-model/strengthTransition.analysis.ts":
    "read-only analysis — replays the gates buildPack persisted",
  "scripts/evidence-model/reconcileImpact.analysis.ts":
    "read-only analysis — replays the gates buildPack persisted",
  "scripts/evidence-model/verifiedAddressContainment.analysis.ts":
    "read-only analysis — replays the gates buildPack persisted",
  "scripts/evidence-model/billingAddressMatchRetirement.analysis.ts":
    "read-only analysis — replays the gates buildPack persisted",
};

/**
 * The two production files, named separately from the analysis scripts.
 *
 * Asserted as an EXACT set rather than "the allow-list has not grown": a list
 * that may only shrink still passes while it holds four entries that should
 * be two, which is what it did for the whole of Slice 1.
 */
const PRODUCTION_CALL_SITES = [
  "lib/argument/caseStrength.ts",
  "lib/evidence/model/assessment.ts",
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_SEGMENTS.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Remove comments so prose that merely NAMES the function is not read as a
 *  call. `calculateCaseStrength()` appears in a dozen explanatory comments. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Split a call's argument text on TOP-LEVEL commas. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter((a) => a.length > 0);
}

/** The GATE argument of each `calculateCaseStrength(...)` call in `source`,
 *  by balanced-paren scan. The declaration itself is not a call. */
function gateArguments(source: string): string[] {
  const out: string[] = [];
  const needle = "calculateCaseStrength(";
  const text = stripComments(source);
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    from = at + needle.length;
    if (/\bfunction\s+$/.test(text.slice(Math.max(0, at - 24), at))) continue;
    let depth = 1;
    let i = from;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    const args = splitArgs(text.slice(from, i - 1));
    // The scorer takes (checklist, reason, payloadSource, gates). Anything
    // with fewer arguments is not a call the compiler would accept, so it is
    // a spy assertion or a stray reference, not a scoring entry point.
    if (args.length < 4) continue;
    out.push(args[3]);
  }
  return out;
}

const files = SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)));
const callSites = new Map<string, string[]>();
for (const file of files) {
  const source = readFileSync(file, "utf8");
  if (!source.includes("calculateCaseStrength(")) continue;
  const args = gateArguments(source);
  if (args.length === 0) continue;
  callSites.set(relative(ROOT, file).split(sep).join("/"), args);
}

describe("every scoring entry point uses the canonical gate assessment", () => {
  it("finds the pinned inventory of call sites and no others", () => {
    expect([...callSites.keys()].sort()).toEqual(
      Object.keys(EXPECTED_CALL_SITES).sort(),
    );
  });

  it("passes no hand-rolled gate object at any call", () => {
    // The exact shape the four divergent call sites used to write was an
    // inline five-nullable literal. The brand on `CaseGateAssessment` already
    // rejects it, but an `as` cast would slip past the compiler and reinstate
    // a second construction path — which is the thing Slice 1 removes.
    const offenders: Array<[string, string]> = [];
    for (const [file, args] of callSites) {
      for (const arg of args) {
        if (arg.startsWith("{")) offenders.push([file, arg.slice(0, 60)]);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("obtains the assessment from the builder or from a passed-through one", () => {
    // Either built here, or received as a `CaseGateAssessment` parameter or
    // local — both of which the brand guarantees came from the builder.
    const IDENTIFIER = /^[A-Za-z_$][\w$.]*$/;
    const offenders: Array<[string, string]> = [];
    for (const [file, args] of callSites) {
      for (const arg of args) {
        const ok = arg.startsWith("buildCaseGateAssessment(") || IDENTIFIER.test(arg);
        if (!ok) offenders.push([file, arg.slice(0, 60)]);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the gate contract cannot be widened by accident", () => {
  it("keeps the source vocabulary and the assessment members in lockstep", async () => {
    const mod = await import("@/lib/argument/caseGateAssessment");
    const assessment = mod.buildCaseGateAssessment({
      coverage: mod.gateNotProvided("gate_free_query"),
      fatalLoss: mod.gateNotProvided("gate_free_query"),
      riskWeakness: mod.gateNotProvided("gate_free_query"),
      nameMismatch: mod.gateNotProvided("gate_free_query"),
      creditAlreadyIssued: mod.gateNotProvided("gate_free_query"),
    });
    // Adding a gate to the sources without adding it here is the compile-time
    // alarm; this pins the runtime shape the scorer destructures.
    expect(Object.keys(assessment).sort()).toEqual(
      [
        "coverage",
        "creditAlreadyIssued",
        "fatalLoss",
        "nameMismatch",
        "notProvided",
        "riskWeakness",
      ].sort(),
    );
  });

  it("records WHY a gate is absent, so 'no gate' and 'nobody looked' stay distinct", async () => {
    const mod = await import("@/lib/argument/caseGateAssessment");
    const a = mod.buildCaseGateAssessment({
      coverage: mod.gateProvided(null),
      fatalLoss: mod.gateNotProvided("order_not_loaded"),
      riskWeakness: mod.gateNotProvided("order_not_loaded"),
      nameMismatch: mod.gateProvided(null),
      creditAlreadyIssued: mod.gateProvided(null),
    });
    // Both score as `null`...
    expect(a.coverage).toBeNull();
    expect(a.fatalLoss).toBeNull();
    // ...but only one of them is on the record as unseen.
    expect(a.notProvided).toEqual({
      fatalLoss: "order_not_loaded",
      riskWeakness: "order_not_loaded",
    });
  });
});


describe("CI invariant — exactly two production scorer call sites", () => {
  /**
   * The EXACT set, not a ceiling.
   *
   * A shrink-only allow-list passes while it holds four entries that should
   * hold two, which is what it did for the whole of Slice 1: every divergent
   * site was listed, described accurately, and left in place. Equality is the
   * only form of this assertion that fails while the migration is incomplete.
   */
  const productionSites = [...callSites.keys()]
    .filter((f) => f.startsWith("lib/") || f.startsWith("app/"))
    .sort();

  it("is exactly the derivation and the scorer's own self-call", () => {
    expect(productionSites).toEqual([...PRODUCTION_CALL_SITES].sort());
  });

  it("no route, job, hook or component scores a case", () => {
    /* Named by SHAPE rather than by path, so a new route that scores fails
     * here on the day it is written instead of on the day someone notices. */
    const offenders = productionSites.filter(
      (f) =>
        f.startsWith("app/") ||
        f.includes("/jobs/") ||
        f.includes("/hooks/") ||
        f.endsWith(".tsx"),
    );
    expect(offenders).toEqual([]);
  });

  it("the scorer's self-call is the ONLY exemption, and it is gate-free", () => {
    /* `calculateImprovement` re-scores to answer "would adding this field
     * change the band" — a counting question about a hypothetical checklist,
     * not an assessment of the case. It passes the caller's own gates
     * through; it does not build a set of its own. Pinned so the exemption
     * cannot quietly widen into "the scorer may call itself for anything". */
    const args = callSites.get("lib/argument/caseStrength.ts") ?? [];
    expect(args.length).toBe(1);
    expect(args[0].startsWith("{"), "a hand-rolled gate literal").toBe(false);
  });

  it("guard the guard — the detector finds a call that should not exist", () => {
    /* Without this, a rename of `calculateCaseStrength`, a change to the
     * argument arity, or a bug in the balanced-paren scan would empty
     * `callSites` and turn every assertion above green while the codebase was
     * full of divergent scoring. The detector is re-run against a source
     * string carrying exactly the shape it must catch. */
    const smuggled = `
      import { calculateCaseStrength } from "@/lib/argument/caseStrength";
      const r = calculateCaseStrength(checklist, reason, payloadSource, {
        coverage: null, fatalLoss: null, riskWeakness: null,
        nameMismatch: null, creditAlreadyIssued: null,
      });
    `;
    const found = gateArguments(smuggled);
    expect(found.length).toBe(1);
    // …and the hand-rolled-literal check would reject it.
    expect(found[0].startsWith("{")).toBe(true);
  });

  it("guard the guard — a comment mentioning the scorer is not a call", () => {
    const prose = `
      // calculateCaseStrength(a, b, c, d) is described here, not called.
      /* calculateCaseStrength(a, b, c, d) */
    `;
    expect(gateArguments(prose)).toEqual([]);
  });
});
