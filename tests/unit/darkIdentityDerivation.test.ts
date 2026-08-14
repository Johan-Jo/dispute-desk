/**
 * Deriving the canonical plan must not switch the pipeline on.
 *
 * ── WHY THIS IS AN INVARIANT AND NOT A UNIT TEST ──────────────────────
 *
 * Activation step 1 (`docs/plans/canonical-pipeline-activation.plan.md` §3)
 * derives `derivePlanForCase` on EVERY build so the canonical identity can
 * accumulate before the switch is flipped — otherwise identity can only exist
 * after activation, and at activation every package without one reads
 * `snapshot_absent` and becomes non-fileable. Measured 2026-08-14: 0 of 398
 * packages carried a hash, so the flip would have made all of them unfileable
 * at once.
 *
 * The risk that creates is the mirror image: `planned` is now non-null while
 * dark, so ANY consumer that reads it — rather than the deliberately-null
 * `activePlan` — silently turns the canonical route on for that one decision,
 * with the switch off and no test failing. Fact selection is the dangerous one:
 * `selectPlanFacts` decides what the model is argued from, so reading the wrong
 * variable there changes bank-facing output while claiming to be dark.
 *
 * A behavioural test cannot catch that, because with the flag off the two
 * variables agree on every case where the plan authorises everything. The
 * defect only appears on the cases where the plan EXCLUDES something — which
 * is exactly the population a fixture is least likely to contain. So the
 * invariant is structural: `planned` may be read in two places, and nowhere
 * else.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "lib/jobs/handlers/buildDefencePackageJob.ts"),
  "utf8",
);

/** Comments name both variables constantly; only code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const CODE = stripComments(SRC);

describe("the dark identity split", () => {
  it("keeps a behavioural plan that is null while the switch is off", () => {
    expect(CODE).toContain("const activePlan = canonical ? planned : null;");
  });

  it("derives the plan outside the activation gate", () => {
    /* If this moves back inside `if (canonical)`, identity stops accumulating
     * and the activation deadlock returns — silently, because nothing else
     * changes. */
    const derive = CODE.indexOf("derivePlanForCase({");
    const gate = CODE.indexOf("const activePlan =");
    expect(derive).toBeGreaterThan(-1);
    expect(derive).toBeLessThan(gate);
  });

  it("never lets a dark derivation failure break a build the legacy path would finish", () => {
    expect(CODE).toContain("if (canonical) throw err;");
  });

  it("reads `planned` ONLY to derive it and to stamp the identity columns", () => {
    /* The whole invariant. Every other read must be `activePlan`, or that
     * decision is running the canonical route with the switch off. */
    const reads = [...CODE.matchAll(/\bplanned\b/g)].map((m) => m.index ?? 0);

    const deriveStart = CODE.indexOf("let planned: PlanForCase | null = null;");
    // Through the end of the `activePlan` assignment — that statement reads
    // `planned` by definition, and it is the one place that legitimately
    // converts identity into behaviour.
    const deriveEnd = CODE.indexOf(";", CODE.indexOf("const activePlan ="));
    const identityStart = CODE.indexOf("const canonicalIdentityColumns =");
    const identityEnd = CODE.indexOf("document_failure_codes:", identityStart);

    expect(deriveStart, "derivation block not found").toBeGreaterThan(-1);
    expect(identityStart, "identity block not found").toBeGreaterThan(-1);

    const offenders = reads.filter(
      (i) =>
        !(i >= deriveStart && i <= deriveEnd) &&
        !(i >= identityStart && i <= identityEnd),
    );

    expect(
      offenders.map((i) => CODE.slice(Math.max(0, i - 70), i + 40).trim()),
      "`planned` is the plan as IDENTITY. A consumer that reads it instead of " +
        "`activePlan` runs the canonical route with the switch off — see the " +
        "header of this file.",
    ).toEqual([]);
  });

  it("does not stamp a document verdict it never reached", () => {
    /* `plan_*` describe what the package was built FROM and are true whether or
     * not the canonical consumers ran. `document_validation_passed` is a
     * VERDICT, and `validatePackageDocument` does not execute while dark —
     * stamping `true` would record a check we did not perform, in the column
     * `selectFileablePackage` rung 9 refuses on. */
    expect(CODE).toContain("document_validation_passed: activePlan ? true : null,");
    expect(CODE).toContain("document_failure_codes: activePlan ? documentFailureCodes : null,");
  });

  it("still clears identity when no plan could be derived", () => {
    /* A rebuild that cannot derive a plan must CLEAR a previous build's
     * identity rather than let the row keep claiming a plan it was not
     * projected from. */
    expect(CODE).toContain("plan_input_hash: null,");
  });
});
