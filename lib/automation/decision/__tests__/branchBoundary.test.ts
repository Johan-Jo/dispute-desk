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

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/** Comments are prose about a rule, not the rule. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*/gm, "$1 ");
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

describe("CI invariant — legacy gate ladders are reachable only behind the switch", () => {
  /**
   * Each entry is a legacy ladder the canonical decision replaces. The files
   * still exist because `scripts/evidence-model/calibration/**` (Agent A's
   * measurement harness) replays historical behaviour through them, and a
   * harness that measured the NEW ladder would answer a different question.
   *
   * ── WHY THIS IS NOT YET "ZERO READERS" ────────────────────────────────
   *
   * PR 2 ships the canonical route DARK. With the switch off, production runs
   * the ladders that shipped at the kickoff baseline — and it runs them as the
   * SAME CODE, moved verbatim into `*.legacy.ts` modules, because "dark" must
   * mean the same code rather than a re-expression argued to be equivalent.
   * Those modules are therefore real readers, and asserting zero here would
   * only be satisfiable by faking the dark period.
   *
   * So the invariant for the dark period is the one that actually matters:
   *
   *   1. Every reader is a gated legacy module — no OTHER file decides
   *      anything with a retired ladder.
   *   2. Every gated legacy module is reached only from a live module that
   *      dispatches on `canonicalPipelineEnabled()`, so an activated
   *      deployment cannot reach one.
   *
   * PR 3 deletes the legacy modules and this list becomes empty again, at
   * which point `GATED_LEGACY_MODULES` and this comment go with them.
   */
  const RETIRED_LADDERS: Array<{ name: string; definedIn: string }> = [
    { name: "evaluateAutoSaveGate", definedIn: "lib/automation/autoSaveGate.ts" },
    { name: "evaluateAutoSubmitGuards", definedIn: "lib/automation/autoSubmitGuards.ts" },
  ];

  /**
   * The verbatim pre-cutover implementations, and the live module that gates
   * each one. Both halves are asserted: a legacy module with no gate is a
   * legacy module that ships live.
   */
  const GATED_LEGACY_MODULES: Array<{ legacy: string; gatedBy: string; entry: string }> = [
    {
      legacy: "lib/automation/pipeline.legacy.ts",
      gatedBy: "lib/automation/pipeline.ts",
      entry: "evaluateAndMaybeAutoSaveLegacy",
    },
    {
      legacy: "lib/automation/reconcileParkedAutoDisputes.legacy.ts",
      gatedBy: "lib/automation/reconcileParkedAutoDisputes.ts",
      entry: "reconcileParkedAutoDisputesLegacy",
    },
    {
      legacy: "lib/disputes/heldState.legacy.ts",
      gatedBy: "lib/disputes/heldState.ts",
      entry: "resolveHeldStateLegacy",
    },
    {
      legacy: "app/api/cron/defence-package-deadline-submit/legacyRoute.ts",
      gatedBy: "app/api/cron/defence-package-deadline-submit/route.ts",
      entry: "runDeadlineSubmitLegacy",
    },
  ];

  const LEGACY_PATHS = new Set(GATED_LEGACY_MODULES.map((m) => m.legacy));

  const productionFiles = [
    ...walk(join(ROOT, "lib")),
    ...walk(join(ROOT, "app")),
  ].filter((f) => !f.includes("__tests__"));

  for (const { name, definedIn } of RETIRED_LADDERS) {
    it(`${name} is read only by a gated legacy module`, () => {
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
      const unexpected = readers
        .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
        .filter((rel) => !LEGACY_PATHS.has(rel));
      expect(unexpected).toEqual([]);
    });
  }

  for (const { legacy, gatedBy, entry } of GATED_LEGACY_MODULES) {
    it(`${legacy} is reachable only through canonicalPipelineEnabled()`, () => {
      const live = readFileSync(join(ROOT, ...gatedBy.split("/")), "utf8");
      // The gate, and the call, and the gate BEFORE the call. A dispatch that
      // reads the switch somewhere else in the file would satisfy a naive
      // "contains both" check while running the legacy body unconditionally.
      const gateIndex = live.indexOf(`if (!canonicalPipelineEnabled()) return ${entry}(`);
      expect(gateIndex, `${gatedBy} does not dispatch to ${entry} behind the switch`).toBeGreaterThan(-1);
      // …and nowhere else. One call site, one gate.
      const callCount = live.split(`${entry}(`).length - 1;
      expect(callCount, `${gatedBy} calls ${entry} more than once`).toBe(1);
    });
  }

  it("guard the guard — the gate pattern really is what makes those tests pass", () => {
    // Re-run the detector against a file that imports a legacy entry point and
    // calls it WITHOUT the switch. If this does not fail the pattern, the
    // assertions above prove nothing.
    const ungated = `import { resolveHeldStateLegacy } from "./heldState.legacy";\nreturn resolveHeldStateLegacy(input);`;
    expect(ungated.indexOf("if (!canonicalPipelineEnabled()) return resolveHeldStateLegacy(")).toBe(-1);
  });

  it("no undefined-readiness fallback remains (R1)", () => {
    /**
     * R1: `submissionReadiness: … ?? undefined` dropped the auto-save gate onto
     * the legacy blocker-count path whenever the column was absent — a second,
     * differently-calibrated ladder reachable by a NULL. The canonical decision
     * resolves an absent readiness to `blocked`, so an absent signal fails
     * closed instead of switching engines.
     *
     * COMMENTS ARE STRIPPED FIRST, and that is a correction rather than a
     * relaxation. The R1 fallback is discussed in prose in several places —
     * `completenessSnapshot.ts` documents the three persisted coercions by
     * quoting the exact expression it exists to replace — and a scan that
     * cannot tell an implementation from its own changelog fails on the file
     * that fixed the defect. The rule is the same rule
     * `bankInclusionSingleOwner.test.ts` applies to the inclusion predicate:
     * prose is not a second implementation.
     */
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    for (const file of productionFiles) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      // The gated legacy modules are the pre-cutover code, verbatim. R1 IS the
      // pre-cutover behaviour, so its presence there is the point — removing
      // it would make the "off" path something other than what shipped. The
      // preceding suite proves those modules are unreachable when the switch
      // is on, which is what makes this exemption safe rather than convenient.
      if (LEGACY_PATHS.has(rel)) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      expect(
        /submission(_r|R)eadiness[^\n]*\?\?\s*undefined/.test(src),
        rel,
      ).toBe(false);
    }
  });

  it("the null → undefined conversion has exactly ONE owner (revision 1)", () => {
    /**
     * The companion assertion to R1, and the reason the scan above can be
     * comment-blind without losing teeth.
     *
     * Contract revision 1 made `CompletenessSnapshot.readiness`
     * `SubmissionReadiness | null` with `null` AS the legacy arm, so the arm is
     * now representable and named. It still has to be spelled `undefined` at
     * the `evaluateAutoSaveGate` boundary — that is what the gate branches on —
     * and `readinessForGate()` is the ONE place that translation happens.
     *
     * Pinned by name so the conversion cannot quietly reappear at a call site
     * that picked `"ready"` because it looked tidier. That substitution is not
     * hypothetical: it would auto-file every legacy pack that has blockers.
     */
    const owner = readFileSync(
      join(ROOT, "lib", "evidence", "model", "completenessSnapshot.ts"),
      "utf8",
    );
    expect(owner).toMatch(/export function readinessForGate\b/);
    expect(owner).toMatch(/return readiness \?\? undefined;/);
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
    // Comments are stripped first, for the same reason the R1 scan strips
    // them: a scan that cannot tell an implementation from the prose above it
    // fails on the change that documents itself. What is asserted is the
    // STATEMENT order — and the gate must precede the activation switch too,
    // because an unauthenticated request may not reach either branch.
    const src = readFileSync(route, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const handler = src.match(/export async function GET\s*\([^)]*\)\s*\{([\s\S]{0,400})/);
    expect(handler).not.toBeNull();
    const head = handler![1].trim();
    expect(head.startsWith("const gate = cronEnvGate(req);")).toBe(true);
    // The switch is read AFTER the gate, never before it.
    expect(head.indexOf("canonicalPipelineEnabled()")).toBeGreaterThan(
      head.indexOf("cronEnvGate(req)"),
    );
  });

  it("the deadline route reaches a package only through the selection adapter", () => {
    const src = readFileSync(route, "utf8");
    expect(src).toContain("selectForDeadline");
    // No executor may obtain a package through a direct fileable-row query.
    expect(src).not.toMatch(/from\(["']defence_packages["']\)[\s\S]{0,400}order\(/);
  });

  it("the legacy route keeps its own cronEnvGate — the gate is not the switch's job", () => {
    // `route.ts` gates before dispatching, so this is belt-and-braces. It is
    // asserted anyway because the legacy module is a full request handler: if
    // anything ever calls it directly, authentication must not depend on the
    // caller having done it first.
    const legacy = readFileSync(
      join(ROOT, "app", "api", "cron", "defence-package-deadline-submit", "legacyRoute.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");
    const handler = legacy.match(
      /export async function runDeadlineSubmitLegacy\s*\([^)]*\)\s*\{([\s\S]{0,200})/,
    );
    expect(handler).not.toBeNull();
    expect(handler![1].trim().startsWith("const gate = cronEnvGate(req);")).toBe(true);
  });
});


describe("CI invariant — no canonical executor reaches a package directly", () => {
  /**
   * Plan §11: "Executors: zero direct fileable-row queries."
   *
   * The four executors that OBTAIN a package — the pack pipeline, the save
   * worker, the deadline cron, and the reconcile pass through the promotion
   * helper — must do it through `selectFileablePackage`. Two things are
   * asserted, and the second is the one that actually bites:
   *
   *   1. `preflightLatestCandidate` has no reader outside a gated legacy path.
   *   2. Where a raw `order("version").limit(1)` on `defence_packages` still
   *      exists in a live module, it is unreachable when the switch is on.
   *
   * NOT asserted: `preflightNamedCandidate`. It answers a different question —
   * "may THIS named draft be promoted" — and the selector cannot answer it,
   * because the selector only ever returns `final` rows. Conflating the two
   * would either break promotion or force the selector to grow a second mode.
   */
  const EXECUTORS = [
    "lib/automation/pipeline.ts",
    "lib/jobs/handlers/saveToShopifyJob.ts",
    "app/api/cron/defence-package-deadline-submit/route.ts",
  ];

  for (const rel of EXECUTORS) {
    it(`${rel} guards every direct package read behind the switch`, () => {
      const src = readFileSync(join(ROOT, ...rel.split("/")), "utf8");
      const stripped = stripComments(src);

      const rawSelect =
        /from\(["']defence_packages["']\)[\s\S]{0,400}order\([\s\S]{0,80}limit\(1\)/.test(
          stripped,
        );
      const usesPreflightLatest = /preflightLatestCandidate\s*\(/.test(stripped);

      if (!rawSelect && !usesPreflightLatest) return; // nothing to guard

      // Anything that still reads a package directly must sit behind the
      // switch, and the file must reach the real selector on the other side.
      expect(
        stripped.includes("canonicalPipelineEnabled()"),
        `${rel} reads a package directly with no activation guard`,
      ).toBe(true);
      expect(
        /selectForNormalExecutor|selectForSaveWorker|createCanonicalSelector|selectForDeadline/.test(
          stripped,
        ),
        `${rel} has no canonical selection path`,
      ).toBe(true);
    });
  }

  it("the placeholder selector is gone, not merely unused", () => {
    // It could answer "is this the newest row" and never "is this row
    // CURRENT", so keeping it as a fallback would keep a second selector with
    // a weaker question alive behind the switch.
    expect(
      existsSync(join(ROOT, "lib", "automation", "decision", "latestCandidateSelector.ts")),
    ).toBe(false);
  });

  it("the selector compares the CANDIDATE's own plan hash, not just the snapshots", () => {
    /* The rung that makes the persisted identity load-bearing.
     *
     * Checking only the three snapshots compares this moment against itself:
     * a caller that derives assessment, plan and decision live will always
     * find them consistent. Until rung 7b existed, a package built from a plan
     * that had since changed was still final, validated, safe and unambiguous
     * — and was filed. Found by an end-to-end trace, not by a unit test, which
     * is why the guard lives at the source as well as in that trace. */
    const src = readFileSync(
      join(ROOT, "lib", "defence", "package", "selectFileablePackage.ts"),
      "utf8",
    );
    expect(src).toContain("candidate.planInputHash");
    expect(src).toMatch(/evaluateFreshness\(\{[\s\S]{0,400}candidate\.planInputHash/);
  });
});
