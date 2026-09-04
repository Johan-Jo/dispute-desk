/**
 * The tracking number has to reach the issuer.
 *
 * WHAT WENT WRONG. `extractValue`'s delivery branch read `p.carrier` — a
 * top-level key that `fulfillmentSource` never writes — and passed no tracking
 * identifier at all. Everything downstream inherits that payload: `facts_json`,
 * the narrative model's input, and the evidence-basis row in the PDF. Measured
 * on prod 2026-08-03: the carrier appeared in **0 of 142** defence packages,
 * and the tracking number in **0 of 12** packages that had one. A confirmed
 * delivery reached the bank as a bare date.
 *
 * That is the one thing these cases turn on. Blume-box #345920's issuer
 * response: "Requesting evidence from merchant providing a tracking number or
 * tracking details that show the order was successfully delivered."
 *
 * And the PDF is the entire submission — `composeShopifyMutationPayload` sends
 * `uncategorizedFile` plus the customer's name and email, no text fields. What
 * is not in the document is not in the bank's file.
 */

import { describe, it, expect } from "vitest";
import { extractValueForTest as extractValue } from "../factClassifier";
import { buildEvidenceBasisRows } from "../pdf/evidenceBasisRows";
import type { EvidenceFact } from "../types";

/** The exact shape `fulfillmentSource` writes (prod pack, USPS parcel). */
const NESTED_PROD_SHAPE = {
  proofType: "delivered_confirmed",
  deliveredAt: "2026-06-20T22:58:00Z",
  signedByName: null,
  fulfillments: [
    {
      status: "SUCCESS",
      displayStatus: "DELIVERED",
      tracking: [
        {
          carrier: "USPS",
          number: "9434650899562189159072",
          url: "https://tools.usps.com/go/TrackConfirmAction.action?tLabels=9434650899562189159072",
        },
      ],
    },
  ],
};

describe("delivery facts carry the identifiers an issuer can verify", () => {
  it("lifts carrier, number and URL out of fulfillments[].tracking[]", () => {
    const v = extractValue("delivery_proof", NESTED_PROD_SHAPE);
    expect(v.carrier).toBe("USPS");
    expect(v.trackingNumber).toBe("9434650899562189159072");
    expect(v.trackingUrl).toContain("tools.usps.com");
    // The pre-existing fields must survive the change.
    expect(v.proofType).toBe("delivered_confirmed");
    expect(v.deliveredAt).toBe("2026-06-20T22:58:00Z");
  });

  it("applies to shipping_tracking as well as delivery_proof", () => {
    const v = extractValue("shipping_tracking", NESTED_PROD_SHAPE);
    expect(v.trackingNumber).toBe("9434650899562189159072");
  });

  it("still reads a flat payload — not every collector nests", () => {
    const v = extractValue("delivery_proof", {
      proofType: "signature_confirmed",
      carrier: "PostNord SE",
      trackingNumber: "00370725111111111111",
      trackingUrl: "https://postnord.se/track",
    });
    expect(v.carrier).toBe("PostNord SE");
    expect(v.trackingNumber).toBe("00370725111111111111");
  });

  it("picks the parcel that actually has a number, not a URL-only row", () => {
    const v = extractValue("delivery_proof", {
      proofType: "delivered_confirmed",
      fulfillments: [
        { tracking: [{ carrier: "DHL Freight", url: "https://dhl.example/track" }] },
        { tracking: [{ carrier: "UPS2", number: "1Z999AA10123456784", url: "https://ups.example" }] },
      ],
    });
    expect(v.trackingNumber).toBe("1Z999AA10123456784");
    expect(v.carrier).toBe("UPS2");
  });

  it("returns nulls when the fulfillment has no tracking at all", () => {
    // blume-box #345920: `tracking: []`, deliveryCoverage "none". The bank
    // asked for a number that never existed in the Shopify record — the
    // defence must not invent one.
    const v = extractValue("delivery_proof", {
      proofType: "delivered_unverified",
      fulfillments: [{ status: "SUCCESS", tracking: [] }],
    });
    expect(v.carrier).toBeNull();
    expect(v.trackingNumber).toBeNull();
    expect(v.trackingUrl).toBeNull();
  });
});

