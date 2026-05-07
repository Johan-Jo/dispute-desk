import type { GoldenExpected } from "../golden.test";

export const expected: GoldenExpected = {
  coverage: { state: "not_covered", isCovered: false },
  fatalLoss: { triggered: false, reason: null },
  strength: {
    // payment_auth (avs_cvv) + billing_match → 2 strong signals across
    // two signalIds. Generic count formula (non-fraud family): 2 strong → strong.
    overall: "strong",
    strongCount: 2,
    moderateCount: 0,
    supportingCount: 1, // duplicate_explanation
    heroVariant: "likely_to_win",
  },
  shopifyFieldsPopulated: ["accessActivityLog"],
};
