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
import {
  hasDefiniteAddressNonMatch,
  readPaymentVerification,
} from "./paymentVerification";

/* MERCHANT-LANGUAGE RULE (2026-07-23): never lead with a bare gateway
 * code — nobody but a bank knows what a bare AVS letter indicates. ONE
 * combined plain-words sentence covers both results (codes
 * parenthesized at the end), then one short outcome sentence with the
 * consistent "cited as evidence" phrasing. These English sentences
 * mirror `messages/en.json` → `disputes.internalSignals.avsCvvMismatch.*`
 * (resolved per-locale by `useEvidenceSections.classifyAvsCvv`) — keep
 * the two in lockstep. Key: `${avsBucket}|${cvvBucket}` with "none" for
 * an absent code; only combinations that can fire the warning are listed. */
const AVS_CVV_RESULT_EN: Record<string, (avs: string, cvv: string) => string> = {
  "no_match|match": (a, c) =>
    `The address did not match the card issuer's records, but the card's security code did (AVS ${a}, CVV ${c}).`,
  "unchecked|match": (a, c) =>
    `The issuer did not check the address; the card's security code matched (AVS ${a}, CVV ${c}).`,
  "match|no_match": (a, c) =>
    `The address matched the card issuer's records, but the card's security code did not (AVS ${a}, CVV ${c}).`,
  "match|unchecked": (a, c) =>
    `The address matched the issuer's records; the security code was not checked (AVS ${a}, CVV ${c}).`,
  "no_match|no_match": (a, c) =>
    `Neither the address nor the card's security code matched the issuer's records (AVS ${a}, CVV ${c}).`,
  "no_match|unchecked": (a, c) =>
    `The address did not match the issuer's records; the security code was not checked (AVS ${a}, CVV ${c}).`,
  "unchecked|no_match": (a, c) =>
    `The card's security code did not match the issuer's records; the address was not checked (AVS ${a}, CVV ${c}).`,
  "unchecked|unchecked": (a, c) =>
    `The issuer checked neither the address nor the security code (AVS ${a}, CVV ${c}).`,
  "no_match|none": (a) => `The address did not match the card issuer's records (AVS code ${a}).`,
  "unchecked|none": (a) => `The issuer did not check the address (AVS code ${a}).`,
  "none|no_match": (_a, c) =>
    `The card's security code did not match the issuer's records (CVV code ${c}).`,
  "none|unchecked": (_a, c) => `The issuer did not check the card's security code (CVV code ${c}).`,
};
const OUTCOME_EN = {
  // PR-C2 decision 1 (2026-08-08): a security-code match on its own is NOT
  // cited to the bank. It is a real signal about the checkout and it stays on
  // the merchant's screen, but it says nothing about the address, and the
  // network rule this evidence is cited under is an address rule. The two
  // strings that used to claim it "was cited as evidence" said the opposite of
  // what the system now does.
  cvvOnlyNotCited:
    "The matching security code is kept as an internal record — it is not cited in the dispute response, because a security-code match is not an address match.",
  /* THE SENTENCE THAT REPLACES THE WITHHELD AGREEMENT NOTE (2026-08-29).
   * Appended only when the issuer returned a definite address non-match AND
   * the order's own billing/shipping addresses agree — the 72-case prod
   * pattern. Without it the agreement note simply vanishes and the merchant is
   * told nothing about why, which breaks the Internal-only section's promise
   * that they always get a definitive answer to "is anything being held back?"
   * Names the distinction that makes the two facts compatible: comparing two
   * addresses you hold is not the check the bank performed. */
  orderAddressesAgreeButIssuerSaysNo:
    "The billing and shipping addresses on your own order record do agree with each other, but that is a comparison of two addresses you hold — not a check by the bank. The bank compared this order's billing address against the cardholder's address on file, and those did not match.",
  onlyAvsCited:
    "Only the matching address was cited as evidence in the dispute response — the code mismatch would weaken it.",
  avsCitedClean: "The matching address was cited as evidence in the dispute response.",
  // PR-C3: the address matched, but the (network, code) cell it resolved
  // through carries no primary-source citation authority. Deliberately NOT the
  // "would weaken" wording: nothing here is weak, we simply cannot name the
  // scheme rule we would be citing under.
  avsMatchedNotCitable:
    "The matching address counts towards your case assessment, but it is not cited in the dispute response — we cite an address result only when the card scheme's own rules recognise that result as evidence, and this one is not covered.",
  nothingCited:
    "Neither result was cited as evidence in the dispute response — only results that strengthen the case go to the bank.",
  singleNotCited: "It was not cited as evidence — it would weaken the dispute response.",
} as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * How the order's OWN billing and shipping addresses compare — the merchant's
 * record, never the issuer's check.
 *
 * ONE OWNER (2026-08-29). Two blocks below need this answer: the AVS warning,
 * to explain why an agreeing order still failed the bank's address check, and
 * the operational note itself. Computing it twice is how the `F`/`Z` drift in
 * `paymentVerification.ts` began, so it is computed once here.
 *
 * `null` where we cannot tell. ALL FOUR VALUES ARE REQUIRED for `agree` —
 * absence is not agreement in either direction.
 */
