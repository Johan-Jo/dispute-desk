/**
 * Strategy: authentication signal stack (unauthorized_fraud family).
 *
 * Selected when ANY of: 3-D Secure authenticated, or the canonical
 * `avs_and_cvv_match` predicate holds. Frames the representment around the
 * authentication factors that are specific to the cardholder, without
 * overclaiming card-present possession.
 *
 * PROMPT POLICY CARRIES NO RAW CODES OR NETWORKS (PR-C3). This body used to
 * spell the rule out in gateway codes, which is now wrong in both directions:
 * the canonical predicate also admits a primary-sourced international Visa
 * match, and it withholds a full match on a network whose AVS table we have
 * never read. Restating letters in a prompt is a second definition of the rule
 * that nothing can keep in step — so the prompt names the FACT and quotes the
 * plain-language summary the classifier already built for it. The invariant in
 * `tests/unit/paymentVerificationSingleOwner.test.ts` now fails the build on a
 * code rule inside a string, which is how this one survived review.
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
    "When 3-D Secure is on record (approved payment_authentication fact with threeDS=true), cite it explicitly.",
    "For the address and security-code checks, use ONLY the approved payment_authentication fact and quote its verificationSummary. That summary already states exactly what the issuer confirmed and what may be said about it; it is the whole of what you may claim. Never infer a verification result from a gateway code, and never name a card network.",
    "Describe what the summary states as the verification credentials that match issuer records — never as 'possession of the physical card'.",
    "Frame the stack as 'consistent with a cardholder-authorized transaction' or 'supports the conclusion that the transaction was authorized'. Never use absolute conclusions ('proves', 'definitively', 'establishes that the transaction was authorized').",
    "When the summary names only one of the two checks, hedge to 'partial verification credentials match issuer records' — do not imply the missing element was confirmed.",
    "When the approved fact carries NO verificationSummary, say nothing about the address or the security code at all. An absent summary means there is nothing here we are permitted to assert.",
  ].join("\n"),
  version: 2,
};
