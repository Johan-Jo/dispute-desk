/**
 * Extract bank-grade EvidenceData fields from the persisted pack_json.
 *
 * The bank-grade rebuttal template added in 2026-04-24 (see
 * `responseEngine.ts → buildBankGradeRebuttal`) cites real signals
 * such as the AVS/CVV codes returned by the issuer, whether the
 * payment was authorized and captured, and a narrative summary of
 * the IPinfo enrichment.
 *
 * The template engine itself is pure and only consumes the
 * `EvidenceFlags` + `EvidenceData` it is handed. This module is the
 * adapter between the durable `pack_json.sections[]` shape and the
 * `EvidenceData` interface, so the responseEngine never has to read
 * pack JSON directly and unit tests can mock either side cleanly.
 *
 * Strict rules:
 *  - Pure function, no I/O, no Supabase access.
 *  - Never invent signals — every populated field must trace back to
 *    a value already collected in the pack. Missing data stays
 *    `undefined`/`null` so downstream gating suppresses the line.
 *  - Never copy raw IP / coordinates / VPN flags into the rebuttal —
 *    only city/region/country/org and the "all-clean privacy" boolean
 *    are surfaced. Negative privacy signals deliberately collapse to
 *    `ipNoVpnProxyHosting = false`, which omits the clean-network
 *    sentence rather than leaking a negative claim.
 */

import type { EvidenceData } from "./responseEngine";

/** Dispute row slice passed from the API route for email enrichment (no extra Shopify calls). */
export type DisputeExtractContext = {
  id?: string;
  reason?: string | null;
  shop_id?: string | null;
  customer_email?: string | null;
};

interface RawSection {
  type?: string;
  label?: string;
  source?: string;
  fieldsProvided?: string[];
  data?: Record<string, unknown> | null;
}

interface RawIpinfoPrivacy {
  vpn?: unknown;
  proxy?: unknown;
  hosting?: unknown;
}

interface RawIpinfo {
  city?: unknown;
  region?: unknown;
  country?: unknown;
  org?: unknown;
  privacy?: RawIpinfoPrivacy | null;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return null;
  return v as Record<string, unknown>;
}

/**
 * Find the Pre-authorization fraud screening section emitted by
 * fraudRiskSource.ts. Matches by `fieldsProvided` (most stable —
 * the collector pins this to `fraud_risk_screening`), then by label.
 */
function findFraudRiskScreeningSection(sections: RawSection[]): RawSection | null {
  for (const s of sections) {
    if ((s.fieldsProvided ?? []).includes("fraud_risk_screening")) return s;
  }
  for (const s of sections) {
    const label = (s.label ?? "").toLowerCase();
    if (label.includes("pre-authorization fraud screening")) return s;
  }
  return null;
}

/**
 * Find the Payment Verification (AVS/CVV) section emitted by
 * paymentSource.ts. Matches by label first (most stable), with
 * fallbacks to source / fieldsProvided so a renamed label still
 * resolves correctly.
 */
function findPaymentSection(sections: RawSection[]): RawSection | null {
  for (const s of sections) {
    const label = (s.label ?? "").toLowerCase();
    if (label.includes("payment verification") || label.includes("avs/cvv")) {
      return s;
    }
  }
  for (const s of sections) {
    if ((s.fieldsProvided ?? []).includes("avs_cvv_match")) return s;
  }
  return null;
}

/**
 * Find the IP & Location Check section emitted by
 * deviceLocationSource.ts. Accepts both the current label and the
 * legacy "Device & Location Consistency" name so older packs still
 * resolve.
 */
function findIpLocationSection(sections: RawSection[]): RawSection | null {
  for (const s of sections) {
    const label = s.label ?? "";
    if (
      label === "IP & Location Check" ||
      label === "Device & Location Consistency"
    ) {
      return s;
    }
  }
  for (const s of sections) {
    const fp = s.fieldsProvided ?? [];
    if (
      fp.includes("ip_location_check") ||
      fp.includes("device_location_consistency")
    ) {
      return s;
    }
  }
  return null;
}

/**
 * Primary order section (excludes secondary `order` rows such as refund history
 * that omit checkout fields).
 */
function findMainOrderSection(sections: RawSection[]): RawSection | null {
  for (const s of sections) {
    if (s.type !== "order") continue;
    const d = asObject(s.data);
    if (!d) continue;
    if ("financialStatus" in d || "orderName" in d) return s;
  }
  return null;
}

function hasManualUploadSection(sections: RawSection[]): boolean {
  return sections.some((s) => s.source === "manual_upload");
}

/**
 * Find the fulfillment section emitted by fulfillmentSource.ts. The
 * section data carries `fulfillments[]` where each entry may include
 * a `carrierTracking` object with signedByName / deliveredAtTracking /
 * trackingSource captured from tracking-app metafields
 * (AfterShip / Shipway / Wonderment / etc. via
 * lib/shopify/trackingApps.ts).
 */
