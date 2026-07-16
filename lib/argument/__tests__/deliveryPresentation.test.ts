import { describe, it, expect } from "vitest";
import { buildDeliveryPresentation } from "@/lib/argument/deliveryPresentation";

describe("buildDeliveryPresentation", () => {
  it("labels signature-confirmed delivery as the signature key", () => {
    const p = buildDeliveryPresentation({ proofType: "signature_confirmed" });
    expect(p.labelKey).toBe("disputes.deliveryProof.signature");
  });

  it("labels carrier-confirmed delivery as the carrier key", () => {
    const p = buildDeliveryPresentation({ proofType: "delivered_confirmed" });
    expect(p.labelKey).toBe("disputes.deliveryProof.carrierConfirmed");
  });

  it("labels shipped-but-unconfirmed delivery as shippedUnconfirmed", () => {
    const p = buildDeliveryPresentation({ proofType: "delivered_unverified" });
    expect(p.labelKey).toBe("disputes.deliveryProof.shippedUnconfirmed");
  });

  it("labels a label-only fulfillment as labelOnly", () => {
    const p = buildDeliveryPresentation({ proofType: "label_created" });
    expect(p.labelKey).toBe("disputes.deliveryProof.labelOnly");
  });

  it("defaults a manual upload (fileName, no proofType) to shippedUnconfirmed", () => {
    const p = buildDeliveryPresentation({ fileName: "receipt.pdf" });
    expect(p.labelKey).toBe("disputes.deliveryProof.shippedUnconfirmed");
  });

  it("defaults an empty payload to labelOnly", () => {
    expect(buildDeliveryPresentation(null).labelKey).toBe(
      "disputes.deliveryProof.labelOnly",
    );
    expect(buildDeliveryPresentation({}).labelKey).toBe(
      "disputes.deliveryProof.labelOnly",
    );
  });

  it("extracts carrier + number + url from fulfillment tracking (the real prod shape)", () => {
    const p = buildDeliveryPresentation({
      proofType: "delivered_unverified",
      fulfillments: [
        {
          tracking: [
            {
              carrier: "PostNord SE",
              number: "00573132901672098616",
              url: "https://tracking.postnord.com/se/?id=00573132901672098616",
            },
          ],
        },
      ],
    });
    expect(p.trackingLinks).toEqual([
      {
        carrier: "PostNord SE",
        number: "00573132901672098616",
        url: "https://tracking.postnord.com/se/?id=00573132901672098616",
      },
    ]);
  });

  it("dedups repeated tracking numbers across fulfillments", () => {
    const p = buildDeliveryPresentation({
      fulfillments: [
        { tracking: [{ carrier: "UPS", number: "1Z", url: "https://ups.com/1Z" }] },
        { tracking: [{ carrier: "UPS", number: "1Z", url: "https://ups.com/1Z" }] },
      ],
    });
    expect(p.trackingLinks).toHaveLength(1);
  });

  it("falls back to flat trackingNumber/trackingUrl when no fulfillments array", () => {
    const p = buildDeliveryPresentation({
      trackingNumber: "ABC123",
      trackingUrl: "https://carrier.example/ABC123",
      carrier: "DHL",
    });
    expect(p.trackingLinks).toEqual([
      { carrier: "DHL", number: "ABC123", url: "https://carrier.example/ABC123" },
    ]);
  });

  it("recovers the number from a 17track hash URL when Shopify's number is empty (dispute c89276b6)", () => {
    // Real prod shape 2026-07-16: PostNord SE fulfillment with number ""
    // but a 17track URL carrying the number in the hash fragment.
    const p = buildDeliveryPresentation({
      proofType: "delivered_unverified",
      fulfillments: [
        {
          tracking: [
            {
              carrier: "PostNord SE",
              number: "",
              url: "https://t.17track.net/en#nums=LA113743680SE&fc=19241",
            },
          ],
        },
      ],
    });
    expect(p.trackingLinks).toEqual([
      {
        carrier: "PostNord SE",
        number: "LA113743680SE",
        url: "https://t.17track.net/en#nums=LA113743680SE&fc=19241",
      },
    ]);
  });

  it("recovers the number from a query param and takes the first of a comma list", () => {
    const p = buildDeliveryPresentation({
      fulfillments: [
        {
          tracking: [
            {
              carrier: "DHL",
              number: "",
              url: "https://www.dhl.com/se-en/home/tracking.html?tracking-id=5194515796,9999999999",
            },
          ],
        },
      ],
    });
    expect(p.trackingLinks[0]?.number).toBe("5194515796");
  });

  it("leaves number null when the URL carries no known tracking param", () => {
    const p = buildDeliveryPresentation({
      fulfillments: [
        {
          tracking: [
            {
              carrier: "PostNord SE",
              number: "",
              url: "https://tracking.postnord.com/se/",
            },
          ],
        },
      ],
    });
    expect(p.trackingLinks).toEqual([
      { carrier: "PostNord SE", number: null, url: "https://tracking.postnord.com/se/" },
    ]);
  });

  it("rejects non-http tracking urls but keeps the number", () => {
    const p = buildDeliveryPresentation({
      fulfillments: [
        { tracking: [{ carrier: "X", number: "N1", url: "javascript:alert(1)" }] },
      ],
    });
    expect(p.trackingLinks).toEqual([{ carrier: "X", number: "N1", url: null }]);
  });

  it("returns no links when the payload carries no tracking", () => {
    expect(
      buildDeliveryPresentation({ proofType: "label_created" }).trackingLinks,
    ).toEqual([]);
  });
});

