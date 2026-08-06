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
const EXPECTED_CALL_SITES: Record<string, string> = {
  "lib/packs/buildPack.ts":
    "build path — the only site holding the Shopify order; derives all five",
  "app/api/disputes/[id]/workspace/route.ts":
    "dispute detail API — coverage + name mismatch derived, credit read from the pack, order-derived gates unavailable",
  "app/api/disputes/route.ts":
    "list route stage B — name mismatch derived, credit projected from pack_json, order-derived gates unavailable",
  "app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace.ts":
    "client recompute — coverage + credit shipped in the workspace response, server-derived gates are not",
  "lib/argument/caseStrength.ts":
    "calculateImprovement's internal counting question — gate-free by construction",
  "lib/evidence/model/assessment.ts":
    "CaseAssessment adapter — passes its caller's assessment straight through; it derives no gate of its own",
  "scripts/evidence-model/strengthTransition.analysis.ts":
    "read-only analysis — replays the gates buildPack persisted",
  "scripts/evidence-model/reconcileImpact.analysis.ts":
    "read-only analysis — replays the gates buildPack persisted",
};

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
