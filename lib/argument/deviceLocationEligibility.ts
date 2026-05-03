/**
 * Single-source eligibility gate for device/location/IP evidence in
 * bank-facing output (Shopify `disputeEvidenceUpdate` text fields and
 * the rebuttal narrative that lands in `uncategorizedText`).
 *
 * Why this exists
 * ───────────────
 * Bank-facing text must contain only curated positive evidence. A
 * BR-IP / US-shipping case used to leak through two separate paths:
 *
 *   1. `formatEvidenceForShopify.ts` correctly suppressed the IP
 *      paragraph in `accessActivityLog` whenever the pack section's
 *      `bankEligible` was false.
 *   2. `responseEngine.ts` (`buildBankGradeStructure`) generated the
 *      rebuttal which lands in `uncategorizedText`. It had NO gate
 *      and would emit `"The transaction originated from an IP …
 *      Rio de Janeiro, BR, … TELEFÔNICA …"` followed by the
 *      "cross-border purchasing behavior" defensive reframe.
 *
 * The gate must be applied at every site that produces bank-facing
 * IP narrative. Concentrating the rule here prevents a third site
 * from drifting away from the others.
 *
 * Rule (mirrors the canonical decision in deviceLocationSource.ts +
 * formatEvidenceForShopify.ts):
 *
 *   The IP / city / region / country / ISP / ASN may appear in
 *   bank-facing text ONLY when the source section explicitly sets
 *   `bankEligible === true`. Anything else — false, missing, country
 *   mismatch, VPN/proxy/hosting detected, no section at all — means
 *   omit completely. We never reframe a mismatch as positive and we
 *   never explain it away. If the signal needs defensive framing,
 *   it is not bank-facing evidence.
 *
 * Internal/merchant-facing UI continues to display the full signal
 * (with mismatch flagged) by reading the source pack section
 * directly — this gate only governs the *bank-facing* surfaces.
 */

import type { EvidenceData } from "./responseEngine";

/**
 * Minimal pack-section shape this module needs. Kept structural so
 * both `RawPackSection` (Shopify formatter) and the looser shapes used
 * elsewhere can pass through without coupling import graphs.
 */
export interface DeviceLocationCandidateSection {
  type?: string;
  fieldsProvided?: string[];
  data?: { bankEligible?: boolean; bankParagraph?: string | null } | null;
}

/**
 * True iff the section is the IP/device-location section AND its
 * `bankEligible` flag is explicitly `true`. Everything else (false,
 * undefined, missing data) returns false.
 */
export function isDeviceLocationBankEligible(
  section: DeviceLocationCandidateSection | null | undefined,
): boolean {
  if (!section) return false;
  const fp = section.fieldsProvided ?? [];
  const isDeviceLocSection =
    fp.includes("ip_location_check") || fp.includes("device_location_consistency");
  if (!isDeviceLocSection) return false;
  return section.data?.bankEligible === true;
}

/**
 * Eligibility decision for the device/location paragraph in the
 * bank-grade rebuttal narrative. Operates on the projected
 * `EvidenceData` (what the rebuttal engine already consumes) so it
 * can be called without re-reading the raw pack section.
 *
 * Conservative by design: if any field signals risk or uncertainty
 * (country mismatch, unknown VPN status, absent country-match
 * comparison), the gate returns false and the paragraph is omitted.
 */
export function isEvidenceDataDeviceLocationBankEligible(
  data: Pick<
    EvidenceData,
    "bankEligible" | "ipCountryMatchesShipping" | "ipNoVpnProxyHosting"
  >,
): boolean {
  // Hard requirement: pack-side eligibility must be explicitly true.
  if (data.bankEligible !== true) return false;
  // Defense in depth — even if the pack flag drifts, never emit when
  // we can see the country mismatch directly.
  if (data.ipCountryMatchesShipping === false) return false;
  // VPN/proxy/hosting must be cleanly absent; null (unknown) is not
  // good enough for bank narrative.
  if (data.ipNoVpnProxyHosting !== true) return false;
  return true;
}
