/**
 * Strategy: authentication signal stack (unauthorized_fraud family).
 *
 * Selected when ANY of: 3-D Secure authenticated, or AVS+CVV match.
 * Frames the representment around the authentication factors that are
 * specific to the cardholder, without overclaiming card-present
 * possession.
 */

import type { StrategySubmodule } from "../types";

export const unauthorized_fraud_auth_signal_stack: StrategySubmodule = {
  key: "unauthorized_fraud_auth_signal_stack",
  familyKey: "unauthorized_fraud",
  displayName: "Authentication signal stack",
  predicates: {
    any: ["three_d_secure_present", "avs_and_cvv_match"],
  },
  isFallback: false,
  priority: 10,
  promptBody: [
    "STRATEGY FOCUS — authentication signal stack:",
    "Lead the executiveSummary and paymentAuthenticationArgument with the authentication factors that are specifically tied to the legitimate cardholder.",
    "When 3-D Secure is on record (approved payment_authentication fact with threeDS=true), cite it explicitly. When AVS+CVV both match (avsResult='Y' AND cvvResult='M'), describe them as the verification credentials that match issuer records — never as 'possession of the physical card'.",
    "Frame the stack as 'consistent with a cardholder-authorized transaction' or 'supports the conclusion that the transaction was authorized'. Never use absolute conclusions ('proves', 'definitively', 'establishes that the transaction was authorized').",
    "If the ADDRESS matched but the security code did not, hedge to 'partial verification credentials match issuer records' — do not imply the missing element was confirmed.",
    "If the security code matched and the address did NOT (or was not verified), say nothing about either. A security-code match is not an address match, and a case with no address verification carries no AVS argument to make.",
  ].join("\n"),
  version: 1,
};
