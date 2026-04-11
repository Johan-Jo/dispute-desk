import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ALL_DISPUTE_REASONS } from "@/lib/rules/disputeReasons";

/**
 * Guards against drift between the TypeScript source of truth
 * (lib/rules/disputeReasons.ts ALL_DISPUTE_REASONS) and the
 * standalone Node script scripts/check-shopify-reasons.mjs that
 * carries its own copy of the list because it runs without a
 * TypeScript toolchain.
 *
 * If this test fails, someone edited ALL_DISPUTE_REASONS without
 * updating the script (or vice versa). Fix by mirroring the change.
 */
describe("scripts/check-shopify-reasons.mjs ALL_DISPUTE_REASONS sync", () => {
  it("matches lib/rules/disputeReasons.ts ALL_DISPUTE_REASONS exactly", () => {
    const scriptPath = resolve(
      process.cwd(),
      "scripts/check-shopify-reasons.mjs",
    );
    const source = readFileSync(scriptPath, "utf8");

    // Extract the ALL_DISPUTE_REASONS array literal. The const is the
    // only variable in the script with that name, and it's a plain
    // string-literal array, so a straightforward regex is enough.
    const match = source.match(
      /const\s+ALL_DISPUTE_REASONS\s*=\s*\[([\s\S]*?)\]/,
    );
    expect(
      match,
      "couldn't find ALL_DISPUTE_REASONS in scripts/check-shopify-reasons.mjs",
    ).toBeTruthy();

    const body = match![1];
    const scriptReasons = Array.from(body.matchAll(/"([A-Z_]+)"/g)).map(
      (m) => m[1],
    );

    // Sort both so ordering differences don't false-positive.
    const scriptSorted = [...scriptReasons].sort();
    const sourceSorted = [...ALL_DISPUTE_REASONS].sort();

    expect(scriptSorted).toEqual(sourceSorted);
  });
});
