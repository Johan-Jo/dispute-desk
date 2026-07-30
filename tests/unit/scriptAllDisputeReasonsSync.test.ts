import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ALL_DISPUTE_REASONS } from "@/lib/rules/disputeReasons";
import { readAllDisputeReasons } from "../../scripts/lib/allDisputeReasons.mjs";

/**
 * Node scripts must READ the dispute-reason list, never copy it.
 *
 * This test used to assert that `scripts/check-shopify-reasons.mjs`'s own
 * hardcoded copy matched `ALL_DISPUTE_REASONS` — and it passed happily while
 * BOTH carried `SUBSCRIPTION_CANCELED`, a spelling Shopify's enum has never
 * contained (2026-07-28). Two copies agreeing with each other says nothing
 * about either being right, and the script in question is the *drift checker*.
 *
 * So the guard changed shape: there is now one list, parsed out of the TS
 * source by `scripts/lib/allDisputeReasons.mjs`. Correctness against Shopify's
 * actual enum is pinned separately in
 * `lib/rules/__tests__/shopifyReasonEnum.test.ts`.
 */
describe("node scripts share one dispute-reason list", () => {
  it("the shared parser returns exactly ALL_DISPUTE_REASONS", () => {
    expect(readAllDisputeReasons()).toEqual([...ALL_DISPUTE_REASONS]);
  });

  it("check-shopify-reasons.mjs holds no copy of its own", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/check-shopify-reasons.mjs"),
      "utf8",
    );

    expect(source).toContain("readAllDisputeReasons");
    // A literal array assigned to the name is the copy this replaced.
    expect(source).not.toMatch(/const\s+ALL_DISPUTE_REASONS\s*=\s*\[/);
  });
});
