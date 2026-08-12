/**
 * PR-C1 — structural claim authorization.
 *
 * The audit measured 7 affirmative "delivered to the verified address"
 * assertions across 3 disputes produced while the structured flag was FALSE,
 * on modules whose prompts never mentioned the claim. These tests pin the two
 * halves of the fix: `address_delivery` is underivable from any fact the
 * system can produce, and the detector recognises the claim by structure
 * rather than by the phrasings that happened to occur.
 */

import { describe, expect, it } from "vitest";
import {
  checkAddressDeliveryAuthorization,
  classifyAddressDeliveryClaim,
  claimsAddressDelivery,
  deriveClaimCapabilities,
} from "../claimCapabilities";
import type { EvidenceFact } from "../types";

function fact(category: string, value: Record<string, unknown>): EvidenceFact {
  return {
    id: `f-${category}`,
    category,
    label: category,
    value,
    source: "test",
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
  } as unknown as EvidenceFact;
}

describe("deriveClaimCapabilities", () => {
  it("NO producible fact combination licenses address_delivery", () => {
    // Every delivery shape the collectors can emit, plus the retired keys a
    // historical pack might still carry.
    const combos: Record<string, unknown>[] = [
      { proofType: "delivered_confirmed" },
      { proofType: "signature_confirmed", signedByName: "R. Pipe" },
      { proofType: "delivered_unverified" },
      { proofType: "label_created" },
      { proofType: "delivered_confirmed", deliveredToVerifiedAddress: true },
      { proofType: "delivered_confirmed", collectedByCustomer: true },
      {
        proofType: "signature_confirmed",
        signedByName: "R. Pipe",
        deliveredToVerifiedAddress: true,
        collectedByCustomer: true,
      },
    ];
    for (const value of combos) {
      for (const category of ["delivery_proof", "shipping_tracking"]) {
        const caps = deriveClaimCapabilities([fact(category, value)]);
        expect(caps.has("address_delivery")).toBe(false);
      }
    }
    // Nor from a whole realistic fact set.
    const caps = deriveClaimCapabilities([
      fact("delivery_proof", { proofType: "delivered_confirmed", deliveredToVerifiedAddress: true }),
      fact("payment_authentication", { avsResult: "Y", cvvResult: "M" }),
      fact("order_record", { orderName: "#1001" }),
    ]);
    expect(caps.has("address_delivery")).toBe(false);
  });

  it("preserves the delivery capabilities that PR-C1 must not break", () => {
    const confirmed = deriveClaimCapabilities([
      fact("delivery_proof", { proofType: "delivered_confirmed" }),
    ]);
    expect(confirmed.has("delivery_occurred")).toBe(true);
    expect(confirmed.has("signature_receipt")).toBe(false);

    const signed = deriveClaimCapabilities([
      fact("delivery_proof", { proofType: "signature_confirmed", signedByName: "R. Pipe" }),
    ]);
    expect(signed.has("signature_receipt")).toBe(true);
    expect(signed.has("delivery_occurred")).toBe(true);
  });

  it("an inferred pickup status alone grants no signature capability", () => {
    const caps = deriveClaimCapabilities([
      fact("delivery_proof", { proofType: "delivered_confirmed", collectedByCustomer: true }),
    ]);
    expect(caps.has("signature_receipt")).toBe(false);
  });
});

describe("classifyAddressDeliveryClaim — affirmative phrasings", () => {
  const AFFIRMATIVE = [
    // The exact production phrasings.
    "The parcel was delivered to the verified address on 12 May 2026.",
    "Delivery was made to the cardholder's verified address.",
    "The order was delivered to the address on file.",
    "The item was delivered to the same physical address the cardholder provided.",
    // Alternate phrasings that no historical regex covered.
    "The consignment reached the customer's residence on 12 May.",
    "The shipment arrived at the billing address recorded for this account.",
    "Our carrier handed the package to the recipient at their home address.",
    "The parcel was left at the customer's premises.",
    "Records show the package was received at the address of record.",
    "The order shipped to, and was received at, the cardholder's address.",
    // The retired derivation's own fact, asserted directly.
    "The billing and shipping addresses match for this order.",
    "The shipping address is the same as the billing address.",
  ];

  for (const text of AFFIRMATIVE) {
    it(`rejects: ${text.slice(0, 52)}…`, () => {
      expect(classifyAddressDeliveryClaim(text)).toBe("affirmative");
      expect(claimsAddressDelivery(text)).toBe(true);
    });
  }
});

