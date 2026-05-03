/**
 * Bank-grade rebuttal template tests (fraud, delivery, billing, general).
 */

import { describe, it, expect } from "vitest";
import {
  generateDisputeResponse,
  type EvidenceData,
  type EvidenceFlags,
  type ReasonFamily,
} from "../responseEngine";

const EMPTY_FLAGS: EvidenceFlags = {
  avs: false,
  cvv: false,
  tracking: false,
  deliveryConfirmed: false,
  customerContact: false,
  billingShippingMatch: false,
  orderConfirmation: false,
  customerHistory: false,
  policyAttached: false,
  refundIssued: false,
  refundAmountMatches: false,
  cancellationRequest: false,
  cancellationConfirmed: false,
  disputeWithdrawalEvidence: false,
  productDescription: false,
  digitalAccessLogs: false,
  duplicateChargeEvidence: false,
  amountCorrectEvidence: false,
};

const EMPTY_DATA: EvidenceData = {};

const BANK_GRADE_OPENING_PHRASE =
  "We formally dispute this chargeback and request that the issuer reverse the claim based on clear evidence that the transaction was completed by the legitimate cardholder";

const BANK_GRADE_CLOSING_PHRASE =
  "We request that the issuer reverse this chargeback and return the disputed funds to the merchant";

function joinSections(family: ReasonFamily, flags: EvidenceFlags, data: EvidenceData): string {
  const result = generateDisputeResponse(family, flags, data);
  return result.sections.map((s) => s.text).join("\n\n");
}

function getSectionIds(family: ReasonFamily, flags: EvidenceFlags, data: EvidenceData): string[] {
  const result = generateDisputeResponse(family, flags, data);
  return result.sections.map((s) => s.id);
}

const FULL_FRAUD_FLAGS: EvidenceFlags = {
  ...EMPTY_FLAGS,
  avs: true,
  cvv: true,
  orderConfirmation: true,
  billingShippingMatch: true,
  customerHistory: true,
  customerContact: true,
};

const FULL_FRAUD_DATA: EvidenceData = {
  avsCode: "Y",
  cvvCode: "M",
  authorizationSucceeded: true,
  captureSucceeded: true,
  ipCity: "Rio de Janeiro",
  ipRegion: "Rio de Janeiro",
  ipCountry: "BR",
  ipOrg: "AS18881 TELEFÔNICA BRASIL S.A",
  ipNoVpnProxyHosting: true,
  ipCountryMatchesShipping: true,
  // Bank-eligibility gate is the hard prerequisite for the IP
  // paragraph in any bank-facing surface — keeping it true here
  // exercises the canonical positive case end-to-end.
  bankEligible: true,
  hasOrderConfirmation: true,
  hasCustomerEmail: true,
  hasSupportingDocs: true,
};

describe("bank-grade rebuttal template — fraud family with full signals", () => {
  it("emits opening, middle blocks, and closing in the canonical order", () => {
    const ids = getSectionIds("fraud", FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);
    expect(ids).toEqual([
      "summary",
      "bank-grade-payment",
      "bank-grade-transaction",
      "bank-grade-device",
      "bank-grade-supporting",
      "conclusion",
    ]);
  });

  it("opens with the exact reversal-request framing", () => {
    const result = generateDisputeResponse("fraud", FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);
    expect(result.sections[0].type).toBe("summary");
    expect(result.sections[0].text).toBe(BANK_GRADE_OPENING_PHRASE + ".");
  });

  it("closes with the reversal demand and cites this transaction", () => {
    const result = generateDisputeResponse("fraud", FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);
    const last = result.sections[result.sections.length - 1];
    expect(last.type).toBe("conclusion");
    expect(last.text).toContain(BANK_GRADE_CLOSING_PHRASE);
    expect(last.text).toContain("this transaction was completed by the legitimate cardholder");
  });

  it("includes all payment-authentication sentences when every signal is present", () => {
    const text = joinSections("fraud", FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);
    expect(text).toContain("The transaction was successfully authorized by the issuer.");
    expect(text).toContain("The payment was subsequently captured without error.");
    expect(text).toContain(
      "Address Verification Service (AVS) returned a full match (Y), confirming that the billing address matched the issuer's records.",
    );
    expect(text).toContain(
      "Card Verification Value (CVV) returned a match (M), confirming that the correct card security code was provided.",
    );
    expect(text).toContain(
      "These verification results demonstrate that the purchaser had possession of the card details at the time of the transaction.",
    );
  });

  it("includes the supporting-documentation paragraph when hasSupportingDocs is true", () => {
    const text = joinSections("fraud", FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);
    expect(text).toContain(
      "Supporting documentation is provided to reinforce the legitimacy of the transaction",
    );
  });

  it("renders device & location with clean-network wording from the spec", () => {
    const text = joinSections("fraud", FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);
    expect(text).toContain(
      "The transaction originated from an IP address located in Rio de Janeiro, Rio de Janeiro, BR, associated with AS18881 TELEFÔNICA BRASIL S.A.",
    );
    expect(text).toContain(
      "No VPN, proxy, or hosting indicators were detected, indicating a standard consumer network.",
    );
  });
});