describe("resolveDeliveryTitle / receipt state — fact-stating titles (2026-07-16)", () => {
  const collectedPayload = {
    proofType: "delivered_confirmed",
    deliveredAt: "2026-06-04T18:12:00Z",
    fulfillments: [
      {
        carrierTracking: {
          deliveryStatus: "CollectedAtPickup",
          deliveredAtTracking: "2026-06-04T18:12:00Z",
          trackingSource: "carrier_api_dhl",
        },
        tracking: [{ carrier: "DHL Freight", number: "5194515796", url: "https://www.dhl.com/t?tracking-id=5194515796" }],
      },
    ],
  };

  it("carrier-API collection: 'Collected at pickup point {date}' + dhl provenance (the cc86296d shape)", () => {
    const p = buildDeliveryPresentation(collectedPayload);
    expect(p.titleToken).toEqual({
      key: "disputes.deliveryProof.titleCollectedOn",
      params: { date: "Jun 4" },
    });
    expect(p.carrierApiSlug).toBe("dhl");
    // Tier key preserved for ranking / strength-reason checks.
    expect(p.labelKey).toBe("disputes.deliveryProof.carrierConfirmed");
  });

  it("doorstep delivery: 'Delivered {date}', no carrier-API provenance", () => {
    const p = buildDeliveryPresentation({
      proofType: "delivered_confirmed",
      deliveredAt: "2026-07-06T18:16:00Z",
      fulfillments: [
        {
          carrierTracking: {
            deliveryStatus: "Delivered",
            deliveredAtTracking: "2026-07-06T18:16:00Z",
            trackingSource: "shopify_native",
          },
          tracking: [],
        },
      ],
    });
    expect(p.titleToken).toEqual({
      key: "disputes.deliveryProof.titleDeliveredOn",
      params: { date: "Jul 6" },
    });
    expect(p.carrierApiSlug).toBeNull();
  });

  it("arrival awaiting collection: never 'Not delivered', never 'Delivered'", () => {
    const p = buildDeliveryPresentation({
      proofType: "delivered_unverified",
      fulfillments: [
        {
          carrierTracking: {
            deliveryStatus: "DeliveredToPickup",
            deliveredAtTracking: null,
            trackingSource: "shopify_native",
          },
          tracking: [],
        },
      ],
    });
    expect(p.titleToken).toEqual({
      key: "disputes.deliveryProof.titleAwaitingCollection",
    });
  });

  it("signature: 'Delivered & signed for {date}'", () => {
    const p = buildDeliveryPresentation({
      proofType: "signature_confirmed",
      deliveredAt: "2026-07-06T18:16:00Z",
      fulfillments: [],
    });
    expect(p.titleToken).toEqual({
      key: "disputes.deliveryProof.titleSignedOn",
      params: { date: "Jul 6" },
    });
  });

  it("older pack with no receipt state falls back to tier wording without a date", () => {
    const p = buildDeliveryPresentation({ proofType: "delivered_confirmed", fulfillments: [] });
    expect(p.titleToken).toEqual({ key: "disputes.deliveryProof.titleDelivered" });
    const q = buildDeliveryPresentation({ proofType: "delivered_unverified", fulfillments: [] });
    expect(q.titleToken).toEqual({ key: "disputes.deliveryProof.shippedUnconfirmed" });
  });
});
