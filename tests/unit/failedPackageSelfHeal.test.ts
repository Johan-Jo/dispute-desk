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

describe("the versions are real, not placeholders", () => {
  it("VALIDATOR_VERSION is a positive integer", () => {
    expect(Number.isInteger(VALIDATOR_VERSION)).toBe(true);
    expect(VALIDATOR_VERSION).toBeGreaterThan(0);
  });

  /* A pin, not an assertion about correctness. Changing detector behaviour
   * without bumping the version means a case that should self-heal will not,
   * and that failure is silent. Updating this number is the reminder. */
  it("VALIDATOR_VERSION is pinned — bump it when validation behaviour changes", () => {
    expect(VALIDATOR_VERSION).toBe(1);
  });

  it("CURRENT_PROMPT_VERSION is a positive integer", () => {
    expect(Number.isInteger(CURRENT_PROMPT_VERSION)).toBe(true);
    expect(CURRENT_PROMPT_VERSION).toBeGreaterThan(0);
  });
});
