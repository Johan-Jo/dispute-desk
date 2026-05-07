import type { GoldenExpected } from "../golden.test";

export const expected: GoldenExpected = {
  coverage: { state: "not_covered", isCovered: false },
  fatalLoss: { triggered: false, reason: null },
  strength: {
    // policy_cancellation (cancellation_policy.acceptedAtCheckout +
    // timestamp) + communication (customer_communication.customerConfirmsOrder).
    // 2 strong signals across two signalIds. order_confirmation is
    // supportingOnly → +1 supportingCount.
    overall: "strong",
    strongCount: 2,
    moderateCount: 0,
    supportingCount: 1, // order_confirmation (supportingOnly)
    heroVariant: "likely_to_win",
  },
  // packSections: policy (terms) + comms.
  // - policy with terms is serialized into uncategorizedText? Let me check
  //   fieldMapping... actually "policy" type maps to refundPolicyDisclosure
  //   per FIELD_MAPPINGS. But the policy serializer for "terms" produces
  //   text content ("The store's terms of service were presented…"), so
  //   refundPolicyDisclosure ends up populated.
  // - comms maps to uncategorizedText.
  shopifyFieldsPopulated: ["refundPolicyDisclosure", "uncategorizedText"],
};