describe("bank-grade rebuttal template — payment-line gating", () => {
  it("emits only the AVS line when CVV / auth / capture are absent and code is Y", () => {
    const flags: EvidenceFlags = { ...EMPTY_FLAGS, avs: true };
    const data: EvidenceData = { avsCode: "Y" };
    const text = joinSections("fraud", flags, data);
    expect(text).toContain("Address Verification Service (AVS) returned a full match (Y)");
    expect(text).not.toContain("Card Verification Value");
    expect(text).not.toContain("successfully authorized by the issuer");
    expect(text).not.toContain("subsequently captured without error");
  });

  it("emits only the CVV line when AVS / auth / capture are absent and code is M", () => {
    const flags: EvidenceFlags = { ...EMPTY_FLAGS, cvv: true };
    const data: EvidenceData = { cvvCode: "M" };
    const text = joinSections("fraud", flags, data);
    expect(text).toContain("Card Verification Value (CVV) returned a match (M)");
    expect(text).not.toContain("Address Verification Service");
  });

  it("emits only the authorization line when only authorizationSucceeded is set", () => {
    const data: EvidenceData = { authorizationSucceeded: true };
    const text = joinSections("fraud", EMPTY_FLAGS, data);
    expect(text).toContain("The transaction was successfully authorized by the issuer.");
    expect(text).not.toContain("subsequently captured without error");
    expect(text).not.toContain("Address Verification Service");
    expect(text).not.toContain("Card Verification Value");
  });

  it("emits only the capture line when only captureSucceeded is set", () => {
    const data: EvidenceData = { captureSucceeded: true };
    const text = joinSections("fraud", EMPTY_FLAGS, data);
    expect(text).toContain("The payment was subsequently captured without error.");
    expect(text).not.toContain("successfully authorized by the issuer");
  });

  it("omits bank-grade-payment when no payment signals exist", () => {
    const ids = getSectionIds("fraud", EMPTY_FLAGS, EMPTY_DATA);
    expect(ids).not.toContain("bank-grade-payment");
  });

  it("does not emit an AVS sentence when avsCode is not Y even if flags.avs is true", () => {
    const flags: EvidenceFlags = { ...EMPTY_FLAGS, avs: true };
    const data: EvidenceData = { avsCode: "A" };
    const text = joinSections("fraud", flags, data);
    expect(text).not.toContain("Address Verification Service");
  });

  it("does not emit a CVV sentence when cvvCode is not M even if flags.cvv is true", () => {
    const flags: EvidenceFlags = { ...EMPTY_FLAGS, cvv: true };
    const data: EvidenceData = { cvvCode: "P" };
    const text = joinSections("fraud", flags, data);
    expect(text).not.toContain("Card Verification Value");
  });
});

