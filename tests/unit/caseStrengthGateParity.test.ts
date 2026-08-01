/**
 * Every PRODUCTION caller of `calculateCaseStrength` must pass the
 * credit-already-issued floor.
 *
 * `calculateCaseStrength` takes its gates as trailing OPTIONAL
 * positional arguments — coverage, fatal-loss, risk-weakness,
 * name-mismatch, credit-already-issued. A call site that omits one
 * still compiles and still returns a plausible number, so the compiler
 * cannot tell you a gate is missing.
 *
 * On 2026-08-01 that cost a real submission: the credit floor was added
 * to `buildPack` only. `buildPack` scored blume-box 162042cd `strong`,
 * the auto-submit path filed the evidence to Shopify and emailed the
 * merchant "Evidence submitted" — while the dispute page, which
 * recomputes strength through two OTHER call sites that had not been
 * updated, rendered "Weak case" and advised adding delivery
 * confirmation to an order that had already been refunded.
 *
 * This test enumerates the production call sites and fails when one
 * drops the gate, in the same spirit as the cron `envGate` enumeration.
 *
 * NOTE: this is a text-level guard, and a weaker one than a type error.
 * The real fix is collapsing the trailing optionals into a single
 * REQUIRED `gates` object, so adding a gate breaks every call site at
 * compile time. Tracked separately — do not treat this test as making
 * that unnecessary.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Production files that score a dispute. Tests are excluded — they
 *  exercise the gates deliberately and in isolation. */
const PRODUCTION_CALL_SITES = [
  "lib/packs/buildPack.ts",
  "app/api/disputes/[id]/workspace/route.ts",
  "app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace.ts",
];

describe("calculateCaseStrength gate parity", () => {
  for (const rel of PRODUCTION_CALL_SITES) {
    it(`${rel} passes the credit-already-issued floor`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(
        src.includes("calculateCaseStrength("),
        `${rel} no longer calls calculateCaseStrength — update PRODUCTION_CALL_SITES`,
      ).toBe(true);
      // Either the shared reader, or the value it produces threaded
      // through the API response.
      const passesGate =
        src.includes("creditAlreadyIssuedInput") ||
        src.includes("creditAlreadyIssued");
      expect(
        passesGate,
        `${rel} calls calculateCaseStrength without the credit-already-issued gate. ` +
          `A missing gate does not fail to compile — it silently scores the case ` +
          `without the floor, which is how 162042cd was submitted as strong while ` +
          `the page showed it as weak.`,
      ).toBe(true);
    });
  }

  it("the enumeration has not gone stale", () => {
    // If a new production file starts scoring disputes it must be added
    // above. Cheap guard: the known sites still exist.
    for (const rel of PRODUCTION_CALL_SITES) {
      expect(() => readFileSync(join(ROOT, rel), "utf8")).not.toThrow();
    }
  });
});
