/**
 * Read-time mapping of a checklist row's `unavailableReason` to an i18n token.
 *
 * `checklist_v2` persists `unavailableReason` as English prose (written by
 * lib/automation/completeness.ts) or, for newer rows, as a reason CODE. Stored
 * data is never rewritten, and a renderer must never show a stored English
 * string (CLAUDE.md rule 5). Renderers pass the stored value through here and
 * resolve the token.
 *
 * The stored "No refund was issued on this order" is replaced by the refund
 * statement's own sentence, so the checklist row can never disagree with the
 * rest of the page about refunds.
 *
 * Unknown strings fall back to a neutral "Not applicable to this order".
 */

import type { I18nToken } from "@/lib/i18n/token";
import {
  refundStatementTokens,
  UNKNOWN_REFUND_STATEMENT,
  type RefundStatement,
} from "@/lib/disputes/refundStatement";

const NS = "disputes.unavailableReason";

/** Stored English reasons (verbatim from completeness.ts) -> token key suffix. */
const STORED_ENGLISH: Record<string, string> = {
  "Order is unfulfilled": "orderUnfulfilled",
  "No card payment on this order": "noCardPayment",
  "AVS/CVV not returned by payment gateway": "avsCvvNotReturned",
  "No parcel on this order was returned to sender": "noParcelReturned",
  "Awaiting delivery confirmation": "awaitingDelivery",
  "Not available automatically — upload manually if you have it": "manualOnly",
};

/** Reason codes -> token key suffix. */
const CODES: Record<string, string> = {
  return_on_record: "returnOnRecord",
  refund_on_record: "refundOnRecord",
  merchant_says_request_received: "merchantSaysRequestReceived",
  returned_to_sender: "returnedToSender",
};

/** The stored English text for "nothing was refunded". */
const NO_REFUND_ENGLISH = "No refund was issued on this order";

export function unavailableReasonToken(
  reason: string | null | undefined,
  refundStatement?: RefundStatement | null,
  /** The dispute account's refund sentence (lib/disputes/disputeAccount.ts):
   *  on the dispute page the row says exactly what the account says. */
  accountRefundSentence?: I18nToken | null,
): I18nToken | null {
  if (typeof reason !== "string" || reason.trim() === "") return null;
  const r = reason.trim();
  if (r === NO_REFUND_ENGLISH) {
    if (accountRefundSentence) return accountRefundSentence;
    return refundStatementTokens(refundStatement ?? UNKNOWN_REFUND_STATEMENT).detail;
  }
  const suffix = STORED_ENGLISH[r] ?? CODES[r];
  return { key: `${NS}.${suffix ?? "generic"}` };
}
