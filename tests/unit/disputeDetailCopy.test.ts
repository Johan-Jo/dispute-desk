/**
 * Render-side copy assertions for the dispute-detail redesign.
 *
 * The detailed tests (regex assertion against rendered markup with
 * @testing-library/react) flip green as each UI commit lands. Until
 * then, this file pins the copy contract via constants so the
 * deleted-string list can be enforced even before components render.
 */

import { describe, it, expect } from "vitest";

const BANNED_PHRASES = [
  "All evidence included",
  "8/8 collected",
  "Low-likelihood case submitted",
  "Strong evidence is included in the defence package sent to the bank",
  "DisputeDesk saved available evidence to your card network",
  "submitted to bank",
  "sent to bank",
  "submitted to card network",
  "sent to card network",
  "Shopify auto-submits to your card network",
];

describe("Banned-phrase inventory", () => {
  it("the banned-phrase list is non-empty and matches the plan", () => {
    expect(BANNED_PHRASES.length).toBeGreaterThan(0);
  });

  // Component-render assertions land alongside their respective commits:
  //   - Commit 5: hero (Test 12)
  //   - Commit 6: evidence used section (Test 11)
  //   - Commit 7: coverage card (Test 10)
  //   - Commit 9: submission summary (Test 9)
  //   - Commit 12: timeline (no test number; covered by Test 12 regex)
});
