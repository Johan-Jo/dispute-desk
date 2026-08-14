/**
 * A failure may be retried when the rules that produced it have changed — and
 * never otherwise.
 *
 * ── THE TWO HAZARDS, AND WHY BOTH MATTER ──────────────────────────────
 *
 * REGENERATION LOOP (the reason the guard exists, 2026-08-11). Rebuilding a
 * failed package under the rules that failed it produces the same failure,
 * spends an LLM call, and buries the original error under a new row.
 *
 * PERMANENT DEATH (the reason it was too strict, measured 2026-08-12). Fourteen
 * open disputes held a `failed` latest package, every one `validation_failed` —
 * a machine verdict, not a human rejection. `#12936` had been blocked three
 * weeks past its deadline; `#353605` lost its deadline while two prompt
 * versions shipped past it. Seven failed at prompt 13, the CURRENT version, so
 * a generator-version test alone would have kept them blocked: the fix that
 * unblocked them was #539 in `claimCapabilities.ts` — the VALIDATOR changed,
 * not the prompt. That is why `validator_version` exists.
 */

import { describe, expect, it } from "vitest";
import {
  evaluateGenerationGuard,
  type CurrentGenerationInputs,
  type LatestPackageRow,
} from "@/lib/defence/latestPackageGenerationGuard";
import { VALIDATOR_VERSION } from "@/lib/defence/validateNarrative";
import { CURRENT_PROMPT_VERSION } from "@/lib/defence/narrativeWriter";

const NOW: CurrentGenerationInputs = {
  promptVersion: 13,
  validatorVersion: 4,
  evidenceHash: "hash-current",
};

/** A failed row built under exactly the current rules. */
const FAILED_CURRENT: LatestPackageRow = {
  id: "pkg-1",
  version: 4,
  status: "failed",
  validation_status: "failed",
  failure_code: "validation_failed",
  prompt_version: 13,
  validator_version: 4,
  evidence_hash: "hash-current",
};

describe("nothing changed — the loop stays closed", () => {
  it("blocks when prompt, validator and evidence all match", () => {
    const v = evaluateGenerationGuard(FAILED_CURRENT, NOW);
    expect(v.blocked).toBe(true);
    expect(v.reason).toBe("latest_package_failed");
    expect(v.retryBasis).toEqual([]);
  });

  it("blocks with no `current` supplied — a caller that cannot answer gets no pass", () => {
    expect(evaluateGenerationGuard(FAILED_CURRENT).blocked).toBe(true);
  });

  it("a SECOND failure under the same rules blocks again — the retry is bounded at one", () => {
    // The rebuild allowed below writes all three columns; this is that row.
    const afterRetry: LatestPackageRow = { ...FAILED_CURRENT, version: 5 };
    expect(evaluateGenerationGuard(afterRetry, NOW).blocked).toBe(true);
  });
});

describe("something changed — the case recovers by itself", () => {
  it("allows when the VALIDATOR moved (the #539 case)", () => {
    const v = evaluateGenerationGuard({ ...FAILED_CURRENT, validator_version: 3 }, NOW);
    expect(v.blocked).toBe(false);
    expect(v.retryBasis).toContain("validator_version_changed");
  });

  it("allows when the GENERATOR moved", () => {
    const v = evaluateGenerationGuard({ ...FAILED_CURRENT, prompt_version: 10 }, NOW);
    expect(v.blocked).toBe(false);
    expect(v.retryBasis).toContain("prompt_version_changed");
  });

  it("allows when the EVIDENCE moved", () => {
    const v = evaluateGenerationGuard({ ...FAILED_CURRENT, evidence_hash: "hash-old" }, NOW);
    expect(v.blocked).toBe(false);
    expect(v.retryBasis).toContain("evidence_changed");
  });

  it("reports every basis that moved, not just the first", () => {
    const v = evaluateGenerationGuard(
      { ...FAILED_CURRENT, prompt_version: 10, validator_version: 3, evidence_hash: "old" },
      NOW,
    );
    expect(v.retryBasis.sort()).toEqual(
      ["evidence_changed", "prompt_version_changed", "validator_version_changed"].sort(),
    );
  });
});

describe("rows built before versioning", () => {
  /* NULL is "not recorded", which is not evidence of sameness. Treating it as
   * unchanged would strand every pre-existing failure permanently — the exact
   * fourteen this change exists to free. They get ONE attempt under current
   * rules; the rebuild writes the columns, and a second identical failure
   * blocks. */
  it("a NULL validator version counts as changed", () => {
    const v = evaluateGenerationGuard({ ...FAILED_CURRENT, validator_version: null }, NOW);
    expect(v.blocked).toBe(false);
    expect(v.retryBasis).toContain("validator_version_changed");
  });

  it("a NULL prompt version counts as changed", () => {
    const v = evaluateGenerationGuard({ ...FAILED_CURRENT, prompt_version: null }, NOW);
    expect(v.blocked).toBe(false);
  });

  it("the real production shape — all fourteen become eligible exactly once", () => {
    // Measured: status/validation failed, prompt 8|10|12|13, no validator
    // version, evidence hash present.
    for (const promptVersion of [8, 10, 12, 13]) {
      const row: LatestPackageRow = {
        id: "pkg",
        version: 4,
        status: "failed",
        validation_status: "failed",
        failure_code: "validation_failed",
        prompt_version: promptVersion,
        validator_version: null,
        evidence_hash: "hash-current",
      };
      expect(evaluateGenerationGuard(row, NOW).blocked).toBe(false);
    }
  });
});

