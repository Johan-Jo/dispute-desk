/**
 * Bank-claim plan F3: the bank's claim is context the letter answers, never
 * text it repeats back to the bank.
 */
import { describe, it, expect } from "vitest";
import { findQuotedClaimRun, CLAIM_QUOTE_WORDS } from "../validateNarrative";

const CLAIM =
  "The cardholder states that the linen cushion covers received are smaller and a different colour than shown on the website, and requests a full refund.";

describe("findQuotedClaimRun", () => {
  it("catches a sentence lifted from the claim, whatever the punctuation or case", () => {
    const letter =
      "The Cardholder states that the linen cushion covers received are smaller — this is not supported by the record.";
    expect(findQuotedClaimRun(letter, CLAIM)).toBe("the cardholder states that the linen cushion covers");
  });

  it(`passes an answer in the letter's own words (fewer than ${CLAIM_QUOTE_WORDS} words in a row)`, () => {
    const letter =
      "The goods were delivered as listed: the product page described the covers as 40 × 40 cm in stone grey.";
    expect(findQuotedClaimRun(letter, CLAIM)).toBeNull();
  });

  it("does nothing without a claim, or with a claim too short to quote", () => {
    expect(findQuotedClaimRun("anything at all in this letter here today", null)).toBeNull();
    expect(findQuotedClaimRun("item not as described", "item not as described")).toBeNull();
  });
});