describe("the evidence-basis row prints those identifiers", () => {
  /** Render one delivery fact through the real row builder. */
  const build = (value: Record<string, unknown>) => {
    const fact: EvidenceFact = {
      id: "f0",
      category: "delivery_proof",
      label: "Delivery confirmation",
      value,
      source: "shopify_fulfillments",
      sourceRef: null,
      strength: "strong",
      bankEligible: true,
      merchantVisible: true,
      internalOnly: false,
      includeInBankNarrative: true,
      submissionRisk: false,
      confidence: null,
    };
    return buildEvidenceBasisRows([fact])[0];
  };
  const row = (value: Record<string, unknown>): string => build(value).value;

  it("carries carrier + number in the TEXT and the URL as a CLICKABLE LINK", () => {
    const out = build(extractValue("delivery_proof", NESTED_PROD_SHAPE));
    expect(out.value).toContain("Delivered");
    expect(out.value).toContain("USPS 9434650899562189159072");

    // The URL is NOT pasted into the value text. It used to be, and both
    // renderers printed a dead 120-character string a reviewer had to
    // select, copy and paste by hand — which nobody does, leaving the
    // delivery claim unverifiable in the document that asserts it.
    expect(out.value).not.toContain("http");

    // It reaches the bank as a real link instead: `<Link>` in the PDF (a
    // genuine link annotation) and `<a>` in the HTML preview, anchored on
    // the carrier + number so the raw URL never has to be shown.
    //
    // And it must be the CANONICAL results endpoint rebuilt from the
    // number, not the merchant's `.action?tLabels=` variant.
    expect(out.link).toEqual({
      url: "https://tools.usps.com/tracking/9434650899562189159072",
      label: "USPS 9434650899562189159072",
    });
  });

  it("links even when the carrier name is missing, anchored on the number", () => {
    const out = build({
      proofType: "delivered_confirmed",
      deliveredAt: "2026-06-20T22:58:00Z",
      carrier: null,
      trackingNumber: "9434650899562189159072",
      trackingUrl: "https://tools.usps.com/go/TrackConfirmAction.action",
    });
    expect(out.value).toContain("9434650899562189159072");
    expect(out.link?.url).toContain("https://tools.usps.com");
    expect(out.link?.label).toBe("9434650899562189159072");
  });

  it("appends them to a signature too", () => {
    const out = row({
      proofType: "signature_confirmed",
      deliveredAt: "2026-06-20T22:58:00Z",
      carrier: "UPS2",
      trackingNumber: "1Z999AA10123456784",
    });
    expect(out).toContain("Signature on delivery");
    expect(out).toContain("UPS2 1Z999AA10123456784");
  });

  it("links an in-transit parcel too — looking it up is the whole point", () => {
    const out = build({
      proofType: "delivered_unverified",
      carrier: "PostNord SE",
      trackingNumber: "00370725111111111111",
      trackingUrl: "https://postnord.se/track?id=00370725111111111111",
    });
    expect(out.value).toContain("In transit");
    expect(out.value).toContain("PostNord SE 00370725111111111111");
    // tracking.postnord.com is the real tracker; the postnord.se page is a
    // shell that embeds that same widget.
    expect(out.link?.url).toBe("https://tracking.postnord.com/se/?id=00370725111111111111");
  });

  it("prints no dangling separator and NO link when there is no tracking", () => {
    const out = build({ proofType: "delivered_confirmed", deliveredAt: "2026-06-20T22:58:00Z" });
    expect(out.value).toMatch(/^Delivered /);
    expect(out.value).not.toContain("·");
    // Rule 3 of `resolveTrackingLinkUrl`: no link at all beats a link that
    // opens an empty search form in front of the issuer.
    expect(out.link).toBeNull();
  });

  it("emits NO link when the URL would open an empty search form", () => {
    const out = build({
      proofType: "delivered_confirmed",
      deliveredAt: "2026-06-20T22:58:00Z",
      carrier: "Some Regional Courier",
      trackingNumber: null,
      trackingUrl: "https://courier.example/tracking/",
    });
    expect(out.link).toBeNull();
  });

  it("never puts a bare URL back into the value text (regression guard)", () => {
    // The whole class: any delivery row, any proof state, must keep the URL
    // out of the prose and in `link`.
    for (const proofType of [
      "delivered_confirmed",
      "signature_confirmed",
      "delivered_unverified",
    ]) {
      const out = build({
        proofType,
        deliveredAt: "2026-06-20T22:58:00Z",
        carrier: "DHL",
        trackingNumber: "4207746992612904161024",
        trackingUrl: "https://www.dhl.com/us-en/home/tracking.html",
      });
      expect(out.value).not.toMatch(/https?:\/\//);
      expect(out.link?.url).toContain("dhl.com");
    }
  });
});
