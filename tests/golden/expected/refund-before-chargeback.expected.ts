import type { GoldenExpected } from "../golden.test";

export const expected: GoldenExpected = {
  coverage: { state: "not_covered", isCovered: false },
  fatalLoss: { triggered: true, reason: "refund_issued" },
  strength: {
    // Underlying signals would be 2 strong (payment_auth + delivery). The
    // fatal-loss gate caps overall at "weak" and forces hard_to_win, but
    // the raw counts remain visible for diagnostics.
    overall: "weak",
    strongCount: 2,
    moderateCount: 0,
    supportingCount: 0,
    heroVariant: "hard_to_win",
  },
  // The fatal-loss gate caps strength but does NOT alter the field
  // mapper — sections persisted in the pack still serialize. The "type:
  // order" section maps to accessActivityLog per FIELD_MAPPINGS.
  shopifyFieldsPopulated: ["accessActivityLog"],
};
