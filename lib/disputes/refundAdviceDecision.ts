/**
 * Should this merchant be told, by email, to refund this inquiry? ONE pure function.
 *
 * The email is only ever as true as the refund state it is built on, so every condition below is a place where
 * telling a merchant "refund this" could be WRONG (docs/plans/pending-refund-advice.plan.md; evidence measured
 * live 2026-11-12):
 *
 *  - state `pending` / `settled` / `mixed`: the merchant already refunded (7 of 11 open inquiries on that day).
 *  - state `unknown`: we cannot tell, and "unknown" is never "none".
 *  - not Klarna: every measured closure after a refund is Klarna on one shop; a settled PayPal refund closed an
 *    inquiry as LOST. Other methods stay page-only until measured.
 *  - no open/received return: the advice rests on the customer having sent the goods back.
 *  - not CREDIT_NOT_PROCESSED: the same.
 *  - not an inquiry: Shopify blocks refunds on a chargeback.
 *
 * `variant` "failed": a refund was started and every transaction FAILED, so nothing was paid back.
 */

import type { RefundState } from "@/lib/disputes/refundState";
import { hasOpenOrReceivedReturn } from "@/lib/disputes/refundState";

export type RefundAdviceSkipReason =
  | "disabled"
  | "not_inquiry"
  | "not_open"
  | "not_credit_not_processed"
  | "no_return"
  | "not_klarna"
  | "state_pending"
  | "state_settled"
  | "state_mixed"
  | "state_unknown"
  | "opted_out"
  | "no_team_email"
  | "already_sent";

export type RefundAdviceDecision =
  | { action: "send"; variant: "none" | "failed" }
  | { action: "skip"; reason: RefundAdviceSkipReason };

export interface RefundAdviceInput {
  /** `REFUND_ADVICE_EMAILS_ENABLED === "true"` */
  emailsEnabled: boolean;
  phase: string | null;
  /** Shopify's dispute status; "needs_response" is the only open, unanswered status. */
  status: string | null;
  reason: string | null;
  state: RefundState;
  /** `shopify_orders.payment_method` (klarna, klarna_pay_later, paypal, card, ...). */
  paymentMethod: string | null;
  /** `notifications.refundAdvice === false` */
  optedOut: boolean;
  hasTeamEmail: boolean;
  alreadySent: boolean;
}

export const REFUND_ADVICE_REASON = "CREDIT_NOT_PROCESSED";

export function isKlarnaMethod(method: string | null | undefined): boolean {
  return typeof method === "string" && method.toLowerCase().startsWith("klarna");
}

export function decideRefundAdvice(i: RefundAdviceInput): RefundAdviceDecision {
  const skip = (reason: RefundAdviceSkipReason): RefundAdviceDecision => ({ action: "skip", reason });
  if (!i.emailsEnabled) return skip("disabled");
  if (i.phase !== "inquiry") return skip("not_inquiry");
  if (i.status !== "needs_response") return skip("not_open");
  if (i.reason !== REFUND_ADVICE_REASON) return skip("not_credit_not_processed");
  if (!hasOpenOrReceivedReturn(i.state)) return skip("no_return");
  if (!isKlarnaMethod(i.paymentMethod)) return skip("not_klarna");

  switch (i.state.kind) {
    case "pending":
      return skip("state_pending");
    case "settled":
      return skip("state_settled");
    case "mixed":
      return skip("state_mixed");
    case "unknown":
      return skip("state_unknown");
    case "none":
    case "failed":
      break;
  }

  if (i.optedOut) return skip("opted_out");
  if (!i.hasTeamEmail) return skip("no_team_email");
  if (i.alreadySent) return skip("already_sent");
  return { action: "send", variant: i.state.kind === "failed" ? "failed" : "none" };
}
