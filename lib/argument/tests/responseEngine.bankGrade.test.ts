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
};

describe("bank-grade rebuttal template — fraud family with full signals", () => {
  it("emits all six sections in the canonical order", () => {
    const ids = getSectionIds("fraud", FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);
    expect(ids).toEqual([
      "summary",
      "transaction-legitimacy",
      "payment-verification",
      "customer-checkout-behavior",
      "device-location",
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

  it("includes all four payment-verification sentences when every signal is present", () => {
    const text = joinSections("fraud", FULL_FRAUD_FLAGS, FULL_FRAUD_DATA);
    expect(text).toContain("The transaction was successfully authorized by the issuer.");
    expect(text).toContain("The payment was subsequently captured without error.");
    expect(text).toContain(
      "Address Verification Service (AVS) returned a match (Y), confirming that the billing address matched the issuer's records.",
    );
    expect(text).toContain(
      "Card Verification Value (CVV) returned a match (M), confirming that the correct card security code was provided.",
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
    expect(text).toContain("Address Verification Service (AVS) returned a match (Y)");
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

  it("omits payment-verification and transaction-legitimacy when no payment signals exist", () => {
    const ids = getSectionIds("fraud", EMPTY_FLAGS, EMPTY_DATA);
    expect(ids).not.toContain("transaction-legitimacy");
    expect(ids).not.toContain("payment-verification");
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
  it("emits customer-checkout-behavior only when orderConfirmation is true", () => {
    const ids = getSectionIds(
      "fraud",
      { ...EMPTY_FLAGS, orderConfirmation: true },
      EMPTY_DATA,
    );
    expect(ids).toContain("customer-checkout-behavior");
    const text = joinSections("fraud", { ...EMPTY_FLAGS, orderConfirmation: true }, EMPTY_DATA);
    expect(text).toContain("a confirmation email was sent to the customer.");
    expect(text).not.toContain("registered email address");
  });

  it("omits customer-checkout-behavior when orderConfirmation is false", () => {
    const ids = getSectionIds("fraud", EMPTY_FLAGS, EMPTY_DATA);
    expect(ids).not.toContain("customer-checkout-behavior");
  });
});

describe("bank-grade rebuttal template — device & location gating", () => {
  it("omits device-location when no IP narrative fields exist", () => {
    const ids = getSectionIds("fraud", FULL_FRAUD_FLAGS, {
      ...FULL_FRAUD_DATA,
      ipCity: null,
      ipRegion: null,
      ipCountry: null,
      ipOrg: null,
    });
    expect(ids).not.toContain("device-location");
  });

  it("emits device-location when IP data is present", () => {
    const data: EvidenceData = {
      ipCity: "Stockholm",
      ipCountry: "SE",
      ipOrg: "Telia",
    };
    expect(getSectionIds("fraud", EMPTY_FLAGS, data)).toContain("device-location");
  });

  it("uses the exact mismatch neutralizer from the spec", () => {
    const data: EvidenceData = {
      ipCity: "Rio de Janeiro",
      ipCountry: "BR",
      ipOrg: "Telefonica",
      ipCountryMatchesShipping: false,
    };
    expect(joinSections("fraud", EMPTY_FLAGS, data)).toContain(
      "While the purchase location differs from the shipping destination, this is consistent with legitimate cross-border purchasing behavior and does not indicate unauthorized use.",
    );
  });

  it("omits mismatch neutralizer when ipCountryMatchesShipping is true or null", () => {
    for (const ipCountryMatchesShipping of [true, null] as const) {
      const data: EvidenceData = {
        ipCity: "Stockholm",
        ipCountry: "SE",
        ipOrg: "Telia",
        ipCountryMatchesShipping,
      };
      expect(joinSections("fraud", EMPTY_FLAGS, data)).not.toContain(
        "differs from the shipping destination",
      );
    }
  });

  it("renders the clean-network sentence only when ipNoVpnProxyHosting is true", () => {
    const cleanData: EvidenceData = {
      ipCity: "Stockholm",
      ipCountry: "SE",
      ipNoVpnProxyHosting: true,
    };
    expect(joinSections("fraud", EMPTY_FLAGS, cleanData)).toContain(
      "No VPN, proxy, or hosting indicators were detected, indicating a standard consumer network.",
    );

    for (const ipNoVpnProxyHosting of [null, false] as const) {
      const data: EvidenceData = {
        ipCity: "Stockholm",
        ipCountry: "SE",
        ipNoVpnProxyHosting,
      };
      expect(joinSections("fraud", EMPTY_FLAGS, data)).not.toContain(
        "No VPN, proxy, or hosting indicators were detected",
      );
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
    "transaction-legitimacy",
    "payment-verification",
    "customer-checkout-behavior",
    "device-location",
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
