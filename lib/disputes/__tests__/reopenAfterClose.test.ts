import { describe, expect, it } from "vitest";
import { isReopenAfterClose, isReopenedOpenDispute, outcomeKeySuffix, reopenAfterCloseUpdate } from "../reopenAfterClose";

describe("reopen after close", () => {
  it("a non-final status after an outcome is a reopen", () => {
    expect(isReopenAfterClose({ existingFinalOutcome: "won", newStatus: "needs_response" })).toBe(true);
    expect(isReopenAfterClose({ existingFinalOutcome: "won", newStatus: "under_review" })).toBe(true);
    expect(isReopenAfterClose({ existingFinalOutcome: "lost", newStatus: "UNDER_REVIEW" })).toBe(true);
  });

  it("a final status, no outcome, or the 'pending' default is not a reopen", () => {
    expect(isReopenAfterClose({ existingFinalOutcome: "won", newStatus: "won" })).toBe(false);
    expect(isReopenAfterClose({ existingFinalOutcome: "won", newStatus: "lost" })).toBe(false);
    expect(isReopenAfterClose({ existingFinalOutcome: null, newStatus: "needs_response" })).toBe(false);
    expect(isReopenAfterClose({ existingFinalOutcome: "pending", newStatus: "needs_response" })).toBe(false);
    expect(isReopenAfterClose({ existingFinalOutcome: "won", newStatus: null })).toBe(false);
  });

  it("clears the outcome and keeps the previous one", () => {
    expect(reopenAfterCloseUpdate("won", "2026-09-22T00:00:00Z")).toEqual({
      final_outcome: null,
      closed_at: null,
      outcome_amount_recovered: null,
      outcome_amount_lost: null,
      outcome_source: null,
      outcome_confidence: null,
      previous_final_outcome: "won",
      reopened_after_close_at: "2026-09-22T00:00:00Z",
    });
  });

  it("outcome keys are unchanged for a dispute never reopened", () => {
    expect(outcomeKeySuffix(null)).toBe("");
    expect(outcomeKeySuffix("2026-09-22T00:00:00.123Z")).toBe(":after_reopen_2026-09-22T00:00:00Z");
  });

  it("the Reopened badge shows on open disputes only", () => {
    expect(isReopenedOpenDispute({ reopened_after_close_at: "2026-09-22T00:00:00Z" })).toBe(true);
    expect(isReopenedOpenDispute({ response_cycle: 2 })).toBe(true);
    expect(isReopenedOpenDispute({ response_cycle: 1 })).toBe(false);
    expect(isReopenedOpenDispute({ response_cycle: 2, final_outcome: "won" })).toBe(false);
    expect(isReopenedOpenDispute({ reopened_after_close_at: "2026-09-22T00:00:00Z", closed_at: "2026-10-20T00:00:00Z" })).toBe(false);
    expect(isReopenedOpenDispute({ response_cycle: 2, final_outcome: "pending" })).toBe(true);
  });
});
