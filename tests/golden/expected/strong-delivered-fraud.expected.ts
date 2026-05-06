import type { GoldenExpected } from "../golden.test";

export const expected: GoldenExpected = {
  coverage: { state: "not_covered", isCovered: false },
  fatalLoss: { triggered: false, reason: null },
  strength: {
    overall: "strong",
    strongCount: 3,        // payment_auth + billing_match + delivery (deduped)
    moderateCount: 0,
    supportingCount: 1,    // order_confirmation
    heroVariant: "likely_to_win",
  },
  shopifyFieldsPopulated: ["accessActivityLog", "refundPolicyDisclosure"],
};
