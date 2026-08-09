/**
 * The branch boundary, enforced structurally (EPIC CP-C §5, §7).
 *
 * Automation decides WHAT TO DO. The argument decides WHAT TO SAY. The moment
 * automation can read an argument plan, a narrative, or a review internal, a
 * filing decision starts depending on prose — and prose is regenerated on every
 * build. This test fails the build the first time that import appears, which is
 * the only enforcement that survives a refactor nobody reviewed carefully.
 *
 * It also pins the two CI invariants the epic requires: no legacy gate ladder
 * has a production reader, and no cron route bypasses `cronEnvGate`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");
const DECISION_DIR = join(ROOT, "lib", "automation", "decision");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specifiers.push(m[1]);
  const dynamic = /import\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dynamic.exec(source)) !== null) specifiers.push(m[1]);
  return specifiers;
}

/**
 * Argument- and review-internal surfaces. `@/lib/argument/types` is the one
 * exception, and only because the SHARED contract itself types
 * `CaseAssessmentSnapshot.strength` as `CaseStrengthResult` — a type-only
 * dependency the coordinator owns, not a behavioural one.
 */
const FORBIDDEN_PREFIXES = [
  "@/lib/argument/",
  "@/lib/defence/narrativeWriter",
  "@/lib/defence/validateNarrative",
  "@/lib/defence/strategies",
  "@/lib/defence/reasonCodes",
  "@/lib/defence/render",
  "@/lib/defence/pdf",
  "@/lib/pipeline/contracts/argumentPlan",
];
const ALLOWED_EXACT = new Set(["@/lib/argument/types"]);

describe("branch boundary — automation may not import the argument branch", () => {
  const files = walk(DECISION_DIR).filter((f) => !f.includes("__tests__"));

  it("finds the decision module", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of walk(DECISION_DIR).filter((f) => !f.includes("__tests__"))) {
    it(`${relative(ROOT, file).replace(/\\/g, "/")} imports nothing from the argument branch`, () => {
      const specifiers = importsOf(readFileSync(file, "utf8"));
      const offenders = specifiers.filter(
        (s) =>
          !ALLOWED_EXACT.has(s) &&
          FORBIDDEN_PREFIXES.some((p) => s === p.replace(/\/$/, "") || s.startsWith(p)),
      );
      expect(offenders).toEqual([]);
    });
  }

  it("the decision snapshot carries no argument or narrative field", () => {
    const src = readFileSync(
      join(DECISION_DIR, "deriveCaseAutomationDecision.ts"),
      "utf8",
    );
    for (const forbidden of ["narrative", "IncludedFact", "ExcludedFact", "noSafeArgument"]) {
      expect(src.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("package choice is absent from the decision snapshot", () => {
    const src = readFileSync(
      join(DECISION_DIR, "deriveCaseAutomationDecision.ts"),
      "utf8",
    );
    for (const forbidden of ["packageId", "packageVersion", "artifactId", "pdf_path"]) {
      expect(src.includes(forbidden), forbidden).toBe(false);
    }
  });
});

describe("CI invariant — legacy gate ladders have no production reader", () => {
  /**
   * Each entry is a legacy ladder the canonical decision replaces. The files
   * still exist because `scripts/evidence-model/calibration/**` (Agent A's
   * measurement harness) replays historical behaviour through them, and a
   * harness that measured the NEW ladder would answer a different question.
   * What must be true is that nothing under `lib/` or `app/` decides anything
   * with them any more.
   */
  const RETIRED_LADDERS: Array<{ name: string; definedIn: string }> = [
    { name: "evaluateAutoSaveGate", definedIn: "lib/automation/autoSaveGate.ts" },
    { name: "evaluateAutoSubmitGuards", definedIn: "lib/automation/autoSubmitGuards.ts" },
  ];

  const productionFiles = [
    ...walk(join(ROOT, "lib")),
    ...walk(join(ROOT, "app")),
  ].filter((f) => !f.includes("__tests__"));

  for (const { name, definedIn } of RETIRED_LADDERS) {
    it(`${name} has zero production readers`, () => {
      const readers = productionFiles.filter((file) => {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        // The defining module is not a reader of itself.
        if (rel === definedIn) return false;
        const src = readFileSync(file, "utf8");
        // An import, or a call. A mention in a comment is history, not a reader.
        return (
          new RegExp(`import[\\s\\S]{0,200}\\b${name}\\b`).test(src) ||
          new RegExp(`\\b${name}\\s*\\(`).test(src)
        );
      });
      expect(readers.map((f) => relative(ROOT, f).replace(/\\/g, "/"))).toEqual([]);
    });
  }

  it("no undefined-readiness fallback remains (R1)", () => {
    /**
     * R1: `submissionReadiness: … ?? undefined` dropped the auto-save gate onto
     * the legacy blocker-count path whenever the column was absent — a second,
     * differently-calibrated ladder reachable by a NULL. The canonical decision
     * resolves an absent readiness to `blocked`, so an absent signal fails
     * closed instead of switching engines.
     */
    for (const file of productionFiles) {
      const src = readFileSync(file, "utf8");
      expect(
        /submission(_r|R)eadiness[^\n]*\?\?\s*undefined/.test(src),
        relative(ROOT, file).replace(/\\/g, "/"),
      ).toBe(false);
    }
  });
});

describe("CI invariant — the deadline submitter gates before it decides", () => {
  /**
   * The fleet-wide "every cron route calls cronEnvGate" enumeration already
   * lives in `lib/cron/__tests__/envGate.test.ts` and is not duplicated here.
   * What IS asserted here is the stronger property for the one route this epic
   * rewrites: the gate is the FIRST statement, ahead of the decision, so a
   * disabled or unauthenticated environment cannot reach a filing path.
   */
  const route = join(
    ROOT,
    "app",
    "api",
    "cron",
    "defence-package-deadline-submit",
    "route.ts",
  );

  it("cronEnvGate(req) is the first statement of GET", () => {
    const src = readFileSync(route, "utf8");
    const handler = src.match(/export async function GET\s*\([^)]*\)\s*\{([\s\S]{0,200})/);
    expect(handler).not.toBeNull();
    const head = handler![1].trim();
    expect(head.startsWith("const gate = cronEnvGate(req);")).toBe(true);
  });

  it("the deadline route reaches a package only through the selection adapter", () => {
    const src = readFileSync(route, "utf8");
    expect(src).toContain("selectForDeadline");
    // No executor may obtain a package through a direct fileable-row query.
    expect(src).not.toMatch(/from\(["']defence_packages["']\)[\s\S]{0,400}order\(/);
  });
});
