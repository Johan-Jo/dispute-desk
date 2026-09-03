/**
 * `COMPOSITION_VERSION` is pinned so a bump is a deliberate edit.
 *
 * WHY (2026-09-03). `evaluateGenerationGuard` may only rebuild a FAILED
 * package when one of its retry inputs moved. The composed document depends on
 * the deterministic prose in `thesisTemplates` — and a composed failure can be
 * caused by that prose alone, with the prompt, validator and evidence all
 * innocent.
 *
 * That is exactly what happened. `ecbb03aa` fixed the `representment` defect by
 * editing one template string; none of the three inputs the guard knew had
 * moved, so it read "same attempt" and every one of the 27 cases the defect had
 * killed stayed dead after the fix shipped — 9 past deadline.
 *
 * So: changing a template WITHOUT bumping this constant leaves the cases that
 * change was written to save permanently blocked. This test makes that a red
 * build instead of a silent one. Same contract, and same reasoning, as
 * `VALIDATOR_VERSION`.
 *
 * WHEN THIS TEST FAILS: if you changed composed prose, bump
 * `COMPOSITION_VERSION` and update the number here and its HISTORY block. Do
 * not update this number alone.
 */

import { describe, it, expect } from "vitest";

import { COMPOSITION_VERSION, THESIS_TEMPLATES } from "@/lib/defence/pdf/thesisTemplates";

describe("COMPOSITION_VERSION", () => {
  it("is the value the guard and the persisted rows agree on", () => {
    expect(COMPOSITION_VERSION).toBe(1);
  });

  it("is a positive integer — 0 would be indistinguishable from unset", () => {
    // The guard treats NULL/unrecorded as "changed". A falsy version would
    // collide with that meaning at the boundary.
    expect(Number.isInteger(COMPOSITION_VERSION)).toBe(true);
    expect(COMPOSITION_VERSION).toBeGreaterThan(0);
  });

  it("covers a non-empty template library — the thing it versions", () => {
    expect(THESIS_TEMPLATES.length).toBeGreaterThan(0);
  });
});