describe("bank-grade rebuttal template — customer/checkout gating", () => {
  it("emits transaction behavior when orderConfirmation flag is true (merged into EvidenceData)", () => {
    const ids = getSectionIds(
      "fraud",
      { ...EMPTY_FLAGS, orderConfirmation: true },
      EMPTY_DATA,
    );
    expect(ids).toContain("bank-grade-transaction");
    const text = joinSections("fraud", { ...EMPTY_FLAGS, orderConfirmation: true }, EMPTY_DATA);
    expect(text).toContain(
      "The order was placed through the merchant's standard online checkout and followed a normal customer-driven purchase flow.",
    );
    expect(text).toContain("An order confirmation was generated immediately after checkout.");
    expect(text).not.toContain("registered email address");
  });

  it("includes confirmation email sentence only when hasCustomerEmail is true", () => {
    const text = joinSections(
      "fraud",
      { ...EMPTY_FLAGS, orderConfirmation: true },
      { hasOrderConfirmation: true, hasCustomerEmail: true },
    );
    expect(text).toContain("A confirmation email was sent to the customer's registered email address.");
  });

  it("omits bank-grade-transaction when order confirmation is absent", () => {
    const ids = getSectionIds("fraud", EMPTY_FLAGS, EMPTY_DATA);
    expect(ids).not.toContain("bank-grade-transaction");
  });
});

/**
 * Assert that none of the IP-signal values from `data` appear in
 * `text`. Reads values live from `EvidenceData` so the test is not
 * coupled to specific fixture strings.
 */
function expectNoIpSignalLeak(text: string, data: EvidenceData): void {
  for (const [field, value] of [
    ["ipCity", data.ipCity],
    ["ipRegion", data.ipRegion],
    ["ipCountry", data.ipCountry],
    ["ipOrg", data.ipOrg],
  ] as const) {
    if (typeof value === "string" && value.trim().length > 0) {
      expect(
        text,
        `bank-facing text must not contain ${field} value "${value}"`,
      ).not.toContain(value);
    }
  }
}

describe("bank-grade rebuttal template — device & location gating", () => {
  // The device paragraph is gated by `bankEligible === true` AND a
  // clean country match AND no VPN/proxy/hosting. Anything else means
  // the entire paragraph is omitted from bank-facing output — never
  // reframed, never softened.
  const ELIGIBLE_BASE = {
    ipCity: "Stockholm",
    ipCountry: "SE",
    ipOrg: "Telia",
    ipCountryMatchesShipping: true as const,
    ipNoVpnProxyHosting: true as const,
    bankEligible: true as const,
  } satisfies EvidenceData;

  it("omits bank-grade-device when no IP narrative fields exist", () => {
    const ids = getSectionIds("fraud", FULL_FRAUD_FLAGS, {
      ...FULL_FRAUD_DATA,
      ipCity: null,
      ipRegion: null,
      ipCountry: null,
      ipOrg: null,
    });
    expect(ids).not.toContain("bank-grade-device");
  });

  it("emits bank-grade-device when IP data is present AND bankEligible is true", () => {
    expect(getSectionIds("fraud", EMPTY_FLAGS, ELIGIBLE_BASE)).toContain("bank-grade-device");
  });

  it("omits bank-grade-device when bankEligible is missing or false (IP data alone is not enough)", () => {
    for (const bankEligible of [undefined, null, false] as const) {
      const data: EvidenceData = { ...ELIGIBLE_BASE, bankEligible };
      expect(getSectionIds("fraud", EMPTY_FLAGS, data)).not.toContain("bank-grade-device");
    }
  });

  it("omits bank-grade-device entirely when ipCountryMatchesShipping is false (no defensive reframing)", () => {
    const data: EvidenceData = {
      ipCity: "Rio de Janeiro",
      ipCountry: "BR",
      ipOrg: "Telefonica",
      ipNoVpnProxyHosting: true,
      ipCountryMatchesShipping: false,
      // Even with bankEligible accidentally set true, the secondary
      // mismatch check must still suppress the paragraph.
      bankEligible: true,
    };
    const text = joinSections("fraud", EMPTY_FLAGS, data);
    expect(text).not.toContain("differs from the shipping destination");
    expect(text).not.toContain("cross-border");
    expectNoIpSignalLeak(text, data);
  });

  it("omits bank-grade-device when ipNoVpnProxyHosting is null or false", () => {
    for (const ipNoVpnProxyHosting of [null, false] as const) {
      const data: EvidenceData = { ...ELIGIBLE_BASE, ipNoVpnProxyHosting };
      const text = joinSections("fraud", EMPTY_FLAGS, data);
      expect(getSectionIds("fraud", EMPTY_FLAGS, data)).not.toContain("bank-grade-device");
      expect(text).not.toContain("No VPN, proxy, or hosting indicators were detected");
      expectNoIpSignalLeak(text, data);
    }
  });

  it("renders the clean-network sentence in the canonical positive case", () => {
    expect(joinSections("fraud", EMPTY_FLAGS, ELIGIBLE_BASE)).toContain(
      "No VPN, proxy, or hosting indicators were detected, indicating a standard consumer network.",
    );
  });

  it("never emits the cross-border reframing phrase under any input", () => {
    // The neutralizer constant has been deleted entirely. Even when
    // someone constructs a data object that previously triggered it,
    // the output must not contain the banned phrase.
    const inputs: EvidenceData[] = [
      ELIGIBLE_BASE,
      { ...ELIGIBLE_BASE, ipCountryMatchesShipping: false },
      { ...ELIGIBLE_BASE, bankEligible: false },
      FULL_FRAUD_DATA,
    ];
    for (const data of inputs) {
      const text = joinSections("fraud", EMPTY_FLAGS, data);
      expect(text).not.toContain("cross-border");
      expect(text).not.toContain("consistent with legitimate cross-border");
      expect(text).not.toContain("does not indicate unauthorized use");
      expect(text).not.toContain("differs from the shipping destination");
    }
  });
});

