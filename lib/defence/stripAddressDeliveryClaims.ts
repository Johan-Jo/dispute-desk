/**
 * Remove address-delivery claim sentences from a narrative, deterministically.
 *
 * ── The defect ──
 *
 * `address_delivery` is a capability no case holds (PR-C1), so any sentence
 * saying WHERE the parcel went — "delivered to the cardholder's address",
 * "reached its destination" — fails `validateNarrative` and, independently,
 * `assessPackageCandidateSafety`. The validator quotes the sentence back to the
 * model and asks it to delete it. When the retry repeats the sentence, the
 * package is `failed` and the dispute files nothing.
 *
 * blume-box #353605 (2026-08-11): three builds in a row wrote the sentence, the
 * deadline cron found no fileable package, and Shopify filed its own scrape —
 * on a 98%-complete pack whose carrier had confirmed delivery (to a pickup
 * point, which is exactly why the address sentence was false).
 *
 * ── The fix ──
 *
 * Do the deletion the validator asked for. Only the offending sentences go;
 * the carrier, tracking and delivery-date sentences around them are untouched,
 * because those are what the rule explicitly permits. A section left empty is
 * recorded in `omittedSections` so the validator's consistency rule holds.
 *
 * The result is re-validated by the caller — this module never decides that a
 * narrative is fileable, it only removes what the gate would refuse. It runs
 * over the same prose `assessPackageCandidateSafety` reads (the nine sections,
 * the headline, the timeline additions and the counsel summary), so a package
 * that passes after it cannot be refused at selection for this reason.
 */

import { removeAddressDeliveryClaimSentences } from "./claimCapabilities";
import type { DefenceNarrativeOutput, NarrativeSectionKey } from "./types";

const SECTION_KEYS: NarrativeSectionKey[] = [
  "executiveSummary",
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
  "conclusion",
];

export interface RemovedClaim {
  /** A section key, or `headline` / `timelineAdditions` / `counsel`. */
  location: string;
  sentence: string;
}

export function stripAddressDeliveryClaims(narrative: DefenceNarrativeOutput): {
  narrative: DefenceNarrativeOutput;
  removed: RemovedClaim[];
} {
  const removed: RemovedClaim[] = [];
  const out: DefenceNarrativeOutput = { ...narrative };
  const omitted = [...(narrative.omittedSections ?? [])];

  for (const key of SECTION_KEYS) {
    const section = narrative[key];
    // Absent only on a partial narrative; there is no prose to judge.
    if (typeof section?.text !== "string") continue;
    const r = removeAddressDeliveryClaimSentences(section.text);
    if (r.removed.length === 0) continue;
    for (const sentence of r.removed) removed.push({ location: key, sentence });
    if (r.text === "") {
      out[key] = { ...section, text: "", usedFactIds: [] };
      if (!omitted.some((o) => o.sectionKey === key)) {
        omitted.push({ sectionKey: key, reason: "address_delivery_claim_removed" });
      }
    } else {
      out[key] = { ...section, text: r.text };
    }
  }
  out.omittedSections = omitted;

  if (narrative.headline) {
    const r = removeAddressDeliveryClaimSentences(narrative.headline);
    for (const sentence of r.removed) removed.push({ location: "headline", sentence });
    if (r.removed.length > 0) {
      if (r.text) out.headline = r.text;
      else delete out.headline;
    }
  }

  if (narrative.timelineAdditions) {
    out.timelineAdditions = narrative.timelineAdditions.flatMap((row) => {
      const r = removeAddressDeliveryClaimSentences(row.text);
      for (const sentence of r.removed) removed.push({ location: "timelineAdditions", sentence });
      return r.text ? [{ ...row, text: r.text }] : [];
    });
  }

  if (narrative.counsel) {
    out.counsel = {
      ...narrative.counsel,
      summary: narrative.counsel.summary.flatMap((line) => {
        const r = removeAddressDeliveryClaimSentences(line);
        for (const sentence of r.removed) removed.push({ location: "counsel", sentence });
        return r.text ? [r.text] : [];
      }),
    };
  }

  return removed.length === 0 ? { narrative, removed } : { narrative: out, removed };
}
