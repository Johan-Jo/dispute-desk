import type { GoldenExpected } from "../golden.test";

export const expected: GoldenExpected = {
  coverage: { state: "not_covered", isCovered: false },
  fatalLoss: { triggered: false, reason: null },
  strength: {
    // communication (customer_communication.customerConfirmsOrder) +
    // policy_refund (refund_policy.acceptedAtCheckout + timestamp).
    // 2 strong signals across two signalIds. product_description is
    // supportingOnly → +1 to supportingCount.
    overall: "strong",
    strongCount: 2,
    moderateCount: 0,
    supportingCount: 1, // product_description (supportingOnly)
    heroVariant: "likely_to_win",
  },
  // packSections: order, comms, policy → uncategorizedText (comms) +
  // refundPolicyDisclosure (policy with refunds) + accessActivityLog (order).
  shopifyFieldsPopulated: ["accessActivityLog", "refundPolicyDisclosure", "uncategorizedText"],
};