function findFulfillmentSection(sections: RawSection[]): RawSection | null {
  for (const s of sections) {
    if (s.source === "shopify_fulfillments") return s;
  }
  for (const s of sections) {
    if ((s.fieldsProvided ?? []).includes("delivery_proof")) return s;
  }
  return null;
}

/**
 * Across all fulfillments in the section, find the first that has
 * carrier-captured signature data. Returns the recipient name plus a
 * timestamp / source if available. Null when no fulfillment carries
 * signature data — caller suppresses the corresponding rebuttal line.
 */
function deriveCarrierSignature(
  fulfillment: RawSection | null,
): { signedByName: string | null; deliveredAtTracking: string | null } {
  const empty = { signedByName: null, deliveredAtTracking: null };
  if (!fulfillment) return empty;
  const data = asObject(fulfillment.data);
  if (!data) return empty;
  const fulfillments = data.fulfillments as unknown;
  if (!Array.isArray(fulfillments)) return empty;
  for (const f of fulfillments) {
    if (!f || typeof f !== "object") continue;
    const ct = (f as Record<string, unknown>).carrierTracking;
    if (!ct || typeof ct !== "object") continue;
    const ctObj = ct as Record<string, unknown>;
    const signed = asString(ctObj.signedByName);
    if (signed) {
      return {
        signedByName: signed,
        deliveredAtTracking: asString(ctObj.deliveredAtTracking),
      };
    }
  }
  return empty;
}

/**
 * Authorization succeeded iff the pack contains a card payment
 * verification section. paymentSource only emits with status
 * "available" / "unavailable_from_gateway" — both reflect a successful
 * card transaction. "not_applicable" is used for non-card payments
 * and explicitly does NOT prove authorization.
 */
function deriveAuthorizationSucceeded(payment: RawSection | null): boolean | undefined {
  if (!payment) return undefined;
  const data = asObject(payment.data);
  const status = asString(data?.avsCvvStatus);
  if (status === "available" || status === "unavailable_from_gateway") return true;
  return undefined;
}

/**
 * Capture succeeded iff Shopify's displayFinancialStatus reflects
 * funds having been collected. PARTIALLY_REFUNDED counts because the
 * capture happened before the partial refund. PENDING / VOIDED /
 * REFUNDED do not satisfy the bank-grade "captured without error"
 * sentence and are intentionally left undefined.
 */
function deriveCaptureSucceeded(order: RawSection | null): boolean | undefined {
  if (!order) return undefined;
  const data = asObject(order.data);
  const status = asString(data?.financialStatus);
  if (!status) return undefined;
  const upper = status.toUpperCase();
  if (upper === "PAID" || upper === "PARTIALLY_PAID" || upper === "PARTIALLY_REFUNDED") {
    return true;
  }
  return undefined;
}

interface IpDerivedFields {
  ipCity: string | null;
  ipRegion: string | null;
  ipCountry: string | null;
  ipOrg: string | null;
  ipNoVpnProxyHosting: boolean | null;
  ipCountryMatchesShipping: boolean | null;
  /**
   * Pack-side eligibility flag, mirrored verbatim from the source
   * `ip_location_check` section. The rebuttal engine consults this
   * before emitting any IP/location paragraph — see
   * lib/argument/deviceLocationEligibility.ts.
   */
  bankEligible: boolean | null;
}

function deriveIpFields(ipSection: RawSection | null, order: RawSection | null): IpDerivedFields {
  const empty: IpDerivedFields = {
    ipCity: null,
    ipRegion: null,
    ipCountry: null,
    ipOrg: null,
    ipNoVpnProxyHosting: null,
    ipCountryMatchesShipping: null,
    bankEligible: null,
  };
  if (!ipSection) return empty;
  const data = asObject(ipSection.data);
  if (!data) return empty;

  const ipinfo = data.ipinfo as RawIpinfo | null | undefined;
  if (!ipinfo) return empty;

  const city = asString(ipinfo.city);
  const region = asString(ipinfo.region);
  const country = asString(ipinfo.country);
  const org = asString(ipinfo.org);

  const privacy = ipinfo.privacy ?? null;
  let ipNoVpnProxyHosting: boolean | null = null;
  if (privacy && typeof privacy === "object") {
    const vpn = privacy.vpn;
    const proxy = privacy.proxy;
    const hosting = privacy.hosting;
    // Require all three to be explicitly false to avoid defaulting an
    // unknown signal to "clean network".
    if (vpn === false && proxy === false && hosting === false) {
      ipNoVpnProxyHosting = true;
    } else if (vpn === true || proxy === true || hosting === true) {
      ipNoVpnProxyHosting = false;
    }
  }

  // Country match — prefer the IP section's own snapshot of the
  // shipping country (collected at the time of pack build, more
  // reliable than re-fetching), and fall back to the order section.
  const ipShippingFromIpSection = asObject(data.shippingAddress);
  const orderShipping = order ? asObject(asObject(order.data)?.shippingAddress) : null;

  const shippingCountry =
    asString(ipShippingFromIpSection?.country) ??
    asString(ipShippingFromIpSection?.countryCode) ??
    asString(orderShipping?.countryCode) ??
    asString(orderShipping?.country);

  let ipCountryMatchesShipping: boolean | null = null;
  if (country && shippingCountry) {
    ipCountryMatchesShipping =
      country.toLowerCase() === shippingCountry.toLowerCase();
  }

  // Pack-side `bankEligible` decision is computed by
  // deviceLocationSource.ts at pack-build time. Mirror it verbatim;
  // never re-derive here.
  const bankEligible =
    typeof data.bankEligible === "boolean" ? data.bankEligible : null;

  return {
    ipCity: city,
    ipRegion: region,
    ipCountry: country,
    ipOrg: org,
    ipNoVpnProxyHosting,
    ipCountryMatchesShipping,
    bankEligible,
  };
}