export type OrderAddressComparison =
  | { kind: "agree" }
  | { kind: "country_mismatch"; billingCountry: string; shippingCountry: string }
  | { kind: "city_mismatch" };

export function compareOrderAddresses(
  orderPayload: unknown,
): OrderAddressComparison | null {
  if (!isPlainObject(orderPayload)) return null;
  const billing = orderPayload.billingAddress;
  const shipping = orderPayload.shippingAddress;
  if (!isPlainObject(billing) || !isPlainObject(shipping)) return null;

  const billingCountry = readString(billing.countryCode);
  const shippingCountry = readString(shipping.countryCode);
  const billingCity = readString(billing.city);
  const shippingCity = readString(shipping.city);

  const haveCountries =
    billingCountry !== null && billingCountry !== "" &&
    shippingCountry !== null && shippingCountry !== "";
  if (!haveCountries) return null;

  const haveCities =
    billingCity !== null && billingCity !== "" &&
    shippingCity !== null && shippingCity !== "";

  if (billingCountry !== shippingCountry) {
    return {
      kind: "country_mismatch",
      billingCountry: billingCountry as string,
      shippingCountry: shippingCountry as string,
    };
  }
  if (haveCities && billingCity !== shippingCity) return { kind: "city_mismatch" };
  if (haveCities) return { kind: "agree" };
  return null;
}