describe("classifyAddressDeliveryClaim — negated and prohibited language", () => {
  const NEGATED = [
    "No evidence of delivery to a verified address is included in this response.",
    "We do not claim the parcel was delivered to the cardholder's address.",
    "The merchant did not receive an AVS match, so no verified-address delivery is asserted.",
    "Delivery to the billing address cannot be confirmed from the carrier record.",
  ];
  for (const text of NEGATED) {
    it(`classifies as negated: ${text.slice(0, 46)}…`, () => {
      expect(classifyAddressDeliveryClaim(text)).toBe("negated");
      expect(claimsAddressDelivery(text)).toBe(false);
    });
  }
});

describe("classifyAddressDeliveryClaim — ambiguity fails closed", () => {
  const AMBIGUOUS = [
    "Delivery to the customer's address.",
    "Parcel — recipient address, 12 May.",
  ];
  for (const text of AMBIGUOUS) {
    it(`blocks (ambiguous): ${text.slice(0, 46)}…`, () => {
      expect(classifyAddressDeliveryClaim(text)).toBe("ambiguous");
      expect(claimsAddressDelivery(text)).toBe(true);
    });
  }
});

describe("detector bypasses closed in review", () => {
  // Each of these SHIPPED under an earlier revision of the detector.
  const MUST_BLOCK: Array<[string, string]> = [
    [
      "scoped-prohibition bypass — prohibition in one clause, assertion after 'but'",
      "We do not claim that the carrier identified the address, but the parcel was delivered to the billing address.",
    ],
    [
      "scoped-prohibition bypass — semicolon contrast",
      "No assertion is made about the delivery point; the parcel was delivered to the cardholder's address.",
    ],
    [
      "negative-qualifier bypass — an adjective is not negation of the predicate",
      "The unverified carrier record shows the parcel was delivered to the billing address.",
    ],
    [
      "negative-qualifier bypass — 'unconfirmed'",
      "An unconfirmed scan indicates the package arrived at the customer's residence.",
    ],
    [
      "issuer-record scope bypass — AVS mentioned in a DIFFERENT clause",
      "The billing and shipping addresses match, and the issuer's records confirm payment verification.",
    ],
    ["physical-location paraphrase — home", "The consignment reached the customer's home."],
    [
      "physical-location paraphrase — listed location",
      "The package arrived at the customer's listed location.",
    ],
    [
      "physical-location paraphrase — stated destination",
      "The order reached its stated destination.",
    ],
    [
      "physical-location paraphrase — where the buyer asked us to send",
      "The goods arrived where the buyer asked us to send them.",
    ],
  ];

  for (const [name, text] of MUST_BLOCK) {
    it(`blocks: ${name}`, () => {
      const verdict = classifyAddressDeliveryClaim(text);
      expect(verdict === "affirmative" || verdict === "ambiguous").toBe(true);
      expect(claimsAddressDelivery(text)).toBe(true);
    });
  }

  // Second review pass. Each of these shipped under the FLAT negation word
  // list: any `no` / `not` / `without` anywhere in the claim clause negated
  // it, even when the thing being negated was a delay, a damage state, or an
  // unrelated evidentiary point.
  const MUST_BLOCK_REVIEW_3: Array<[string, string]> = [
    [
      "qualifier negation — 'without delay' does not deny the destination",
      "The parcel was delivered to the billing address without delay.",
    ],
    [
      "qualifier negation — 'without incident'",
      "The package arrived at the customer's home without incident.",
    ],
    [
      "qualifier negation — 'not damaged' negates a damage state, not delivery",
      "The parcel was not damaged when it was delivered to the billing address.",
    ],
    [
      "prohibition scope — an assertion joined with 'and' is NOT covered",
      "We do not claim that the carrier identified the address, and the parcel was delivered to the billing address.",
    ],
    [
      "double negative — 'no question that' is an affirmation",
      "There is no question that the parcel was delivered to the customer's residence.",
    ],
    [
      "double negative — 'no dispute that'",
      "There is no dispute that the goods reached the cardholder's premises.",
    ],
    [
      "destination paraphrase — 'as instructed by the buyer'",
      "The parcel was delivered as instructed by the buyer.",
    ],
    [
      "destination paraphrase — a literal street address",
      "The package went to 42 Elm Road.",
    ],
    [
      "destination paraphrase — literal street address, alternate form",
      "The consignment was left at 1 Main St.",
    ],
    [
      "subordinate boundary — 'after' opens a new scope",
      "No refund was issued after the parcel was delivered to the cardholder's address.",
    ],
    [
      "subordinate boundary — 'because' opens a new scope",
      "The claim cannot be correct because the parcel was delivered to the billing address.",
    ],
    [
      "subordinate boundary — 'once' opens a new scope",
      "No further contact was received once the goods arrived at the customer's residence.",
    ],
  ];

  for (const [name, text] of MUST_BLOCK_REVIEW_3) {
    it(`blocks: ${name}`, () => {
      const verdict = classifyAddressDeliveryClaim(text);
      expect(verdict === "affirmative" || verdict === "ambiguous", verdict).toBe(true);
      expect(claimsAddressDelivery(text)).toBe(true);
    });
  }

  it("a prohibition that DOES cover the whole sentence still reads as negated", () => {
    expect(
      classifyAddressDeliveryClaim(
        "We do not claim that the parcel was delivered to the billing address.",
      ),
    ).toBe("negated");
  });

  it("an evidentiary negative about the source still reads as negated", () => {
    expect(
      classifyAddressDeliveryClaim("The carrier record does not identify the delivery address."),
    ).toBe("negated");
  });

  it("the AVS clause keeps its own licensed wording", () => {
    // Same sentence shape as the issuer-scope bypass, but the AVS statement is
    // the ONLY claim — there is no billing↔shipping agreement assertion.
    expect(
      claimsAddressDelivery(
        "The billing address matched the issuer's records and the card verification code matched the issuer's records.",
      ),
    ).toBe(false);
  });

  it("a prohibition interrupted by a parenthetical does NOT carry — it fails closed", () => {
    // "We do not claim, on the basis of the carrier record, that the parcel
    // was delivered…" is a genuine prohibition, but the intervening clause
    // makes its scope unresolvable by clause boundary. The rule is "a
    // prohibition must demonstrably cover the assertion", so an unprovable
    // scope blocks rather than clears. Over-blocking a prohibition costs a
    // regeneration; under-blocking files an unsupported claim.
    const verdict = classifyAddressDeliveryClaim(
      "We do not claim, on the basis of the carrier record, that the parcel was delivered to the billing address.",
    );
    expect(verdict === "affirmative" || verdict === "ambiguous").toBe(true);
  });

  it("an uninterrupted prohibition of the exact assertion still reads as negated", () => {
    expect(
      classifyAddressDeliveryClaim(
        "We do not claim that the parcel was delivered to the billing address on the basis of the carrier record.",
      ),
    ).toBe("negated");
  });

  /**
   * The straddle fallback must not couple a carrier-delivery clause with an
   * AVS clause that merely stands next to it.
   *
   * Both sentences are verbatim from production package
   * 08575d57-c692-4fb5-a5c6-f0112f808008 (dispute 77eb59a3, 2026-08-10). Each
   * pairs two separately-licensed facts — carrier + tracking + date, and the
   * `avs_cvv_match` statement — and neither says where the parcel went. They
   * were classified `affirmative`, failed validation on the first attempt and
   * again on the fed-back retry, and left the dispute with no fileable
   * package one day before its deadline.
   */
  const AVS_BESIDE_DELIVERY = [
    "The carrier confirmed delivery on 17 July 2026 (TechSHIP, tracking 420327129261290416102423888396), and payment authentication records indicate that the billing address matched the issuer's records at the time of purchase.",
    "The carrier confirmed delivery on 17 July 2026 (TechSHIP, tracking 420327129261290416102423888396), payment authentication records indicate the billing address matched the issuer's records at the time of purchase, and no return has been initiated.",
  ];
  for (const text of AVS_BESIDE_DELIVERY) {
    it(`does not couple delivery with an adjacent AVS clause: ${text.slice(0, 42)}…`, () => {
      expect(classifyAddressDeliveryClaim(text)).toBe("none");
      expect(claimsAddressDelivery(text)).toBe(false);
    });
  }

  it("an AVS clause in a DESTINATION role is still the destination", () => {
    // The discount applies to an address that is the SUBJECT of an AVS
    // predicate, never to one introduced as where the parcel went.
    const verdict = classifyAddressDeliveryClaim(
      "The parcel was delivered, to the billing address that matched the issuer's records.",
    );
    expect(verdict === "affirmative" || verdict === "ambiguous", verdict).toBe(true);
  });

  it("an AVS clause that carries its own delivery term is not discounted", () => {
    const verdict = classifyAddressDeliveryClaim(
      "Tracking shows the goods reached the address held in the issuer's records.",
    );
    expect(verdict === "affirmative" || verdict === "ambiguous", verdict).toBe(true);
  });

  /**
   * A CARRIER'S URL SCHEME IS NOT A DELIVERY CLAIM (2026-08-12).
   *
   * All four are verbatim from production packages refused as
   * `unauthorized_claim`, pulled by
   * `scripts/sql/address-claim-failing-narratives.sql`. Each is the canonical
   * PERMITTED delivery sentence — carrier, date, tracking number — which rule
   * 14 lists as RIGHT. They were blocked because DHL's tracking path contains
   * `/home/` and `home` is an ADDRESS_TERM.
   *
   * Pinned as data, not paraphrased: the detector has to be measured against
   * the links carriers actually issue.
   */
  const TRACKING_URL_FALSE_POSITIVES: Array<[string, string]> = [
    [
      "'tracking URL:' parenthetical",
      "The carrier TechSHIP confirmed delivery on 13 July 2026 under tracking number 420754079261290416102420728879 (tracking URL: https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=420754079261290416102420728879).",
    ],
    [
      "'trackable at' phrasing",
      "The carrier confirmed delivery of the shipment on 10 July 2026 (TechSHIP, tracking 420754079261290416102425275033, trackable at https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=420754079261290416102425275033).",
    ],
    [
      "'tracking available at', no delivery confirmation",
      "The shipment was handled by TechSHIP under tracking number 420115809261290416102420728510, with tracking available at https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=420115809261290416102420728510.",
    ],
    [
      "URL inline in the chronology sentence",
      "The carrier confirmed delivery on 13 July 2026 (TechSHIP, tracking 420754079261290416102420739080, tracking URL: https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=420754079261290416102420739080).",
    ],
  ];

  for (const [name, text] of TRACKING_URL_FALSE_POSITIVES) {
    it(`does not block the permitted delivery sentence: ${name}`, () => {
      expect(classifyAddressDeliveryClaim(text)).toBe("none");
      expect(claimsAddressDelivery(text)).toBe(false);
    });
  }

  /**
   * THE FALSE-NEGATIVE GUARD for the URL strip.
   *
   * A false positive costs a regeneration; a false negative sends an
   * unsupported claim to an issuer. So a link must never launder a genuine
   * destination assertion made in the prose beside it.
   */
  const URL_MUST_NOT_LAUNDER: Array<[string, string]> = [
    [
      "a tracking URL does not license a destination claim in the same sentence",
      "The parcel was delivered to the cardholder's billing address (tracking URL: https://www.dhl.com/us-en/home/tracking.html?tracking-id=42075407926).",
    ],
    [
      "a link after a destination claim does not clear it",
      "The goods reached the customer's residence; see https://www.dhl.com/us-en/home/tracking.html?tracking-id=42075407926.",
    ],
    [
      "a bare www link does not license a destination claim",
      "The consignment was left at the customer's premises, per www.dhl.com/us-en/home/tracking.html.",
    ],
  ];

  for (const [name, text] of URL_MUST_NOT_LAUNDER) {
    it(`still blocks: ${name}`, () => {
      const verdict = classifyAddressDeliveryClaim(text);
      expect(verdict === "affirmative" || verdict === "ambiguous", verdict).toBe(true);
      expect(claimsAddressDelivery(text)).toBe(true);
    });
  }

  it("IP-location prose is not a delivery destination", () => {
    expect(
      claimsAddressDelivery(
        "The order IP location resolved to the same country, and the parcel shipped the next day.",
      ),
    ).toBe(false);
  });
});

