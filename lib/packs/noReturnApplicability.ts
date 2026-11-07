/**
 * Can the "no return initiated" fact exist for this order, as far as the record
 * shows? THE read-time answer, built from the one collector verdict
 * (`noReturnFactVerdict`) composed with the carrier's return-to-sender
 * (`hasReturnedToSenderShipment`, the same predicate the contradiction gate
 * uses to remove the section from a pack).
 *
 *   - `emit:false` (return / refund on record, or the merchant said the
 *     customer asked)            -> inapplicable
 *   - `emit:true` and a parcel came back -> inapplicable (`returned_to_sender`)
 *   - `emit:true` otherwise      -> applicable
 *   - `unknown` (return status never recorded, packs built before 2026-10-02)
 *                                -> applicable, UNLESS a carrier reconciled a
 *     parcel to return-to-sender (independent, affirmative evidence), which is
 *     inapplicable. An unknown status is NOT itself a confirmed return: it
 *     never hides a row on its own.
 *
 * Reasons are codes, never English.
 */

import type { Applicability } from "@/lib/automation/completeness";
import {
  isUnrecognisedReturnStatusOnly,
  noReturnFactVerdict,
  type ReturnScopeInput,
} from "@/lib/disputes/returnRequestConfirmation";
import { hasReturnedToSenderShipment } from "./contradictionGate";
import type { EvidenceSection } from "./types";

export type NoReturnInapplicableReason =
  | "return_on_record"
  | "refund_on_record"
  | "merchant_says_request_received"
  | "customer_asked_in_support"
  | "returned_to_sender";

export function noReturnApplicability(
  input: {
    returnStatus: string | null | undefined;
    totalRefunded: number | string | null | undefined;
    returnScope?: ReturnScopeInput | null;
  },
  sections: readonly EvidenceSection[] | null | undefined,
): Applicability {
  const verdict = noReturnFactVerdict(input);
  const carrierReturned = hasReturnedToSenderShipment((sections ?? []) as readonly EvidenceSection[]);
  const returnedToSender: Applicability = { applicable: false, reason: "returned_to_sender" };

  // A status Shopify never recorded (a pack built before 2026-10-02), or one
  // this code does not recognise, is UNKNOWN: never a confirmed return, and it
  // never hides the row on its own (the collector stays silent for it, as
  // before). But a carrier that reconciled a parcel to return-to-sender is
  // independent, affirmative evidence the goods came back, so it takes
  // precedence over an unknown status of either kind.
  if ("unknown" in verdict) {
    return carrierReturned ? returnedToSender : { applicable: true };
  }
  if (!verdict.emit && verdict.reason === "return_on_record" && isUnrecognisedReturnStatusOnly(input)) {
    return carrierReturned ? returnedToSender : { applicable: true };
  }
  if (!verdict.emit) return { applicable: false, reason: verdict.reason };
  return carrierReturned ? returnedToSender : { applicable: true };
}
