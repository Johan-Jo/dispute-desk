import { describe, expect, it } from "vitest";
import { resolveOutcomeDecisionDate } from "../outcomeDecisionDate";

describe("resolveOutcomeDecisionDate", () => {
  it("uses the decision timestamp when evidence was filed earlier", () => {
    expect(
      resolveOutcomeDecisionDate({
        submittedAt: "2026-08-15T12:00:00Z",
        closedAt: "2026-08-28T21:09:00Z",
      }),
    ).toBe("2026-08-28T21:09:00Z");
  });

  it("does not present the filing timestamp as a decision date", () => {
    expect(
      resolveOutcomeDecisionDate({
        submittedAt: "2026-08-15T12:00:00Z",
        closedAt: null,
      }),
    ).toBeNull();
  });
});
