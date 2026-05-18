/**
 * Server-safe field-keyed internal-signal warnings.
 *
 * Companion to `app/(embedded)/.../useEvidenceSections.ts:deriveInternalOnlySignals`,
 * which produces standalone synthetic signals for the dedicated
 * Internal-only Signals UI section (client-only, depends on `useTranslations`).
 *
 * This module is server-safe and produces a per-field warnings map that
 * `deriveEvidenceLineItems` attaches to the corresponding row. The two
 * sources stay in lockstep — same payload heuristics, same field anchors.
 */

import type { InternalSignalWarning } from "./evidenceLineItem";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

const AVS_MATCH_CODES = new Set(["Y", "A", "W", "X", "D", "M"]);
const CVV_MATCH_CODES = new Set(["M"]);

/**
 * Build the field → warnings map used by `deriveEvidenceLineItems`'s
 * `internalSignalsByField` input.
 *
 * Mirrors the four classifiers in `useEvidenceSections.deriveInternalOnlySignals`
 * (AVS/CVV mismatch, billing/shipping mismatch, IP location, generic
 * bank-ineligible) but emits FIELD-ANCHORED warnings rather than
 * standalone synthetic rows.
 *
 * Conservative — absence of data never produces a signal.
 */
export function buildInternalSignalsByField(
  payloadByField: Map<string, unknown>,
): Map<string, InternalSignalWarning[]> {
  const out = new Map<string, InternalSignalWarning[]>();
  const push = (field: string, signal: InternalSignalWarning): void => {
    const existing = out.get(field);
    if (existing) existing.push(signal);
    else out.set(field, [signal]);
  };

  // AVS/CVV mismatch → anchor on avs_cvv_match
  const avsPayload = payloadByField.get("avs_cvv_match");
  if (isPlainObject(avsPayload)) {
    const avs = readString(avsPayload.avsResultCode);
    const cvv = readString(avsPayload.cvvResultCode);
    const avsMismatch = avs !== null && avs !== "" && !AVS_MATCH_CODES.has(avs.toUpperCase());
    const cvvMismatch = cvv !== null && cvv !== "" && !CVV_MATCH_CODES.has(cvv.toUpperCase());
    if (avsMismatch || cvvMismatch) {
      const parts: string[] = [];
      if (avsMismatch) parts.push(`AVS code ${avs}`);
      if (cvvMismatch) parts.push(`CVV code ${cvv}`);
      push("avs_cvv_match", {
        id: "internal:avs_cvv_mismatch",
        label: "Card security check did not fully pass",
        reason: `The payment gateway returned a non-match (${parts.join(", ")}). Used internally for assessment; not surfaced to the bank to avoid weakening the response.`,
        severity: "warning",
      });
    }
  }

  // Billing/shipping mismatch → anchor on order_confirmation
  const orderPayload = payloadByField.get("order_confirmation");
  if (isPlainObject(orderPayload)) {
    const billing = orderPayload.billingAddress;
    const shipping = orderPayload.shippingAddress;
    if (isPlainObject(billing) && isPlainObject(shipping)) {
      const billingCountry = readString(billing.countryCode);
      const shippingCountry = readString(shipping.countryCode);
      const billingCity = readString(billing.city);
      const shippingCity = readString(shipping.city);
      const haveCountries =
        billingCountry !== null && billingCountry !== "" &&
        shippingCountry !== null && shippingCountry !== "";
      if (haveCountries) {
        const countryMismatch = billingCountry !== shippingCountry;
        const cityMismatch =
          billingCity !== null && billingCity !== "" &&
          shippingCity !== null && shippingCity !== "" &&
          billingCity !== shippingCity;
        if (countryMismatch || cityMismatch) {
          const detail = countryMismatch
            ? `Billing country ${billingCountry} differs from shipping country ${shippingCountry}.`
            : "Billing city differs from shipping city.";
          push("order_confirmation", {
            id: "internal:billing_address_mismatch",
            label: "Billing and shipping addresses do not match",
            reason: `${detail} Address mismatch may weaken an unauthorized response and is not included as positive bank evidence.`,
            severity: "warning",
          });
        }
      }
    }
  }

  // IP / location → anchor on ip_location_check
  const ipPayload = payloadByField.get("ip_location_check");
  if (isPlainObject(ipPayload)) {
    const locationMatch = readString(ipPayload.locationMatch);
    const riskLevel = readString(ipPayload.riskLevel);
    const bankEligible = ipPayload.bankEligible;
    if (locationMatch === "different_country") {
      push("ip_location_check", {
        id: "internal:ip_country_mismatch",
        label: "IP geolocation mismatch",
        reason:
          "The customer's IP address resolved to a different country than the shipping address. Used internally for assessment; not submitted to Shopify to avoid weakening the case.",
        severity: "warning",
      });
    } else if (riskLevel === "high") {
      push("ip_location_check", {
        id: "internal:ip_high_risk",
        label: "IP routes through VPN, proxy, or data center",
        reason:
          "Network-level privacy signals make the geolocation unreliable. Used internally for assessment; not submitted to Shopify to avoid weakening the case.",
        severity: "warning",
      });
    } else if (bankEligible === false) {
      push("ip_location_check", {
        id: "internal:ip_bank_ineligible",
        label: "IP/location signal kept internal",
        reason:
          "This signal informs the assessment but the upstream collector marked it as not bank-eligible. Not submitted to Shopify.",
        severity: "info",
      });
    }
  }

  // Generic bank-ineligible pass for any other field
  for (const [field, payload] of payloadByField.entries()) {
    if (field === "avs_cvv_match" || field === "ip_location_check") continue;
    if (!isPlainObject(payload)) continue;
    if (payload.bankEligible === false) {
      push(field, {
        id: `internal:${field}:bank_ineligible`,
        label: `${field} kept internal`,
        reason:
          "The upstream collector marked this signal as not bank-eligible. Used internally for assessment; not submitted to Shopify.",
        severity: "info",
      });
    }
  }

  return out;
}