describe("classifyAddressDeliveryClaim — legitimate prose still passes", () => {
  const CLEAN = [
    "The carrier confirmed delivery of the shipment on 12 May 2026 (PostNord, tracking 1234567890).",
    "The carrier recorded a signature on delivery.",
    "Tracking 1234567890 shows the shipment was delivered on 12 May 2026.",
    "The recipient collected the parcel at the pickup point on 12 May.",
    // The AVS fact keeps its licensed wording — it is a different claim, owned
    // by avs_cvv_match, and PR-C1 does not touch AVS.
    "The billing address matched the issuer's records and the card verification code matched the issuer's records.",
    // Non-physical "address" uses must not trip the detector.
    "The order confirmation was sent to the customer's email address on 1 May.",
    "The order IP address geolocated to the same country as the order.",
    // Ordinary carrier / date / tracking prose — no destination is named, so
    // there is no address-delivery claim to authorize. These are the
    // sentences PR-C1 must NOT start blocking.
    "The parcel was dispatched on 10 May 2026 and the carrier scanned it as delivered on 12 May 2026.",
    "PostNord tracking 00370729990123456789 records delivery at 14:07 on 12 May.",
    "The shipment was not delivered on the first attempt and was redelivered on 13 May.",
    "The order was fulfilled in a single shipment; no items were returned.",
    "Delivery took place two days after dispatch, without delay.",
    // Independently sourced signature / POD — the evidence PR-C1 preserves.
    "The carrier captured a signature from R. Pipe on delivery.",
    "Proof of delivery lists the recipient's signature and the scan timestamp.",
  ];
  for (const text of CLEAN) {
    it(`passes: ${text.slice(0, 52)}…`, () => {
      expect(claimsAddressDelivery(text)).toBe(false);
    });
  }
});

describe("checkAddressDeliveryAuthorization", () => {
  const noCaps = new Set<never>() as ReadonlySet<never>;

  it("refuses an affirmative claim when the capability is absent", () => {
    const r = checkAddressDeliveryAuthorization({
      text: "The parcel was delivered to the verified address.",
      capabilities: noCaps as never,
    });
    expect(r.authorized).toBe(false);
  });

  it("refuses an ambiguous claim when the capability is absent", () => {
    const r = checkAddressDeliveryAuthorization({
      text: "Delivery to the customer's address.",
      capabilities: noCaps as never,
    });
    expect(r.authorized).toBe(false);
  });

  it("authorizes clean delivery prose", () => {
    const r = checkAddressDeliveryAuthorization({
      text: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890).",
      capabilities: noCaps as never,
    });
    expect(r.authorized).toBe(true);
  });

  it("empty and null prose is authorized", () => {
    expect(checkAddressDeliveryAuthorization({ text: "", capabilities: noCaps as never }).authorized).toBe(true);
    expect(checkAddressDeliveryAuthorization({ text: null, capabilities: noCaps as never }).authorized).toBe(true);
  });
});
