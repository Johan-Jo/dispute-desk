import type { GoldenExpected } from "../golden.test";

export const expected: GoldenExpected = {
  coverage: { state: "not_covered", isCovered: false },
  fatalLoss: { triggered: false, reason: null },
  strength: {
    overall: "strong",
    strongCount: 2,        // account_history (deduped activity_log + customer_account_info) + communication
    moderateCount: 0,
    supportingCount: 1,    // product_description (supportingOnly with non-null payload → supporting)
    heroVariant: "likely_to_win",
  },
  shopifyFieldsPopulated: ["accessActivityLog", "uncategorizedText"],
};
