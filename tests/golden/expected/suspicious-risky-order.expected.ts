import type { GoldenExpected } from "../golden.test";

export const expected: GoldenExpected = {
  coverage: { state: "not_covered", isCovered: false },
  fatalLoss: { triggered: false, reason: null },
  strength: {
    // AVS+CVV both fail → invalid (excluded). VPN flag → ip_location supporting.
    // shipping_tracking label_created → invalid. Nothing reaches strong/moderate.
    overall: "weak",
    strongCount: 0,
    moderateCount: 0,
    supportingCount: 1, // ip_location_check downgrade
    heroVariant: "hard_to_win",
  },
  shopifyFieldsPopulated: [],
};