/**
 * Build an EvidenceData object containing the bank-grade rebuttal
 * fields (AVS/CVV codes, auth/capture flags, IP narrative) from the
 * pack JSON sections. Returns an object even when nothing is present
 * — the engine handles missing fields by suppressing the relevant
 * sentences.
 */
export function extractEvidenceDataFromPack(
  sections: RawSection[] | null | undefined,
  dispute?: DisputeExtractContext | null,
): EvidenceData {
  const safeSections = Array.isArray(sections) ? sections : [];

  const payment = findPaymentSection(safeSections);
  const ipSection = findIpLocationSection(safeSections);
  const order = findMainOrderSection(safeSections);
  const fulfillment = findFulfillmentSection(safeSections);
  const fraudRisk = findFraudRiskScreeningSection(safeSections);

  const paymentData = asObject(payment?.data);
  const avsCode = asString(paymentData?.avsResultCode);
  const cvvCode = asString(paymentData?.cvvResultCode);

  const authorizationSucceeded = deriveAuthorizationSucceeded(payment);
  const captureSucceeded = deriveCaptureSucceeded(order);
  const ipFields = deriveIpFields(ipSection, order);
  const signature = deriveCarrierSignature(fulfillment);

  const orderData = asObject(order?.data);
  const customerEmailFromOrder = orderData ? asString(orderData.customerEmail) : null;
  const customerEmailFromDispute = dispute ? asString(dispute.customer_email) : null;
  const resolvedEmail = customerEmailFromOrder ?? customerEmailFromDispute;

  // Pre-authorization fraud-screening positive facts (Phase 1 fraud-risk
  // plan). The collector at lib/packs/sources/fraudRiskSource.ts has
  // already enforced fraud-family reason + LOW + ACCEPT/NONE +
  // shopify-provider + ≥1 POSITIVE-sentiment fact before emitting this
  // section, so simply reading `positiveFacts` is safe here. We do not
  // re-check sentiment — that would invite a divergence between this
  // adapter and the collector.
  const fraudRiskData = asObject(fraudRisk?.data);
  const rawPositiveFacts = fraudRiskData?.positiveFacts;
  const fraudRiskScreeningPositiveFacts = Array.isArray(rawPositiveFacts)
    ? (rawPositiveFacts.filter((f): f is string => typeof f === "string" && f.trim().length > 0))
    : null;

  return {
    avsCode,
    cvvCode,
    authorizationSucceeded,
    captureSucceeded,
    ipCity: ipFields.ipCity,
    ipRegion: ipFields.ipRegion,
    ipCountry: ipFields.ipCountry,
    ipOrg: ipFields.ipOrg,
    ipNoVpnProxyHosting: ipFields.ipNoVpnProxyHosting,
    ipCountryMatchesShipping: ipFields.ipCountryMatchesShipping,
    bankEligible: ipFields.bankEligible,
    hasOrderConfirmation: order != null ? true : undefined,
    hasCustomerEmail: resolvedEmail != null ? true : undefined,
    hasSupportingDocs: hasManualUploadSection(safeSections) ? true : undefined,
    signedByName: signature.signedByName,
    // Prefer the carrier-confirmed delivered_at over Shopify's own
    // deliveredAt — tracking apps poll carriers continuously, so this
    // is the more reliable timestamp. Falls through to whatever the
    // engine already populates if absent.
    deliveredDate: signature.deliveredAtTracking ?? undefined,
    fraudRiskScreeningPositiveFacts:
      fraudRiskScreeningPositiveFacts && fraudRiskScreeningPositiveFacts.length > 0
        ? fraudRiskScreeningPositiveFacts
        : null,
  };
}
