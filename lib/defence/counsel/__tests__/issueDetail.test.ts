/**
 * A rejected counsel letter used to keep only the rule id, so nobody could
 * tell afterwards WHICH sentence a reviewer objected to or why. The internal
 * record (`outcome_detail`, audit event) now carries the offending text and
 * the stated reason, truncated. `validation_errors` is unchanged: it reaches
 * the merchant's browser and never holds the rejected draft's words.
 */
import { describe, expect, it } from "vitest";

import { DETAIL_MAX_CHARS, issueEvidence, issueRecords } from "../issueRules";

describe("issue evidence", () => {
  it("stores the flagged sentence and the reviewer's note for a fact-check", () => {
    const [r] = issueEvidence(['fact-check: "It arrived 14 days later." — no ledger claim gives 14 days']);
    expect(r.rule).toBe("review.fact_check");
    expect(r.detail).toEqual({ text: "It arrived 14 days later.", reason: "no ledger claim gives 14 days" });
  });

  it("stores the quoted span for a code check", () => {
    const [r] = issueEvidence(['summary: meta-talk — "notably"']);
    expect(r.detail.text).toBe("notably");
  });

  it("truncates long text and reasons", () => {
    const long = "x".repeat(2000);
    const [r] = issueEvidence([`fact-check: "${long}" — ${long}`]);
    expect(r.detail.text!.length).toBeLessThanOrEqual(DETAIL_MAX_CHARS);
    expect(r.detail.reason!.length).toBeLessThanOrEqual(DETAIL_MAX_CHARS);
  });

  it("leaves the merchant-visible records free of the draft's words", () => {
    const [r] = issueRecords(['fact-check: "It arrived 14 days later." — no ledger claim gives 14 days']);
    expect(r).not.toHaveProperty("detail");
    expect(JSON.stringify(r)).not.toMatch(/14 days/);
  });
});
