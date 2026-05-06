import type { GoldenExpected } from "../golden.test";

export const expected: GoldenExpected = {
  coverage: { state: "not_covered", isCovered: false },
  fatalLoss: { triggered: false, reason: null },
  strength: {
    overall: "insufficient",
    strongCount: 0,
    moderateCount: 0,
    supportingCount: 0,
    heroVariant: "hard_to_win",
  },
  shopifyFieldsPopulated: [],
};