/* Match semantics: `lib/argument/paymentVerification.ts` (PR-C2). */

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

  // Both the AVS block and the operational note below read the order's own
  // address comparison, so it is fetched once, up here, and compared once via
  // `compareOrderAddresses`.
  const orderPayload = payloadByField.get("order_confirmation");
  const orderAddresses = compareOrderAddresses(orderPayload);

  // AVS/CVV mismatch → anchor on avs_cvv_match
  const avsPayload = payloadByField.get("avs_cvv_match");
  if (isPlainObject(avsPayload)) {
    const verification = readPaymentVerification(avsPayload);
    const avs = verification.avs.code;
    const cvv = verification.cvv.code;
    // A FAILURE is the canonical `no_match` result and nothing else (PR-C3).
    // The old test — present && !addressVerified — counted `unknown`,
    // `not_checked` and `unavailable` as mismatches, so an unrecognised code
    // produced a warning-severity "did not fully pass" on top of its own
    // diagnostic. The issuer never said the address failed; our map simply
    // does not carry the letter.
    const avsFailed = verification.avs.normalized === "no_match";
    const cvvFailed = verification.cvv.outcome === "no_match";
    // TWO DIFFERENT QUESTIONS, KEPT APART (PR-C3):
    //   avsMatched — did the address match? Factual; drives the result
    //                sentence and the "partially passed" title.
    //   avsCited   — may we cite it to the issuer? Only a primary-sourced
    //                (network, code) cell. A scoring match resolved through an
    //                unverified cell is not citable.
    // Saying "the matching address was cited" off `avsMatched` told the
    // merchant we had filed something we deliberately withhold.
    const avsMatched = verification.addressVerified;
    const avsCited = verification.citableAddressVerified;
    const cvvMatched = verification.securityCodeVerified;
    // Fire on a genuine failure, or on a CVV-only match — the case where the
    // merchant must be told the match is kept internal (PR-C2 decision 1).
    if (avsFailed || cvvFailed || verification.cvvOnly) {
      // MERCHANT-LANGUAGE RULE: one combined plain-words sentence for
      // both results, then one short outcome sentence. "Cited" follows the
      // CITATION authority — the sourced cell — not the scoring match set.
      // Pure not-checked results carry no outcome: nothing was cited
      // or withheld, the result sentence stands alone.
      // Buckets come from the verification we already have — network-aware,
      // normalized once. Re-reading the raw code through a code-only helper
      // would re-normalize it as an unknown-network payload (PR-C3).
      const avsB = verification.avs.outcome ?? "none";
      const cvvB = verification.cvv.outcome ?? "none";
      const result = AVS_CVV_RESULT_EN[`${avsB}|${cvvB}`];
      if (result) {
        const sentences: string[] = [
          result(avs?.toUpperCase() ?? "", cvv?.toUpperCase() ?? ""),
        ];
        if (cvvMatched) {
          // Always CVV-only here: a both-matched fact never reaches this
          // block (it has no mismatch to warn about).
          sentences.push(OUTCOME_EN.cvvOnlyNotCited);
        } else if (avsCited) {
          sentences.push(
            cvvB === "no_match" ? OUTCOME_EN.onlyAvsCited : OUTCOME_EN.avsCitedClean,
          );
        } else if (avsMatched) {
          // A scoring match whose (network, code) cell is unverified, or a
          // partial address result. It still counts in the assessment; it is
          // withheld because no scheme rule we hold recognises that cell as
          // evidence. That is not the "would weaken the response" case and
          // must not borrow its words.
          sentences.push(OUTCOME_EN.avsMatchedNotCitable);
        } else if (
          (avsB === "no_match" && cvvB === "none") ||
          (cvvB === "no_match" && avsB === "none")
        ) {
          sentences.push(OUTCOME_EN.singleNotCited);
        } else if (avsB === "no_match" || cvvB === "no_match") {
          sentences.push(OUTCOME_EN.nothingCited);
        }
        // THE WITHHELD NOTE'S REPLACEMENT (2026-08-29). On a definite address
        // non-match the operational "addresses agree" note is suppressed
        // (`hasDefiniteAddressNonMatch`). Where that note WOULD have fired,
        // say so here instead of letting it vanish silently — the merchant is
        // owed the reason, and the two facts need reconciling or they read as
        // a contradiction.
        if (avsFailed && orderAddresses?.kind === "agree") {
          sentences.push(OUTCOME_EN.orderAddressesAgreeButIssuerSaysNo);
        }
        push("avs_cvv_match", {
          id: "internal:avs_cvv_mismatch",
          // "PARTIALLY PASSED" IS NOT A HEADLINE FOR AN ADDRESS FAILURE
          // (2026-08-29). The old ternary read `avsMatched || cvvMatched`, so a
          // CVV-only match on a definite address non-match — the 72-case prod
          // pattern, every one of them CVV `M` — was titled "partially
          // passed". That is the reassuring half of a two-part fact used as the
          // summary of the alarming half. A security-code match is not an
          // address match (PR-C2 decision 1), so it cannot soften an address
          // failure in the title any more than it can in the citation.
          label: avsFailed
            ? "The bank's address check did not match"
            : avsMatched || cvvMatched
              ? "Card security check partially passed"
              : "Card security check did not fully pass",
          reason: sentences.join(" "),
          severity: "warning",
        });
      }
    }

    // UNMAPPED AVS CODE → an internal diagnostic, and nothing more (PR-C3).
    //
    // The issuer returned something the canonical map has no entry for. It
    // earns no grade, no citation and no completeness credit, and it asserts
    // NOTHING against the cardholder — an unrecognised code is a gap in our
    // map, not a failed verification. The merchant is told plainly, and the
    // dispute is NOT parked: escalation happens only if a package tries to
    // rely on the code, which the claim guards refuse on their own.
    if (verification.avs.unmapped) {
      push("avs_cvv_match", {
        id: "internal:avs_code_unmapped",
        label: "Unrecognised address-verification result",
        reason: `The issuer returned an address-verification result we do not have on file (AVS ${verification.avs.code}${
          verification.network === "unknown" ? "" : `, ${verification.network}`
        }). It is recorded for review and is not used as evidence either way — it neither strengthens nor weakens the case, and nothing is on hold because of it.`,
        severity: "info",
      });
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

  // Billing/shipping comparison → anchor on order_confirmation.
  //
  // BOTH DIRECTIONS ARE OPERATIONAL NOTES, NEITHER IS EVIDENCE (PR-C4,
  // decision 4). The agreement half used to be an evidence field
  // (`billing_address_match`) graded strong as an "AVS-confirmed billing match
  // to the cardholder". It is retired. What survives is what the comparison
  // actually observes: two merchant-held addresses on the same order agree, or
  // they do not. It is never scored, never cited, never a claim input, and it
  // carries its own label so it can never again be read as address
  // verification — that lives on `avs_cvv_match` (PR-C2 + PR-C3).
  // Computed once, above, by `compareOrderAddresses`.
  //
  // THE ISSUER OVERRULES THE ORDER RECORD (2026-08-29). When AVS returned a
  // definite `no_match`, the AGREEMENT note is withheld — see
  // `hasDefiniteAddressNonMatch` for the prod measurement. This note is
  // computed from city + `zipPrefix` on the redacted order payload and cannot
  // see the street lines the issuer compared, so on a `no_match` it would
  // affirm an agreement the authoritative check has denied. It is not silently
  // dropped: the AVS warning above gains a sentence saying the order's own
  // addresses agree and why that is not the bank's check.
  //
  // The MISMATCH half is never gated — it already agrees with the issuer, and
  // suppressing it would hide a warning.
  if (orderAddresses !== null) {
    const avsSaysNoMatch =
      isPlainObject(avsPayload) &&
      hasDefiniteAddressNonMatch(readPaymentVerification(avsPayload));

    if (orderAddresses.kind === "agree" && !avsSaysNoMatch) {
      push("order_confirmation", {
        id: "internal:billing_shipping_agree",
        label: "Billing and shipping addresses on the order agree",
        reason:
          "The billing and shipping addresses you hold for this order have the same city and country. This is an internal note about your own order record, not evidence: it is not a check by the cardholder's bank, so it is never scored and never included in the dispute response. Address verification comes from the issuer's AVS result on the payment row.",
        severity: "info",
      });
    }

    if (orderAddresses.kind !== "agree") {
      const detail =
        orderAddresses.kind === "country_mismatch"
          ? `Billing country ${orderAddresses.billingCountry} differs from shipping country ${orderAddresses.shippingCountry}.`
          : "Billing city differs from shipping city.";
      push("order_confirmation", {
        id: "internal:billing_address_mismatch",
        label: "Billing and shipping addresses do not match",
        reason: `${detail} This mismatch is kept internal because it could weaken an unauthorized response — it is not cited as a positive bank argument, though the underlying order record is still included as supporting context.`,
        severity: "warning",
      });
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