describe("bank-grade rebuttal template — safety constraints", () => {
  const text = joinSections("fraud", FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);

  it("never emits raw JSON braces or quoted keys", () => {
    expect(text).not.toMatch(/[{}\[\]]/);
    expect(text).not.toMatch(/"\s*:/);
  });

  it("never uses weak or uncertain language", () => {
    expect(text).not.toMatch(/\bmay\b/i);
    expect(text).not.toMatch(/\bmight\b/i);
    expect(text).not.toMatch(/\bweak\b/i);
    expect(text).not.toMatch(/\brisk\b/i);
    expect(text).not.toMatch(/\buncertain\b/i);
    expect(text).not.toMatch(/\bappears\b/i);
    expect(text).not.toMatch(/\bsuggests\b/i);
  });

  it("never leaks internal diagnostics", () => {
    expect(text).not.toMatch(/\bscore\b/i);
    expect(text).not.toMatch(/\brisk level\b/i);
    expect(text).not.toMatch(/\bbank eligible\b/i);
    expect(text).not.toMatch(/\bchecklist\b/i);
    expect(text).not.toMatch(/\bcompleteness\b/i);
  });
});

describe("bank-grade rebuttal template — delivery, billing, general", () => {
  const canonical = [
    "summary",
    "bank-grade-payment",
    "bank-grade-transaction",
    "bank-grade-device",
    "bank-grade-supporting",
    "conclusion",
  ] as const;

  it.each(["delivery", "billing", "general"] as const)("family %s matches canonical section ids", (family) => {
    expect(getSectionIds(family, FULL_FRAUD_FLAGS, FULL_FRAUD_DATA)).toEqual([...canonical]);
    const text = joinSections(family, FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);
    expect(text).toContain(BANK_GRADE_OPENING_PHRASE);
    expect(text).toContain(BANK_GRADE_CLOSING_PHRASE);
  });
});

describe("bank-grade carve-out — refund, subscription, product, digital", () => {
  function getSummaryText(family: ReasonFamily): string {
    return generateDisputeResponse(family, EMPTY_FLAGS, EMPTY_DATA).sections[0].text;
  }

  it("refund family summary unchanged", () => {
    expect(getSummaryText("refund")).toBe(
      "We respectfully dispute this claim. The refund obligation has been addressed in accordance with the store's policies and the transaction details are documented below.",
    );
  });

  it("subscription family summary unchanged", () => {
    expect(getSummaryText("subscription")).toBe(
      "We respectfully dispute this claim. The customer agreed to the subscription terms and was properly notified of all billing and cancellation conditions.",
    );
  });

  it("product family summary unchanged", () => {
    expect(getSummaryText("product")).toBe(
      "We respectfully dispute this claim. The product was accurately described and delivered as advertised. The store's return and refund policy was clearly disclosed at checkout.",
    );
  });

  it("digital family summary unchanged", () => {
    expect(getSummaryText("digital")).toBe(
      "We respectfully dispute this claim. The digital product or service was successfully delivered and accessed by the customer.",
    );
  });
});
