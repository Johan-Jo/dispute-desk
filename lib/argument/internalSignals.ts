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
import {
  cardholderNameFromPayload,
  detectCardholderNameMismatch,
} from "./nameMismatch";

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
  /** Optional dispute context the payload map alone cannot provide.
   *  `customerName` (disputes.customer_display_name) enables the
   *  cardholder-name-mismatch warning below. */
  context?: { customerName?: string | null },
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
    const avsMatched = avs !== null && avs !== "" && AVS_MATCH_CODES.has(avs.toUpperCase());
    const cvvMatched = cvv !== null && cvv !== "" && CVV_MATCH_CODES.has(cvv.toUpperCase());
    if (avsMismatch || cvvMismatch) {
      const failedParts: string[] = [];
      if (avsMismatch) failedParts.push(`AVS code ${avs}`);
      if (cvvMismatch) failedParts.push(`CVV code ${cvv}`);
      const matchedParts: string[] = [];
      if (avsMatched) matchedParts.push(`AVS code ${avs}`);
      if (cvvMatched) matchedParts.push(`CVV code ${cvv}`);
      // Partial match: the matched half IS cited to the bank (the row
      // categorizes moderate and lands in the positive bucket), so the
      // blanket "not surfaced to the bank" copy would be half-false.
      // Name what was withheld AND what was cited. Mirrors
      // useEvidenceSections.classifyAvsCvv.
      push(
        "avs_cvv_match",
        matchedParts.length > 0
          ? {
              id: "internal:avs_cvv_mismatch",
              label: "Card security check partially passed",
              reason: `The payment gateway returned a non-match (${failedParts.join(", ")}). That result was withheld from the bank to avoid weakening the response — but the part that did match (${matchedParts.join(", ")}) is cited in the response as positive evidence.`,
              severity: "warning",
            }
          : {
              id: "internal:avs_cvv_mismatch",
              label: "Card security check did not fully pass",
              reason: `The payment gateway returned a non-match (${failedParts.join(", ")}). Used internally for assessment; not surfaced to the bank to avoid weakening the response.`,
              severity: "warning",
            },
      );
    }

    // Cardholder-name mismatch → anchor on avs_cvv_match. The gateway
    // says the card is registered to someone who shares no name token
    // with the buyer — the classic stolen-card pattern. Prints BOTH
    // names so the merchant sees exactly what differs. Merchant-UI
    // only; never enters the bank-facing argument (the issuer already
    // knows their cardholder's name — restating the mismatch would be
    // a confession).
    const gatewayCardholderName = cardholderNameFromPayload(avsPayload);
    const customerName =
      typeof context?.customerName === "string" && context.customerName.trim().length > 0
        ? context.customerName.trim()
        : null;
    if (detectCardholderNameMismatch(gatewayCardholderName, customerName)) {
      push("avs_cvv_match", {
        id: "internal:cardholder_name_mismatch",
        label: "Card is registered to a different name than the buyer",
        reason: `The payment card is registered to "${gatewayCardholderName}" but the order was placed by "${customerName}". This is a common stolen-card pattern — review before submitting. Used internally for assessment; not added to the bank-facing argument.`,
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
            reason: `${detail} This mismatch is kept internal because it could weaken an unauthorized response — it is not cited as a positive bank argument, though the underlying order record is still included as supporting context.`,
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
