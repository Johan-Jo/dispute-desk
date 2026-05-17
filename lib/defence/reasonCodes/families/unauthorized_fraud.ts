/**
 * Family: unauthorized fraud (Visa 10.x, MC 4837 family).
 *
 * Bank-side claim: the cardholder did not authorize the transaction.
 * Cross-module strategy is to surface authentication factors specific to
 * the cardholder (AVS, CVV, 3-D Secure when present), billing alignment,
 * and any prior-purchase behaviour that's consistent with a legitimate
 * cardholder session.
 */

import type { ReasonCodeFamily } from "../../types";

export const unauthorized_fraud: ReasonCodeFamily = {
  key: "unauthorized_fraud",
  displayName: "Unauthorized transaction (fraud)",
  moduleKeys: ["visa_10_4_fraud"],
  unmodeledCodes: [],
  fallbackModuleKey: "visa_10_4_fraud",
  overlayPromptBody: [
    "Unauthorized-claim family overlay:",
    "",
    "The reason code names the cardholder/issuer's CLAIM CATEGORY. It is",
    "not a merchant-asserted fact. Do not restate network environment",
    "classifications or fraud-label wording as merchant prose. Use the",
    "approved facts to explain why the available records support the",
    "merchant's position.",
    "",
    "The network reason-code reference may appear verbatim (e.g.",
    "the entry in the Case Details metadata row) only as the reason-code",
    "identifier, never in argumentative paragraphs.",
  ].join("\n"),
  familyAvoid: [],
  // Hard-banned phrases — always rejected in bank-facing prose. These
  // are the network's classification words; a merchant rebuttal must
  // never echo them. The validator's runtime check rejects matches in
  // every layer (narrative, thesis, llm, fallback). v2.2.
  prohibitedBankPhrases: [
    /\bcard\s*absent\b/i,
    /\bcard\s*missing\b/i,
    /\bcard[- ]not[- ]present\b/i,
    /\bother\s+fraud\b/i,
    /\bfriendly\s+fraud\b/i,
  ],
  // Predicate-gated phrases — these are neutral descriptors when the
  // facts support them and bank-framing substitution when they don't.
  // "online/ecommerce transaction" is only safe to say when the
  // order_record fact carries a channel value in the online set
  // (web/android/iphone). For POS or draft orders the phrase is
  // rejected. v2.2.
  guardedBankPhrases: [
    { pattern: /\becommerce\s+transaction\b/i, requires: "transaction_channel_online_present" },
    { pattern: /\bonline\s+transaction\b/i, requires: "transaction_channel_online_present" },
  ],
  version: 2,
};
