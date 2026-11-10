import { carrierRecordArgued } from "./briefs";
import type { EvidenceFact } from "../types";
import type { LedgerClaim } from "./types";

const isCarrierRecord = (f: EvidenceFact) => f.category === "delivery_proof" || f.category === "shipping_tracking";

/**
 * The carrier-record facts the document must show because the letter argues
 * them. A reason-code module that does not list `delivery_proof` (credit not
 * processed, duplicate, cancelled recurring) keeps the fact out of the plan, so
 * the PDF drew no shipment card for a letter that cited the delivery (whj8db-1q
 * #24285). The ledger decides: argued claim in, exhibit in; no such claim, no
 * exhibit. `pool` is the bank-eligible carrier-record facts of the case.
 */
export function offeredCarrierRecords(have: readonly EvidenceFact[], pool: readonly EvidenceFact[]): EvidenceFact[] {
  const present = new Set(have.map((f) => f.id));
  return pool.filter((f) => isCarrierRecord(f) && !present.has(f.id));
}

export function carrierExhibitFacts(
  ledger: readonly LedgerClaim[],
  have: readonly EvidenceFact[],
  pool: readonly EvidenceFact[],
): EvidenceFact[] {
  return carrierRecordArgued(new Set(ledger.map((c) => c.id))) ? offeredCarrierRecords(have, pool) : [];
}
