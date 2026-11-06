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
 *                                -> applicable. An unknown status is NOT a
 *     confirmed return: it fails open and never hides a row.
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
  if ("unknown" in verdict) return { applicable: true };
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
