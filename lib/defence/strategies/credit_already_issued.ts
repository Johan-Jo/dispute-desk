/**
 * Strategy: credit already issued (EVERY family).
 *
 * The one strategy that is not a variation on its family's theory.
 *
 * Every other strategy argues the merits of the claim — the cardholder
 * authorized it, the goods arrived, the item matched the listing. This
 * one argues that the transaction was already credited before the
 * cardholder filed, so there is nothing left to remedy. Visa's *Dispute
 * Management Guidelines* list "credit or reversal has already been
 * processed for the transaction" among the grounds that make a dispute
 * invalid, and that ground attaches to the TRANSACTION, not to a reason
 * code — which is why this strategy is registered across all families
 * rather than living under `credit_not_processed`.
 *
 * Found necessary on blume-box `162042cd` (2026-08-01): $220 refunded
 * on 13 July, chargeback filed 31 July. The authorization evidence was
 * hopeless (cardholder/account name mismatch, first-seen IP, Shopify
 * risk HIGH/CANCEL, four-day-old account) while the credit argument was
 * close to unanswerable — and we had no way to make it.
 *
 * TONE. State the fact and its consequence; do not render a verdict on
 * the network's own rules. "A credit of X was processed on DATE, before
 * this dispute was filed" is ours to assert. "This dispute is invalid
 * under Visa rules" is the issuer's determination, not the merchant's,
 * and claiming it reads as overreach to a reviewer.
 *
 * PARTIAL COVERAGE. `credit_covers_disputed_amount` gates the phrase
 * "in full". Without it the credit is real but smaller than the
 * dispute, and the narrative must name both figures rather than imply
 * the whole sum was returned. `162042cd` is exactly this shape — $220
 * credited against $235 disputed.
 */

import type { StrategySubmodule } from "../types";

export const credit_already_issued: StrategySubmodule = {
  key: "credit_already_issued",
  // Registered under every family; `familyKey` records where it was
  // authored. Ranking reads STRATEGIES_BY_FAMILY, not this field.
  familyKey: "credit_not_processed",
  displayName: "Credit already issued",
  predicates: { all: ["credit_preceded_dispute"] },
  isFallback: false,
  // EXCLUSIVE, not merely first. Priority alone left the family's own
  // strategies in the bundle, and on 162042cd the fraud auth-signal
  // stack wrote a full payment-authentication argument underneath this
  // one — on a case with a failed AVS and a cardholder-name mismatch.
  // When the transaction was already credited, that IS the case.
  exclusive: true,
  // The prompt asks the model not to argue authorization; the fixed
  // output schema means it writes the section anyway. Blank it.
  suppressesSections: ["paymentAuthenticationArgument"],
  priority: 100,
  promptBody: [
    "STRATEGY FOCUS — credit already issued (this OVERRIDES the family's usual theory):",
    "The merchant credited this transaction BEFORE the cardholder filed. Lead with that and build the response around it.",
    "State: the credit amount, the date it was processed, and that it preceded the dispute. Draw the consequence plainly — the cardholder has already been made whole, and processing this dispute would credit the same transaction a second time.",
    "Do NOT argue the merits of the underlying claim. Do not assert the cardholder authorised the transaction, that the goods arrived, or that the item matched its description. Those are separate theories; mixing them in reads as hedging and invites the reviewer to weigh the weaker one.",
    "Do NOT declare the dispute 'invalid', 'improper', or a rules violation. That determination belongs to the issuer. State the facts and let them apply their own rules.",
    "Only write 'in full' / 'the full amount' when credit_covers_disputed_amount is true. When it is false the credit is smaller than the disputed sum: name BOTH figures, state the credited amount plainly, and do not imply the whole sum was returned.",
    "Never speculate about WHY the refund was issued (order cancelled, goodwill, fraud suspicion). The reason is irrelevant to the argument and can only harm it.",
  ].join("\n"),
  version: 1,
};
