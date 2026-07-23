import { describe, expect, it } from "vitest";
import {
  REVIEW_STATES,
  isReviewAction,
  isReviewState,
  reviewStateForAction,
  blocksAutoSubmit,
  isTerminalReviewDecision,
} from "../reviewState";

describe("reviewState canonical helpers", () => {
  it("recognizes the four action verbs and rejects others", () => {
    for (const a of ["hold", "approve", "concede", "clear"]) {
      expect(isReviewAction(a)).toBe(true);
    }
    expect(isReviewAction("submit")).toBe(false);
    expect(isReviewAction("")).toBe(false);
    expect(isReviewAction(null)).toBe(false);
    expect(isReviewAction(undefined)).toBe(false);
  });

  it("maps actions to states (clear → null)", () => {
    expect(reviewStateForAction("hold")).toBe(REVIEW_STATES.IN_REVIEW);
    expect(reviewStateForAction("approve")).toBe(REVIEW_STATES.APPROVED);
    expect(reviewStateForAction("concede")).toBe(REVIEW_STATES.CONCEDED);
    expect(reviewStateForAction("clear")).toBeNull();
  });

  it("recognizes stored states", () => {
    expect(isReviewState("in_review")).toBe(true);
    expect(isReviewState("approved")).toBe(true);
    expect(isReviewState("conceded")).toBe(true);
    expect(isReviewState("clear")).toBe(false);
    expect(isReviewState(null)).toBe(false);
  });

  it("only conceded blocks auto-submit", () => {
    expect(blocksAutoSubmit("conceded")).toBe(true);
    expect(blocksAutoSubmit("approved")).toBe(false);
    expect(blocksAutoSubmit("in_review")).toBe(false);
    expect(blocksAutoSubmit(null)).toBe(false);
    expect(blocksAutoSubmit(undefined)).toBe(false);
  });

  it("approved + conceded are terminal; in_review is not", () => {
    expect(isTerminalReviewDecision("approved")).toBe(true);
    expect(isTerminalReviewDecision("conceded")).toBe(true);
    expect(isTerminalReviewDecision("in_review")).toBe(false);
    expect(isTerminalReviewDecision(null)).toBe(false);
  });
});
