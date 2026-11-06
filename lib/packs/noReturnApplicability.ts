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
  // An UNKNOWN Shopify return status (a pack built before 2026-10-02) is not a
  // confirmed return and never hides the row on its own. But a carrier that
  // reconciled a parcel to return-to-sender is affirmative evidence the goods
  // came back, independent of Shopify's status, so it is not ignored.
  if ("unknown" in verdict) {
    return hasReturnedToSenderShipment((sections ?? []) as readonly EvidenceSection[])
      ? { applicable: false, reason: "returned_to_sender" }
      : { applicable: true };
  }
  // The collector treats ANY non-null status other than NO_RETURN as "a return
  // is on record" (and stays silent). At read time a status this code does not
  // recognise is UNKNOWN, not a confirmed return: it never hides a row.
  if (!verdict.emit && verdict.reason === "return_on_record" && isUnrecognisedReturnStatusOnly(input)) {
    return { applicable: true };
  }
  if (!verdict.emit) return { applicable: false, reason: verdict.reason };
  if (hasReturnedToSenderShipment((sections ?? []) as readonly EvidenceSection[])) {
    return { applicable: false, reason: "returned_to_sender" };
  }
  return { applicable: true };
}