describe("non-failed rows are untouched", () => {
  for (const status of ["draft", "stale", "final", "submitted", "superseded", "skipped"]) {
    it(`${status} is allowed and reports no retry basis`, () => {
      const v = evaluateGenerationGuard({ ...FAILED_CURRENT, status, validation_status: "ok" }, NOW);
      expect(v.blocked).toBe(false);
      expect(v.retryBasis).toEqual([]);
    });
  }

  it("no previous package at all is allowed", () => {
    expect(evaluateGenerationGuard(null, NOW).blocked).toBe(false);
  });

  it("a half-written failure (validation failed, status disagrees) still blocks", () => {
    const v = evaluateGenerationGuard(
      { ...FAILED_CURRENT, status: "draft", validation_status: "failed" },
      NOW,
    );
    expect(v.blocked).toBe(true);
    expect(v.reason).toBe("latest_package_validation_failed");
  });
});

describe("every call site asks the SAME question", () => {
  /* THE DEFECT THIS PINS, 2026-08-12.
   *
   * The guard has two call sites: `maybeEnqueueDefencePackage` decides whether
   * to CREATE a draft, and `buildDefencePackageJob` re-checks defensively
   * before building it. The first was given the current versions; the second
   * was not.
   *
   * `evaluateGenerationGuard` blocks when it cannot answer, which is right —
   * but it made the worker refuse the very job the enqueue site had just
   * decided was a legitimate retry. Three disputes (#352513, #352511, #352555)
   * came out with an empty draft stranded above their real failure and
   * `generation_blocked: latest_package_failed` on the job.
   *
   * A defensive re-check that asks a DIFFERENT question from the decision it
   * re-checks is not defence; it is a second, contradictory decision. Both
   * sites must pass `current`, and this asserts the disagreement they had.
   */
  const STRANDED: LatestPackageRow = {
    id: "pkg-prior",
    version: 4,
    status: "failed",
    validation_status: "failed",
    failure_code: "validation_failed",
    prompt_version: 13,
    validator_version: null, // pre-versioning, as all 14 production rows were
    evidence_hash: "hash-current",
  };

  it("without `current` the guard blocks — the fallback that stranded the drafts", () => {
    expect(evaluateGenerationGuard(STRANDED).blocked).toBe(true);
  });

  it("with `current` it allows — so a caller omitting it CONTRADICTS the enqueue decision", () => {
    expect(evaluateGenerationGuard(STRANDED, NOW).blocked).toBe(false);
  });

  it("the two verdicts must not differ for the same row — pass `current` at every site", () => {
    const withoutCurrent = evaluateGenerationGuard(STRANDED).blocked;
    const withCurrent = evaluateGenerationGuard(STRANDED, NOW).blocked;
    expect(
      withoutCurrent === withCurrent,
      "a call site that omits `current` reaches the opposite verdict; both sites must supply it",
    ).toBe(false);
  });
});

describe("the versions are real, not placeholders", () => {
  it("VALIDATOR_VERSION is a positive integer", () => {
    expect(Number.isInteger(VALIDATOR_VERSION)).toBe(true);
    expect(VALIDATOR_VERSION).toBeGreaterThan(0);
  });

  /* A pin, not an assertion about correctness. Changing detector behaviour
   * without bumping the version means a case that should self-heal will not,
   * and that failure is silent. Updating this number is the reminder. */
  it("VALIDATOR_VERSION is pinned — bump it when validation behaviour changes", () => {
    expect(VALIDATOR_VERSION).toBe(2);
  });

  it("unblocks the row that proved the pin is not decorative", () => {
    /* blume-box 11051073729 v5, verbatim from production. It failed under the
     * OLD detector; #561 replaced that detector and left this constant at 1, so
     * a merchant-clicked Regenerate on 2026-08-14T14:30Z answered
     * `defence_package_generation_skipped / latest_package_failed` — prompt,
     * validator and evidence all matched, so the guard correctly called it the
     * same attempt. Nine open blume-box cases were dead the same way.
     *
     * Both directions are asserted: the bump is what unblocks it, and with the
     * old value it still blocks — so this fails if someone reverts the constant
     * and fails if someone weakens the guard. */
    const v5: LatestPackageRow = {
      id: "b3f37324-2d54-40cb-9d76-326d63c73c25",
      version: 5,
      status: "failed",
      validation_status: "failed",
      failure_code: "validation_failed",
      prompt_version: 14,
      validator_version: 1,
      evidence_hash: "9012d4c3c6b2be92803cae2a492ace4f648e69140a39b82f203d72e245e43231",
    };
    const unchangedExceptValidator: CurrentGenerationInputs = {
      promptVersion: 14,
      validatorVersion: VALIDATOR_VERSION,
      evidenceHash: v5.evidence_hash!,
    };

    const now = evaluateGenerationGuard(v5, unchangedExceptValidator);
    expect(now.blocked).toBe(false);
    expect(now.retryBasis).toContain("validator_version_changed");

    const before = evaluateGenerationGuard(v5, {
      ...unchangedExceptValidator,
      validatorVersion: 1,
    });
    expect(before.blocked).toBe(true);
    expect(before.reason).toBe("latest_package_failed");
  });

  it("CURRENT_PROMPT_VERSION is a positive integer", () => {
    expect(Number.isInteger(CURRENT_PROMPT_VERSION)).toBe(true);
    expect(CURRENT_PROMPT_VERSION).toBeGreaterThan(0);
  });
});
