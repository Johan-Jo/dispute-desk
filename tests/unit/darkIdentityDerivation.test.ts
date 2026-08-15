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

  it("reads `planned` ONLY in the four dark-identity regions", () => {
    /* The whole invariant. Every other read must be `activePlan`, or that
     * decision is running the canonical route with the switch off.
     *
     * Four regions, not two, since 2026-08-15. The document verdict deadlock
     * (see the file header of `buildDefencePackageJob`) forced the projection
     * and the document validation to run dark as well, so `planned` legitimately
     * feeds them. What did NOT change is the rule: none of these four may reach
     * `composedBlocks` or any other behavioural decision, which the next test
     * pins directly. */
    const reads = [...CODE.matchAll(/\bplanned\b/g)].map((m) => m.index ?? 0);

    const regions: Array<[string, number, number]> = [
      [
        "derivation → activePlan",
        CODE.indexOf("let planned: PlanForCase | null = null;"),
        CODE.indexOf(";", CODE.indexOf("const activePlan =")),
      ],
      [
        "dark projection",
        CODE.indexOf("let darkProjection"),
        CODE.indexOf("if (activePlan) {", CODE.indexOf("let darkProjection")),
      ],
      [
        "dark document validation",
        CODE.indexOf("let darkDocumentPassed"),
        CODE.indexOf("if (!composedValidation.ok)", CODE.indexOf("let darkDocumentPassed")),
      ],
      [
        "identity columns",
        CODE.indexOf("const canonicalIdentityColumns ="),
        CODE.indexOf("document_failure_codes:", CODE.indexOf("const canonicalIdentityColumns =")),
      ],
    ];

    for (const [name, start, end] of regions) {
      expect(start, `region not found: ${name}`).toBeGreaterThan(-1);
      expect(end, `region end not found: ${name}`).toBeGreaterThan(start);
    }

    const offenders = reads.filter(
      (i) => !regions.some(([, start, end]) => i >= start && i <= end),
    );

    expect(
      offenders.map((i) => CODE.slice(Math.max(0, i - 70), i + 40).trim()),
      "`planned` is the plan as IDENTITY. A consumer that reads it instead of " +
        "`activePlan` runs the canonical route with the switch off — see the " +
        "header of this file.",
    ).toEqual([]);
  });

  it("projects the dark document from the CANONICAL fact list, not the legacy one", () => {
    /* The trap this avoids, which no behavioural test can see.
     *
     * `planFacts` is reassigned only inside `if (activePlan)`. While dark it
     * therefore still holds the LEGACY selection, so projecting the canonical
     * plan over it yields a hybrid document belonging to neither route — and a
     * verdict stamped from that hybrid would not predict what rung 9 reads
     * after the flip, which is the only reason the column is stamped at all.
     *
     * With the switch off the two lists frequently agree, so this would pass
     * every fixture and be wrong exactly on the cases where the plan EXCLUDES
     * something — the same population the header of this file describes. */
    const start = CODE.indexOf("let darkPlanFacts");
    expect(start, "darkPlanFacts not found").toBeGreaterThan(-1);
    const end = CODE.indexOf("if (activePlan) {", start);
    const region = CODE.slice(start, end);

    expect(region).toContain("selectPlanFacts(planned.plan, planned.factsByRecordId)");
    expect(
      region,
      "the dark projection must receive `darkPlanFacts` — passing `planFacts` " +
        "projects the canonical plan over the LEGACY fact selection.",
    ).toContain("bankIncludedFacts: darkPlanFacts,");
  });

  it("never lets the DARK projection reach the composed document", () => {
    /* The hazard the dark projection introduces, and the reason it is a
     * separate variable rather than an un-gating of the existing one.
     *
     * `composedBlocks` feeds the PDF an issuer reads. If it ever resolved to
     * `darkProjection.blocks`, the canonical projection would be selecting
     * bank-facing content with the switch OFF — a live change wearing a dark
     * change's name, and one no behavioural test would catch while the two
     * projections agree. */
    const start = CODE.indexOf("const composedBlocks =");
    expect(start, "composedBlocks assignment not found").toBeGreaterThan(-1);
    const end = CODE.indexOf("});", CODE.indexOf("composePdfBlocks({", start));
    const region = CODE.slice(start, end);

    expect(region).toContain("projection?.blocks");
    expect(
      region,
      "`composedBlocks` must compose from the ACTIVE projection or the legacy " +
        "path — never from the dark one.",
    ).not.toContain("darkProjection");
  });

  it("stamps a document verdict it ACTUALLY reached, never an assumed one", () => {
    /* This assertion inverted on 2026-08-15, and the inversion is the point.
     *
     * It used to pin `document_validation_passed: activePlan ? true : null` —
     * correct as far as it went, because stamping `true` for a check that never
     * ran is a lie in the column rung 9 trusts. What nobody checked was rung 9,
     * which refuses `validationPassed !== true`. With all 55 open cases stamped
     * and drained, the flip would have answered `validation_failed` for every
     * one of them: the verdict could only be written after the flip that needed
     * it. Blocker 1.1's deadlock, one column over.
     *
     * The resolution is neither `true` nor a relaxed rung 9 — it is running the
     * check. So the column must carry the DARK verdict (a real result) and must
     * never again be a ternary on the switch. */
    expect(CODE).toContain("document_validation_passed: darkDocumentPassed,");
    expect(CODE).not.toMatch(/document_validation_passed:\s*activePlan\s*\?/);

    /* `null` must still survive the case where no plan or projection could be
     * derived — genuinely "not assessed", which rung 9 refuses correctly. */
    expect(CODE).toContain("let darkDocumentPassed: boolean | null = null;");
  });

  it("still clears identity when no plan could be derived", () => {
    /* A rebuild that cannot derive a plan must CLEAR a previous build's
     * identity rather than let the row keep claiming a plan it was not
     * projected from. */
    expect(CODE).toContain("plan_input_hash: null,");
  });
});
